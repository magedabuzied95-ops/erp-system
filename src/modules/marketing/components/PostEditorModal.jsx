import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Hash,
  Image as ImageIcon,
  Megaphone,
  Music2,
  Plus,
  Save,
  Send,
  Sparkles,
  Target,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

import i18n from "../../../i18n/i18n";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);
import { getCurrentTenant } from "../../../shared/auth/authStorage";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront";
import { parseStorefrontPriceValue } from "../../../shared/lib/storefrontPricing";

import {
  buildSocialAICopy,
  defaultSocialTone,
  hasInternalSectionLabels,
  socialToneOptions,
  stripInternalSectionLabels,
} from "./socialAiCopy";
import { buildSuggestedFirstComment } from "../lib/suggestedFirstComment";

const defaultPost = {
  title: "",
  caption: "",
  first_comment: "",
  hashtags: "",
  image_url: "",
  media_urls: [],
  channel: "facebook",
  scheduled_at: "",
};

const previewTabs = [
  { id: "facebook", labelKey: "marketing.social.preview.facebook" },
  { id: "instagram", labelKey: "marketing.social.preview.instagram" },
  { id: "story", labelKey: "marketing.social.preview.story" },
];

const feedPreviewTabs = previewTabs.filter((tab) => tab.id !== "story");
const storyPreviewTabs = previewTabs.filter((tab) => tab.id === "story");
const explicitBothTypes = new Set(["both", "feed_story", "post_story", "story_post", "multi", "mixed"]);
const explicitStoryLayouts = new Set(["last_piece_story", "story_bundle", "ai_story"]);

const normalizeContentToken = (value = "") => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const arrayIncludesStory = (items = []) =>
  items.some((item) => {
    const token = normalizeContentToken(item);
    return token === "story" || token.endsWith("_story") || token.includes("story_");
  });

const arrayIncludesFeed = (items = []) =>
  items.some((item) => {
    const token = normalizeContentToken(item);
    return ["post", "feed", "facebook", "instagram", "facebook_feed", "instagram_feed"].includes(token) || token.includes("_feed");
  });

const collectPublishingTargets = (source = {}) => [
  ...(Array.isArray(source.publish_targets) ? source.publish_targets : []),
  ...(Array.isArray(source.publishing_targets) ? source.publishing_targets : []),
  ...(Array.isArray(source.target_formats) ? source.target_formats : []),
  ...(Array.isArray(source.channels) ? source.channels : []),
  ...(Array.isArray(source.platforms) ? source.platforms : []),
];

export const getPreviewContentFlags = (source = {}) => {
  const design = source.design_json || {};
  const contentType = normalizeContentToken(source.content_type || design.content_type);
  const layoutType = normalizeContentToken(source.layout_type || design.layout_type || source.strategy_type || design.strategy_type);
  const targets = collectPublishingTargets(source).concat(collectPublishingTargets(design));
  const explicitBoth =
    source.supports_feed_story === true ||
    design.supports_feed_story === true ||
    source.publish_to_feed_and_story === true ||
    design.publish_to_feed_and_story === true ||
    explicitBothTypes.has(contentType) ||
    explicitBothTypes.has(layoutType) ||
    (arrayIncludesFeed(targets) && arrayIncludesStory(targets));
  const layoutIsStory =
    explicitStoryLayouts.has(layoutType) ||
    layoutType.includes("_story") ||
    layoutType.startsWith("story_") ||
    layoutType.endsWith("_stories");
  const isStoryContent = explicitBoth || contentType === "story" || layoutIsStory;
  const isFeedContent = explicitBoth || (!isStoryContent && contentType !== "story");

  return { isStoryContent, isFeedContent };
};

const getVisiblePreviewTabs = (source = {}) => {
  const { isStoryContent, isFeedContent } = getPreviewContentFlags(source);
  if (isStoryContent && !isFeedContent) return storyPreviewTabs;
  if (isFeedContent && !isStoryContent) return feedPreviewTabs;
  return previewTabs;
};

const getDefaultPreviewTab = (source = {}) => {
  const tabs = getVisiblePreviewTabs(source);
  if (tabs.length === 1 && tabs[0]?.id === "story") return "story";
  return source.channel === "instagram" && tabs.some((tab) => tab.id === "instagram") ? "instagram" : tabs[0]?.id || "facebook";
};

const aiToneOptions = socialToneOptions;

const toDatetimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (date) => {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const formatScheduledBadge = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const unique = (items = []) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const normalizeMediaKey = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const decoded = decodeURIComponent(raw);
    const url = new URL(decoded, "https://local.invalid");
    return `${url.pathname}`.replace(/\/+/g, "/").toLowerCase();
  } catch {
    return raw.split("?")[0].split("#")[0].trim().toLowerCase();
  }
};

const uniqueMediaUrls = (items = [], exclude = []) => {
  const seen = new Set(exclude.map(normalizeMediaKey).filter(Boolean));
  const output = [];
  for (const item of items) {
    const url = imageFromGalleryItem(item);
    const key = normalizeMediaKey(url);
    if (!url || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(url);
  }
  return output;
};

const sameText = (left, right) => String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();

const parseGallery = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const imageFromGalleryItem = (item) => {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.url || item.image_url || item.image || item.path || item.photo_url || item.thumbnail_url || "";
};

const mediaMatchesSelection = (item, { variantId, color, size } = {}) => {
  if (!item || typeof item === "string") return true;
  const itemVariantId = item.variant_id || item.product_variant_id || item.variantId;
  if (variantId && itemVariantId) return String(itemVariantId) === String(variantId);
  const itemColor = item.color_name || item.color || item.colour || item.colorName;
  if (color && itemColor && !sameText(itemColor, color)) return false;
  const itemSize = item.size_name || item.size || item.sizeName;
  if (size && itemSize && !sameText(itemSize, size)) return false;
  return true;
};

const variantMatchesSelection = (variant = {}, { variantId, color, size } = {}) => {
  if (variantId) return String(variant.id || variant.variant_id || "") === String(variantId);
  if (color && variant.color && !sameText(variant.color, color)) return false;
  if (size && variant.size && !sameText(variant.size, size)) return false;
  return Boolean(color || size);
};

const normalizeHash = (value) => {
  const clean = String(value || "").trim().replace(/^#+/, "");
  return clean ? `#${clean.replace(/\s+/g, "_")}` : "";
};

const parseHashtags = (value) =>
  unique(
    String(value || "")
      .split(/[\s,]+/)
      .map(normalizeHash)
  );

const extractPrice = (caption = "") => {
  const match = String(caption).match(/(\d+(?:[.,]\d+)?)/);
  return match ? match[1] : "";
};

const formatPrice = (price, currency = "EGP") => {
  const cleanPrice = String(price ?? "").trim();
  if (!cleanPrice) return "";
  const cleanCurrency = String(currency || "").trim();
  return cleanCurrency && !cleanPrice.toLowerCase().includes(cleanCurrency.toLowerCase())
    ? `${cleanPrice} ${cleanCurrency}`
    : cleanPrice;
};

const positivePrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};

export const resolveMarketingEditorPrice = ({ post = {}, design = {}, product = {}, variants = [] } = {}) => {
  const rowPrice = (row = {}) => {
    const manualPrice = row.manual_price_override_active === true || String(row.manual_price_override_active || "").toLowerCase() === "true"
      ? row.manual_selling_price
      : 0;
    return [manualPrice, row.current_selling_price, row.purchase_selling_price, row.selling_price, row.regular_price, row.price, row.sale_price]
      .map(positivePrice)
      .find(Boolean) || 0;
  };
  const catalogPrices = [rowPrice(product), ...variants.map(rowPrice)].filter(Boolean);
  return catalogPrices.length ? Math.min(...catalogPrices) : post.price ?? design.price ?? "";
};

const cleanStoryText = (value, fallback = "") => String(value ?? "").trim() || fallback;

const FALLBACK_STORY_AUDIO = {
  title: "Arabic Reel Trend",
  mood: "energetic",
  platform_hint: "instagram/facebook",
  search_query: "Arabic reel trend sneakers",
};

const validAudio = (value) => value && typeof value === "object" && !Array.isArray(value);

const audioFromInput = (input = {}) =>
  input.audio ||
  input.design_json?.audio ||
  input.designJson?.audio ||
  input.raw?.design_json?.audio ||
  input.raw?.designJson?.audio ||
  null;

const resolveStoryAudio = (input = {}, design = {}) => {
  const audio = audioFromInput(input) || design.audio || null;
  if (validAudio(audio)) return audio;
  const flags = getPreviewContentFlags({ ...input, design_json: design });
  return flags.isStoryContent ? FALLBACK_STORY_AUDIO : null;
};

const storyCurrency = (value = "") => {
  const text = String(value || "").trim();
  return text || "EGP";
};

const storyProductSlug = (input = {}) => String(input.product_slug || input.slug || input.canonical_slug || input.product?.slug || input.product?.canonical_slug || input.product_id || "").trim();

const storyCtaUrl = (...sources) => {
  for (const source of sources) {
    const direct = String(source?.cta_url || source?.product_url || source?.public_url || source?.product?.public_url || source?.product?.product_url || source?.product?.url || "").trim();
    if (direct) return direct;
    const slug = storyProductSlug(source || {});
    if (slug) return `/shop/product/${slug}`;
  }
  return "";
};

const normalizeStorySizes = (value) => {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(new Set(raw.map((item) => cleanStoryText(item)).filter(Boolean)));
};

const storySizesLabel = (slide = {}) => {
  const explicit = cleanStoryText(slide.sizes_label);
  if (explicit) return explicit.replace(/^sizes\s*:/i, "AVAILABLE SIZES:");
  const sizes = normalizeStorySizes(slide.available_sizes);
  if (sizes.length) return `AVAILABLE SIZES: ${sizes.join(", ")}`;
  const fallbackSize = cleanStoryText(slide.size_name || slide.size);
  return fallbackSize ? `AVAILABLE SIZES: ${fallbackSize}` : "";
};

const storySizeDisplay = (slide = {}) => {
  const sizes = normalizeStorySizes(slide.available_sizes);
  if (sizes.length) return `AVAILABLE SIZES: ${sizes.join(", ")}`;
  const label = storySizesLabel(slide);
  if (!label) return null;
  const normalized = label.replace(/^available\s+sizes\s*:\s*/i, "").replace(/^sizes?\s*:\s*/i, "");
  const values = normalized.split(/[,\u2022|/]+/).map((item) => cleanStoryText(item)).filter(Boolean);
  return values.length ? `AVAILABLE SIZES: ${values.join(", ")}` : null;
};

const normalizeStorySlides = ({ form = {}, design = {}, mediaUrls = [] } = {}) => {
  const audio = resolveStoryAudio(form, design);
  const availableSizes = normalizeStorySizes(form.available_sizes || design.available_sizes);
  const sizesLabel = cleanStoryText(form.sizes_label || design.sizes_label).replace(/^sizes\s*:/i, "AVAILABLE SIZES:") || (availableSizes.length ? `AVAILABLE SIZES: ${availableSizes.join(", ")}` : "");
  const rawSlides = [
    ...(Array.isArray(design.slides) ? design.slides : []),
    ...(Array.isArray(design.carousel) ? design.carousel : []),
  ];
  const base = {
    product_name: form.product_name || form.title || design.product_name || design.title || "",
    product_id: form.product_id || design.product_id || "",
    title: form.title || design.title || form.product_name || design.product_name || "",
    price: form.price || design.price || "",
    current_price: form.current_price || design.current_price || form.price || design.price || "",
    old_crossed_price: form.old_crossed_price || form.original_price || design.old_crossed_price || design.original_price || "",
    currency: storyCurrency(form.currency || design.currency),
    color_name: form.color_name || design.color_name || "",
    size_name: form.size_name || design.size_name || "",
    cta: form.cta || design.cta || "View details",
    caption: form.caption || design.caption || "",
    product_url: form.product_url || design.product_url || "",
    cta_url: storyCtaUrl(form, design),
    product_slug: storyProductSlug(form) || storyProductSlug(design),
    strategy_type: form.strategy_type || design.strategy_type || "",
    layout_type: form.layout_type || design.layout_type || "",
    store_name: form.store_name || form.storeName || design.store_name || design.storeName || "",
    store_logo_url: form.store_logo_url || form.logo_url || design.store_logo_url || design.logo_url || "",
    available_sizes: availableSizes,
    sizes_label: sizesLabel,
    audio,
  };
  const slides = rawSlides.map((slide = {}, index) => ({
    ...base,
    ...slide,
    image_url: slide.image_url || slide.primary_image_url || slide.url || slide.image || "",
    product_name: slide.product_name || slide.title || base.product_name,
    product_id: slide.product_id || base.product_id,
    title: slide.title || slide.product_name || base.title,
    price: slide.price || base.price,
    current_price: slide.current_price || slide.price || base.current_price,
    old_crossed_price: slide.old_crossed_price || slide.original_price || slide.compare_at_price || base.old_crossed_price,
    currency: storyCurrency(slide.currency || base.currency),
    color_name: slide.color_name || slide.color || base.color_name,
    size_name: slide.size_name || slide.size || base.size_name,
    cta: slide.cta || base.cta,
    caption: slide.caption || slide.copy || base.caption,
    product_url: slide.product_url || base.product_url,
    cta_url: storyCtaUrl(slide, base),
    product_slug: storyProductSlug(slide) || base.product_slug,
    available_sizes: normalizeStorySizes(slide.available_sizes).length ? normalizeStorySizes(slide.available_sizes) : base.available_sizes,
    sizes_label: slide.sizes_label || base.sizes_label,
    audio: slide.audio || audio,
    position: slide.position || index + 1,
  }));

  if (slides.length) return slides;
  const images = uniqueMediaUrls([form.image_url, ...mediaUrls]);
  return (images.length ? images : [""]).map((url, index) => ({
    ...base,
    image_url: url,
    position: index + 1,
  }));
};

const storyIsLastPiece = (slide = {}) => {
  const text = `${slide.strategy_type || ""} ${slide.layout_type || ""} ${slide.caption || ""} ${slide.title || ""}`.toLowerCase();
  return text.includes("last_size") || text.includes("last piece") || text.includes("last-piece") || Number(slide.stock || 0) === 1;
};

const storyCreativeTheme = (slide = {}) => {
  const signal = `${slide.strategy_type || ""} ${slide.layout_type || ""} ${slide.caption || ""} ${slide.title || ""}`.toLowerCase();
  const badge = storyIsLastPiece(slide) || /low.?stock|almost gone/.test(signal)
    ? "LAST SIZE"
    : /offer|sale|discount|deal|promotion/.test(signal)
      ? "SPECIAL OFFER"
      : "NEW COLLECTION";
  return {
    badge, edition: "FRESH DROP",
    background: "bg-[radial-gradient(circle_at_22%_18%,rgba(239,68,68,.24),transparent_30%),radial-gradient(circle_at_85%_22%,rgba(249,115,22,.18),transparent_26%),linear-gradient(155deg,#fff8f7_0%,#f1e5e3_43%,#170909_100%)]",
    accent: "from-red-600 via-rose-600 to-red-800 text-white shadow-[0_0_26px_rgba(239,68,68,.32),0_18px_34px_rgba(69,10,10,.42)]", glow: "bg-red-300/20",
  };
};

export const buildStoryCreativeSlides = ({ item = {}, form = {}, mediaUrls = [] } = {}) => {
  const design = item.design_json || item.designJson || item.raw?.design_json || form.design_json || form.designJson || form.raw?.design_json || {};
  return normalizeStorySlides({
    form: {
      ...item,
      ...form,
      product_name: item.product_name || form.product_name || design.product_name,
      title: item.title || form.title || design.title,
      price: item.price || form.price || design.price,
      current_price: item.current_price || form.current_price || design.current_price || item.price || form.price || design.price,
      old_crossed_price: item.old_crossed_price || item.original_price || form.old_crossed_price || form.original_price || design.old_crossed_price || design.original_price,
      currency: item.currency || form.currency || design.currency,
      color_name: item.color_name || item.color || form.color_name || design.color_name,
      size_name: item.size_name || item.size || form.size_name || design.size_name,
      cta: item.cta || form.cta || design.cta,
      caption: item.caption || form.caption || design.caption,
      product_url: item.product_url || form.product_url || design.product_url,
      cta_url: storyCtaUrl(item, form, design),
      product_slug: storyProductSlug(item) || storyProductSlug(form) || storyProductSlug(design),
      strategy_type: item.strategy_type || form.strategy_type || design.strategy_type,
      layout_type: item.layout_type || form.layout_type || design.layout_type,
      store_name: item.store_name || item.storeName || form.store_name || form.storeName || design.store_name || design.storeName,
      store_logo_url: item.store_logo_url || item.logo_url || form.store_logo_url || form.logo_url || design.store_logo_url || design.logo_url,
      image_url: item.primary_image_url || item.image_url || form.image_url || design.image_url,
      available_sizes: item.available_sizes || form.available_sizes || design.available_sizes,
      sizes_label: item.sizes_label || form.sizes_label || design.sizes_label,
      audio: audioFromInput(item) || audioFromInput(form) || design.audio || null,
    },
    design,
    mediaUrls,
  });
};

const productHashtagCategory = (productName = "") => {
  const source = String(productName || "").toLowerCase();
  if (/(bag|backpack|school\s*bag|شنط|شنطة|حقيبة|حقائب)/i.test(source)) return "bag";
  if (/(shoe|sneaker|trainer|حذاء|كوتشي|جزمة)/i.test(source)) return "shoes";
  return "generic";
};

const buildFallbackHashtags = ({ productName, color, size, strategyType, contentType }) => {
  const category = productHashtagCategory(productName);
  const categoryTags = category === "bag"
    ? ["#bags", "#backpack", "#شنط", "#شنط_ظهر"]
    : category === "shoes"
      ? ["#shoes", "#sneakers", "#footwear"]
      : ["#M1Store"];
  return unique([
    ...categoryTags,
    contentType === "story" ? "#story" : "#new_arrival",
    strategyType === "last_size" ? "#last_piece" : "",
    color ? `#${color}` : "",
    size ? `#size_${size}` : "",
  ].map(normalizeHash)).slice(0, 8);
};

const buildFallbackCaption = ({ productName, price, color, size, cta }) => {
  const details = [color, size ? `Size ${size}` : ""].filter(Boolean).join(" | ");
  return [
    `New arrival: ${productName || "Featured product"}`,
    details ? `Available now in ${details}.` : "Available now with a clean everyday fit.",
    price ? `Price starts from ${price}.` : "",
    cta || "Send us a message to order today.",
  ].filter(Boolean).join("\n\n");
};

const normalizeAICaption = (post = {}, design = {}, product = {}, variants = []) => {
  const rawCaption = String(post.caption || design.caption || design.post_caption || design.copy || "").trim();
  const hasStructuredCopy = hasInternalSectionLabels(rawCaption);
  const baseCopy = buildSocialAICopy({
    tone: post.ai_tone || design.ai_tone || defaultSocialTone,
    post,
    design,
    product,
    variants,
  });
  if (!rawCaption) return baseCopy.caption;
  if (hasStructuredCopy) return baseCopy.caption;
  return stripInternalSectionLabels(rawCaption) || baseCopy.caption;
};

const normalizePostMedia = ({ post = {}, design = {}, product = {}, variants = [], variantId, color, size } = {}) => {
  const selection = { variantId, color, size };
  const selectedVariants = variants.filter((variant) => variantMatchesSelection(variant, selection));
  const selectedVariantMedia = selectedVariants.flatMap((variant) => [
    variant?.primary_image_url,
    variant?.variant_image_url,
    variant?.image_url,
    variant?.color_image_url,
    variant?.image,
    variant?.photo_url,
    variant?.thumbnail_url,
    ...parseGallery(variant?.gallery_images),
    ...parseGallery(variant?.images),
    ...parseGallery(variant?.media_urls),
  ]);
  const selectedVariantMediaKeys = new Set(uniqueMediaUrls(selectedVariantMedia).map(normalizeMediaKey).filter(Boolean));
  const designSlides = [
    ...(Array.isArray(design.slides) ? design.slides : []),
    ...(Array.isArray(design.carousel) ? design.carousel : []),
  ].filter((item) => mediaMatchesSelection(item, selection));
  const explicitMedia = [
    ...(Array.isArray(post.media_urls) ? post.media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
    ...designSlides,
  ].filter((item) => {
    if (!mediaMatchesSelection(item, selection)) return false;
    if (typeof item !== "string" || !selectedVariantMediaKeys.size || !(variantId || color || size)) return true;
    return selectedVariantMediaKeys.has(normalizeMediaKey(item));
  });
  const heroImage = uniqueMediaUrls([
    design.image_url,
    design.primary_image_url,
    post.image_url,
    post.primary_image_url,
    design.variant_image_url,
    post.variant_image_url,
    ...selectedVariantMedia,
    product.image_url,
    product.primary_image_url,
  ])[0] || "";
  const gallery = uniqueMediaUrls([
    ...explicitMedia,
    ...selectedVariantMedia,
    ...(variantId || color || size ? [] : [product.image_url, product.primary_image_url, ...parseGallery(product.gallery_images), ...parseGallery(product.images), ...parseGallery(product.media_urls)]),
  ], [heroImage]);

  return {
    heroImage,
    gallery,
    allMedia: uniqueMediaUrls([heroImage, ...gallery]),
  };
};

export const normalizeMarketingPostInput = (post = {}) => {
  const design = post.design_json || post.designJson || post.raw?.design_json || post.raw?.designJson || {};
  const product = post.product || design.product || post.metadata?.product || {};
  const variants = Array.isArray(post.variants)
    ? post.variants
    : Array.isArray(design.variants)
      ? design.variants
      : Array.isArray(product.variants)
        ? product.variants
        : [];
  const productName = post.product_name || design.product_name || product.name || post.title || "";
  const rawProductUrl = post.product_url || design.product_url || product.product_url || product.url || post.cta_url || design.cta_url || "";
  const productUrl = rawProductUrl
    ? publicStorefrontUrl(rawProductUrl)
    : publicStorefrontUrl(`/shop/product/${product.slug || product.canonical_slug || post.product_id || ""}`);
  const price = formatPrice(resolveMarketingEditorPrice({ post, design, product, variants }), design.currency || post.currency || product.currency);
  const color = post.color_name || design.color_name || post.color || product.color || "";
  const size = post.size_name || design.size_name || post.size || product.size || "";
  const availableSizes = normalizeStorySizes(post.available_sizes || design.available_sizes);
  const sizesLabel = cleanStoryText(post.sizes_label || design.sizes_label).replace(/^sizes\s*:/i, "AVAILABLE SIZES:") || (availableSizes.length ? `AVAILABLE SIZES: ${availableSizes.join(", ")}` : "");
  const variantId = post.variant_id || design.variant_id || product.variant_id || null;
  const cta = (post.content_type || design.content_type) === "story" ? "View details" : post.cta || design.cta || "Shop now";
  const media = normalizePostMedia({ post, design, product, variants, variantId, color, size });
  const audio = resolveStoryAudio(post, design);
  const contextualHashtags = buildFallbackHashtags({ productName, color, size, strategyType: post.strategy_type, contentType: post.content_type });
  const staleTags = productHashtagCategory(productName) === "bag" ? new Set(["#shoes", "#sneakers", "#footwear", "#fashion"]) : new Set();
  const hashtags = contextualHashtags.concat(
    parseHashtags(post.hashtags || design.hashtags || design.tags || post.metadata?.hashtags)
      .filter((tag) => !staleTags.has(tag.toLowerCase()))
  );
  const caption = normalizeAICaption(post, design, product, variants);
  const aiTone = post.ai_tone || design.ai_tone || defaultSocialTone;
  const firstCommentProduct = { ...post, ...product, variants, product_url: productUrl };
  // An AI Center queue row keeps its catalogue facts in design_json and ships no variants
  // array, so the builder would find no price and read the missing stock as "sold out".
  // Ground it in the same numbers the editor itself is showing.
  if (!variants.length) {
    const suggestedPrice = parseStorefrontPriceValue(resolveMarketingEditorPrice({ post, design, product, variants }));
    const suggestedComparePrice = parseStorefrontPriceValue(
      design.old_crossed_price ?? design.original_price ?? post.old_crossed_price ?? post.original_price
    );
    // Late link in the storefront price chain, so a catalogue selling price still wins.
    if (suggestedPrice > 0) firstCommentProduct.price = suggestedPrice;
    if (suggestedPrice > 0 && suggestedComparePrice > suggestedPrice) {
      firstCommentProduct.use_custom_compare_price = true;
      firstCommentProduct.custom_compare_price = suggestedComparePrice;
    }
    const queueStock = firstFiniteNumber(post.current_variant_stock, design.stock, post.stock);
    if (queueStock !== null) firstCommentProduct.stock = queueStock;
  }
  const firstComment = String(post.first_comment || design.first_comment || "").trim() || buildSuggestedFirstComment(firstCommentProduct);

  return {
    ...defaultPost,
    ...post,
    product,
    variants,
    title: post.title || design.title || productName || defaultPost.title,
    caption,
    first_comment: firstComment,
    hashtags: unique(hashtags).join(" "),
    image_url: media.heroImage,
    media_urls: media.gallery,
    product_name: productName,
    product_url: productUrl,
    cta_url: productUrl,
    price,
    color_name: color,
    size_name: size,
    available_sizes: availableSizes,
    sizes_label: sizesLabel,
    ai_tone: aiTone,
    variant_id: variantId,
    content_type: post.content_type || design.content_type || "post",
    layout_type: post.layout_type || design.layout_type || "",
    product_url: post.product_url || design.product_url || product.url || product.product_url || "",
    cta_url: storyCtaUrl(post, design, product),
    product_slug: storyProductSlug(post) || storyProductSlug(design) || storyProductSlug(product),
    audio,
    cta,
    channel: post.channel || design.channel || (post.content_type === "story" ? "instagram" : "facebook"),
    scheduled_at: post.scheduled_at || design.scheduled_at || "",
  };
};

const getNextFridayNight = () => {
  const date = new Date();
  const day = date.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(21, 0, 0, 0);
  return date;
};

const makeSchedulePreset = (id) => {
  const date = new Date();
  if (id === "tonight") {
    date.setHours(20, 0, 0, 0);
    if (date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
    return fromDatetimeLocal(date);
  }
  if (id === "morning") {
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
    return fromDatetimeLocal(date);
  }
  return fromDatetimeLocal(getNextFridayNight());
};

const captionBank = {
  casual: [
    ({ productName, price }) =>
      `وصل جديد وحلو جدا\n${productName}\n\nستايل سهل يليق على كل يوم، ومتوفر بتفاصيل مميزة.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه دلوقتي وخليك سابق بخطوة ✨`,
    ({ productName, price }) =>
      `جديد عندنا\n${productName}\n\nاختيار عملي وشيك في نفس الوقت، مناسب للخروج والشغل وكل مشاويرك.\n${price ? `ابتداء من ${price} ج.م\n` : ""}\nابعتلنا واحجز مقاسك.`,
  ],
  luxury: [
    ({ productName, price }) =>
      `إطلالة بتفاصيل أرقى\n${productName}\n\nتصميم مختار بعناية لعشاق الذوق الهادئ والجودة العالية.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاختيارك لما تحب تميزك يبان.`,
    ({ productName, price }) =>
      `رفاهية في التفاصيل\n${productName}\n\nقطعة تضيف حضور أقوى لإطلالتك، بخامة ولمسة تناسب الاختيارات الراقية.\n${price ? `متاح ابتداء من ${price} ج.م\n` : ""}\nاحجزه الآن.`,
  ],
  offer: [
    ({ productName, price }) =>
      `عرض مميز على ${productName}\n\nلو كنت مستني الفرصة المناسبة، فهي دلوقتي.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه الآن واستفد بالعرض قبل ما ينتهي.`,
    ({ productName, price }) =>
      `${productName} بسعر مناسب جدا\n\nمنتج عملي، شكل مميز، وقيمة ممتازة مقابل السعر.\n${price ? `ابتداء من ${price} ج.م\n` : ""}\nكلمنا واحجز قبل انتهاء الكمية.`,
  ],
  urgency: [
    ({ productName, price }) =>
      `الكمية محدودة\n${productName}\n\nالمقاسات والألوان المميزة بتخلص بسرعة.\n${price ? `السعر يبدأ من: ${price} ج.م\n` : ""}\nاطلبه الآن قبل نفاد الكمية ✨`,
    ({ productName, price }) =>
      `آخر فرصة للحجز\n${productName}\n\nالطلب عليه عالي والكمية المتاحة محدودة.\n${price ? `متاح ابتداء من ${price} ج.م\n` : ""}\nابعتلنا دلوقتي قبل ما يخلص.`,
  ],
};

const PlatformShell = ({ form, hashtags, type, mediaUrls = [], t }) => {
  const currentTenant = getCurrentTenant() || {};
  const tenantSettings = currentTenant.settings || {};
  const storeName = [
    currentTenant.companyName,
    currentTenant.company_name,
    tenantSettings["general.company_name"],
    tenantSettings["storefront.store_name"],
    currentTenant.name,
    form.store_name,
    form.storeName,
    "M1 Store",
  ].map((value) => String(value || "").trim()).find(Boolean) || "M1 Store";
  const image = form.image_url;
  const carousel = uniqueMediaUrls([image, ...mediaUrls]);
  const thumbnailUrls = uniqueMediaUrls(mediaUrls, [image]);
  const caption = form.caption || t("marketing.social.preview.captionFallback");
  const title = form.title || t("marketing.posts.untitled");

  if (type === "instagram") {
    return (
      <div className="mx-auto w-full max-w-[520px] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 p-[2px]">
              <div className="h-full w-full rounded-full bg-slate-950" />
            </div>
            <div>
              <div className="text-sm font-black text-white">{storeName}</div>
              <div className="text-xs text-slate-400">{t("marketing.social.preview.sponsored")}</div>
            </div>
          </div>
          <div className="text-lg text-slate-400">...</div>
        </div>
        <div className="relative aspect-square bg-slate-950">
          {image ? <img src={resolveProductImageUrl(image)} alt={title} className="h-full w-full object-cover" /> : <EmptyMedia t={t} />}
          {carousel.length > 1 ? (
            <div className="absolute bottom-3 right-3 rounded-full bg-black/65 px-3 py-1 text-xs font-black text-white backdrop-blur">
              1/{carousel.length}
            </div>
          ) : null}
        </div>
        {thumbnailUrls.length ? (
          <div className="flex gap-2 overflow-x-auto border-b border-white/10 p-3">
            {thumbnailUrls.slice(0, 6).map((url, index) => (
              <div key={url} className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10">
                <img src={resolveProductImageUrl(url)} alt={`وسائط إنستجرام ${index + 1}`} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="space-y-3 p-4">
          <div className="flex gap-4 text-2xl text-white">
            <span>♡</span>
            <span>◌</span>
            <span>↗</span>
          </div>
          <div className="text-sm font-bold text-white">{t("marketing.social.preview.likesCount")}</div>
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
            <span className="font-black text-white">{storeName} </span>
            {caption}
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold text-[var(--primary)]">
            {hashtags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
      </div>
    );
  }

  if (type === "story") {
    const storySlides = buildStoryCreativeSlides({ form, mediaUrls });
    return (
      <div className="mx-auto w-full max-w-[620px]">
        <StoryCreativePreview slides={storySlides} showThumbnails={storySlides.length > 1} title={tt("marketing.postEditor.story.slidesTitle")} />
      </div>
    );
  }

  if (type === "__legacy_story_preview_disabled__") {
    return (
      <div className="mx-auto flex w-full max-w-[360px] justify-center">
        <div className="relative aspect-[9/16] max-h-[650px] w-full overflow-hidden rounded-[34px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/40">
          {image ? <img src={resolveProductImageUrl(image)} alt={title} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-950" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/15 to-black/75" />
          <div className="absolute left-4 right-4 top-4 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-white/80" />
            <div className="h-1 flex-1 rounded-full bg-white/35" />
            <div className="h-1 flex-1 rounded-full bg-white/35" />
          </div>
          <div className="absolute left-5 right-5 top-9 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full border border-white/30 bg-white/20" />
            <div>
              <div className="text-sm font-black text-white">{storeName}</div>
              <div className="text-xs text-white/70">{t("marketing.social.preview.now")}</div>
            </div>
          </div>
          <div className="absolute inset-x-5 bottom-20 rounded-[24px] border border-white/15 bg-black/35 p-4 backdrop-blur-md">
            <div className="text-2xl font-black leading-tight text-white">{title}</div>
            <div className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-white/90">{caption}</div>
          </div>
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white px-5 py-3 text-sm font-black text-black">
            اطلب الآن
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/30">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary)] text-lg font-black text-[var(--primary-contrast)]">f</div>
        <div>
          <div className="text-sm font-black text-white">{storeName}</div>
          <div className="text-xs text-slate-400">{t("marketing.social.preview.sponsoredPublic")}</div>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className="text-lg font-black text-white">{title}</div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{caption}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold text-[var(--primary)]">
          {hashtags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
      <div className="relative min-h-[340px] bg-[var(--surface-soft)]">
        {image ? <img src={resolveProductImageUrl(image)} alt={title} className="h-full max-h-[520px] min-h-[340px] w-full object-cover" /> : <EmptyMedia t={t} />}
        {carousel.length > 1 ? (
          <div className="absolute right-4 top-4 rounded-full bg-black/65 px-3 py-1 text-xs font-black text-white backdrop-blur">
            {t("marketing.social.preview.photoCount", { count: carousel.length })}
          </div>
        ) : null}
      </div>
      {thumbnailUrls.length ? (
        <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3">
          {thumbnailUrls.slice(0, 7).map((url, index) => (
            <div key={url} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10">
              <img src={resolveProductImageUrl(url)} alt={`وسائط فيسبوك ${index + 1}`} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-3 border-t border-white/10 text-center text-sm font-bold text-slate-300">
        <div className="py-3">{t("marketing.social.preview.like")}</div>
        <div className="py-3">{t("marketing.social.preview.comment")}</div>
        <div className="py-3">{t("marketing.social.preview.share")}</div>
      </div>
    </div>
  );
};

const EmptyMedia = ({ t }) => (
  <div className="flex h-full min-h-[280px] items-center justify-center border border-dashed border-white/10 text-slate-500">
    <div className="text-center">
      <ImageIcon className="mx-auto h-8 w-8" />
      <div className="mt-2 text-sm">{t("marketing.social.media.empty")}</div>
    </div>
  </div>
);

// The creative is laid out once at this size and scaled to whatever box it is
// dropped into. Every offset and font size inside it is a fixed pixel value, so
// rendering it directly into a smaller frame clipped the copy instead of
// shrinking it: at thumbnail size the price and CTA fell outside the frame
// entirely and the sizes strip truncated mid-word.
const STORY_FRAME_WIDTH = 360;
const STORY_FRAME_HEIGHT = 640;

export function StoryCreativeFrame({ slide, total = 1, index = 0 }) {
  const baseTitle = cleanStoryText(slide.product_name || slide.title, "Featured product");
  const colorName = cleanStoryText(slide.color_name || slide.color);
  const title = colorName && !baseTitle.toLowerCase().includes(colorName.toLowerCase()) ? `${baseTitle} - ${colorName}` : baseTitle;
  const cta = "View details";
  const price = formatPrice(slide.current_price || slide.price, slide.currency);
  const currentPriceNumber = Number(String(slide.current_price || slide.price || "").replace(/,/g, "").replace(/[^\d.]/g, "")) || 0;
  const originalPriceRaw = slide.old_crossed_price || slide.original_price || slide.compare_at_price || "";
  const originalPriceNumber = Number(String(originalPriceRaw).replace(/,/g, "").replace(/[^\d.]/g, "")) || 0;
  const originalPrice = originalPriceNumber > currentPriceNumber ? formatPrice(originalPriceRaw, slide.currency) : "";
  const urgency = "Available now";
  const theme = storyCreativeTheme(slide);
  const badge = theme.badge;
  const sizeDisplay = storySizeDisplay(slide);
  const productTitleClass = "text-[1.38rem]";
  const priceClass = "text-[2.12rem]";
  const ctaUrl = storyCtaUrl(slide);
  const copyDirection = /[\u0600-\u06ff]/.test(`${title} ${sizeDisplay || ""}`) ? "rtl" : "ltr";
  const frameRef = useRef(null);
  const [frameScale, setFrameScale] = useState(1);

  // Measured rather than expressed in CSS: scale() takes a plain number, and
  // dividing a container-query length by the design width yields a length, so
  // `scale(calc(100cqw / 360))` is simply invalid and silently does nothing.
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const applyScale = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setFrameScale(width / STORY_FRAME_WIDTH);
    };
    applyScale();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(applyScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="story-creative-frame relative aspect-[9/16] w-full overflow-hidden rounded-[2rem] bg-[#f6f2ea] text-slate-950 shadow-2xl shadow-black/35"
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: STORY_FRAME_WIDTH,
          height: STORY_FRAME_HEIGHT,
          transform: `scale(${frameScale})`,
        }}
      >
      <div className={`story-creative-bg absolute inset-0 ${theme.background}`} />
      <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/82 via-black/44 to-transparent" />
      <div className="absolute left-4 right-4 top-3 z-20 flex gap-1.5">
        {Array.from({ length: Math.max(total, 1) }).map((_, itemIndex) => (
          <div key={itemIndex} className="h-1 flex-1 overflow-hidden rounded-full bg-black/15">
            <div className={`h-full rounded-full ${itemIndex <= index ? "bg-white" : "bg-white/35"}`} />
          </div>
        ))}
      </div>
      <div className="absolute right-5 top-8 z-20">
        <div className="rounded-full bg-slate-950/85 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-lg backdrop-blur">{theme.edition}</div>
      </div>

      <div className="story-creative-image-stage absolute left-3 right-3 top-[4%] z-10 flex h-[54%] items-center justify-center rounded-[1.9rem] bg-white/92">
        <div className="absolute h-80 w-80 rounded-full bg-white/50 blur-3xl" />
        <div className={`absolute h-60 w-60 rounded-full blur-3xl ${theme.glow}`} />
        <div className="absolute bottom-4 h-10 w-72 rounded-[50%] bg-black/34 blur-xl" />
        <div className="absolute bottom-9 h-24 w-80 rounded-[50%] bg-white/12 blur-xl [transform:perspective(360px)_rotateX(68deg)]" />
        {slide.image_url ? (
          <img
            src={resolveProductImageUrl(slide.image_url)}
            alt={title}
            className="story-creative-product-image relative z-10 max-h-full max-w-[112%] object-contain drop-shadow-[0_34px_28px_rgba(0,0,0,.5)]"
          />
        ) : (
          <div className="relative z-10 grid h-56 w-44 place-items-center rounded-[1.8rem] border border-dashed border-slate-900/20 bg-white/55 text-center text-xs font-black text-slate-600">
            Product image
          </div>
        )}
      </div>

      <div dir={copyDirection} className="story-creative-copy absolute bottom-5 left-5 right-5 top-[60.5%] z-20 flex flex-col text-start text-white">
        <div className="pointer-events-none absolute -left-5 top-0 h-[72%] w-1 rounded-r-full bg-gradient-to-b from-red-500 via-red-600 to-transparent shadow-[0_0_20px_rgba(239,68,68,.48)]" />
        <div className="self-start rounded-full border border-red-300/35 bg-red-600 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white shadow-[0_10px_24px_rgba(127,29,29,.34)]">{badge}</div>
        {sizeDisplay ? (
          <div className="story-creative-sizes mt-2.5 inline-flex max-w-full self-start rounded-full border border-red-300/25 bg-white/95 px-3.5 py-1.5 text-[11px] font-black leading-4 tracking-[0.015em] text-slate-950 shadow-lg shadow-black/15 backdrop-blur-md">
            <span className="truncate [overflow-wrap:anywhere]">{sizeDisplay}</span>
          </div>
        ) : null}
        <div className={`mt-3.5 line-clamp-2 min-h-[2.7rem] max-w-full break-words font-extrabold leading-[1.08] tracking-[-0.02em] [overflow-wrap:anywhere] ${productTitleClass}`}>{title}</div>
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/12 pt-3">
          <div className="min-w-0">
            {originalPrice ? <div className="mb-1 text-sm font-bold text-slate-300 line-through decoration-2 decoration-red-500">{originalPrice}</div> : null}
            {price ? <div className={`${priceClass} font-black leading-none tracking-[-0.035em] text-white drop-shadow-[0_8px_18px_rgba(0,0,0,.3)]`}>{price}</div> : null}
            <div className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-5 text-red-100">{urgency}</div>
          </div>
          <a
            href={ctaUrl || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!ctaUrl}
            onClick={(event) => {
              if (!ctaUrl) event.preventDefault();
            }}
            className={`story-creative-cta max-w-[44%] shrink-0 rounded-full border border-white/45 bg-gradient-to-br px-4 py-3 text-center text-[13px] font-black leading-4 transition hover:scale-[1.02] active:scale-[0.99] ${theme.accent} ${ctaUrl ? "" : "pointer-events-none"}`}
          >
            {cta}
          </a>
        </div>
      </div>
      </div>
    </div>
  );
}

export function StoryCreativePreview({ slides = [], activeIndex = null, onSelectSlide, showThumbnails = true, title = "" }) {
  const { t } = useTranslation();
  const slidesTitle = title || t("marketing.postEditor.story.slidesTitle");
  const [activeStorySlideIndex, setActiveStorySlideIndex] = useState(0);
  const safeSlides = slides.length ? slides : [{}];
  const isControlled = Number.isInteger(activeIndex);
  const rawSelectedIndex = isControlled ? activeIndex : activeStorySlideIndex;
  const selectedIndex = Math.max(0, Math.min(rawSelectedIndex, safeSlides.length - 1));
  const activeStorySlide = safeSlides[selectedIndex] || safeSlides[0];

  useEffect(() => {
    if (activeStorySlideIndex > safeSlides.length - 1) {
      setActiveStorySlideIndex(0);
    }
  }, [activeStorySlideIndex, safeSlides.length]);

  const selectStorySlide = (index) => {
    setActiveStorySlideIndex(index);
    onSelectSlide?.(index);
  };

  const handleSlideKeyDown = (event, index) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectStorySlide(index);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(230px,360px)_minmax(140px,1fr)] xl:items-start">
      <div className="mx-auto w-full max-w-[360px]">
        <StoryCreativeFrame slide={activeStorySlide} total={safeSlides.length} index={selectedIndex} />
      </div>
      {showThumbnails ? (
        <div className="min-w-0">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{slidesTitle}</div>
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-2">
            {safeSlides.map((slide, index) => (
              <button
                key={`${slide.image_url || slide.product_name || "story"}-${index}`}
                type="button"
                role="button"
                tabIndex={0}
                onClick={() => selectStorySlide(index)}
                onKeyDown={(event) => handleSlideKeyDown(event, index)}
                className={`group overflow-hidden rounded-[var(--radius-control)] border p-1 text-left transition ${ index === selectedIndex ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-white/10 bg-white/[0.04] hover:border-white/25" }`}
              >
                <StoryCreativeFrame slide={slide} total={safeSlides.length} index={index} />
                <div className="mt-2 truncate px-1 pb-1 text-[11px] font-black text-slate-200">{t("marketing.postEditor.story.slide", { number: index + 1 })}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PostEditorModal({
  open,
  post,
  onClose,
  onSaveDraft,
  onPublish,
  onSchedule,
  actionSlot = null,
  saving = false,
  title = "",
}) {
  const { t } = useTranslation();
  const initial = useMemo(() => normalizeMarketingPostInput(post || {}), [post]);
  const initialTags = useMemo(() => parseHashtags(initial.hashtags), [initial.hashtags]);
  const [form, setForm] = useState({ ...initial, hashtags: initialTags.join(" ") });
  const [hashtags, setHashtags] = useState(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(initial.scheduled_at));
  const [activePreview, setActivePreview] = useState(getDefaultPreviewTab(initial));
  const [captionTone, setCaptionTone] = useState(initial.ai_tone || defaultSocialTone);
  const [copyVariants, setCopyVariants] = useState({ hook: 0, cta: 0, hashtags: 0 });

  useEffect(() => {
    setForm({ ...initial, hashtags: initialTags.join(" ") });
    setHashtags(initialTags);
    setScheduledAt(toDatetimeLocal(initial.scheduled_at));
    setActivePreview(getDefaultPreviewTab(initial));
    setCaptionTone(initial.ai_tone || defaultSocialTone);
    setCopyVariants({ hook: 0, cta: 0, hashtags: 0 });
  }, [initial, initialTags]);

  const mediaUrls = useMemo(() => uniqueMediaUrls(Array.isArray(form.media_urls) ? form.media_urls : [], [form.image_url]), [form.image_url, form.media_urls]);
  const previewMediaUrls = useMemo(() => uniqueMediaUrls([form.image_url, ...mediaUrls]), [form.image_url, mediaUrls]);
  const visiblePreviewTabs = useMemo(() => getVisiblePreviewTabs(form), [form]);
  const previewTabIds = useMemo(() => visiblePreviewTabs.map((tab) => tab.id), [visiblePreviewTabs]);
  const { isStoryContent } = useMemo(() => getPreviewContentFlags(form), [form]);
  const storyAudio = useMemo(() => {
    if (form.audio) return form.audio;
    return buildStoryCreativeSlides({ form, mediaUrls })[0]?.audio || null;
  }, [form, mediaUrls]);

  const productName = form.product_name || form.title || "المنتج";
  const price = form.price || extractPrice(form.caption);

  const composedAiCopy = useMemo(
    () =>
      buildSocialAICopy({
        tone: captionTone,
        hookVariant: copyVariants.hook,
        ctaVariant: copyVariants.cta,
        hashtagVariant: copyVariants.hashtags,
        post: form,
        design: form,
        product: form.product || {},
        variants: form.variants || [],
      }),
    [captionTone, copyVariants.cta, copyVariants.hashtags, copyVariants.hook, form]
  );

  const stats = useMemo(() => {
    const tagScore = Math.max(0, 10 - Math.max(0, hashtags.length - 5) * 2);
    const captionScore = Math.min(40, Math.max(18, Math.round((form.caption || "").length / 7)));
    const imageScore = form.image_url ? 32 : 12;
    const engagement = Math.min(98, captionScore + imageScore + tagScore + 12);
    return {
      reach: `${(1800 + engagement * 37).toLocaleString()}-${(3400 + engagement * 52).toLocaleString()}`,
      time: scheduledAt ? t("marketing.social.stats.scheduledWindow") : t("marketing.social.schedule.tonight8"),
      audience: form.channel === "instagram" ? t("marketing.social.stats.instagramAudience") : t("marketing.social.stats.defaultAudience"),
      engagement,
    };
  }, [form.caption, form.channel, form.image_url, hashtags.length, scheduledAt]);
  const scheduledBadgeLabel = formatScheduledBadge(scheduledAt || form.scheduled_at);
  const isTikTokChannel = String(form.channel || "").trim().toLowerCase() === "tiktok";
  const disabledPublishingMessage = "TikTok publishing is not connected yet.";

  useEffect(() => {
    if (!previewTabIds.includes(activePreview)) {
      setActivePreview(previewTabIds[0] || "facebook");
    }
  }, [activePreview, previewTabIds]);

  if (!open) return null;

  const syncHashtags = (nextTags) => {
    const normalized = unique(nextTags.map(normalizeHash));
    setHashtags(normalized);
    setForm((current) => ({ ...current, hashtags: normalized.join(" ") }));
  };

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const updateChannel = (value) => {
    updateField("channel", value);
    if (value === "instagram") {
      setActivePreview("instagram");
    } else if (value === "facebook" || value === "all") {
      setActivePreview("facebook");
    }
  };

  const selectMainImage = (url) => {
    setForm((current) => ({
      ...current,
      image_url: url,
      media_urls: uniqueMediaUrls([current.image_url, ...(Array.isArray(current.media_urls) ? current.media_urls : [])], [url]),
    }));
  };

  const applyGeneratedCaption = (nextCopy = composedAiCopy) => {
    updateField("caption", nextCopy.caption);
    syncHashtags(nextCopy.hashtags);
  };

  const generateFullCaption = (tone = captionTone) => {
    const nextCopy = buildSocialAICopy({
      tone,
      hookVariant: copyVariants.hook,
      ctaVariant: copyVariants.cta,
      hashtagVariant: copyVariants.hashtags,
      post: form,
      design: form,
      product: form.product || {},
      variants: form.variants || [],
    });
    setCaptionTone(tone);
    applyGeneratedCaption(nextCopy);
  };

  const regenerateHook = () => {
    setCopyVariants((current) => {
      const next = { ...current, hook: current.hook + 1 };
      applyGeneratedCaption(
        buildSocialAICopy({
          tone: captionTone,
          hookVariant: next.hook,
          ctaVariant: next.cta,
          hashtagVariant: next.hashtags,
          post: form,
          design: form,
          product: form.product || {},
          variants: form.variants || [],
        })
      );
      return next;
    });
  };

  const regenerateCta = () => {
    setCopyVariants((current) => {
      const next = { ...current, cta: current.cta + 1 };
      applyGeneratedCaption(
        buildSocialAICopy({
          tone: captionTone,
          hookVariant: next.hook,
          ctaVariant: next.cta,
          hashtagVariant: next.hashtags,
          post: form,
          design: form,
          product: form.product || {},
          variants: form.variants || [],
        })
      );
      return next;
    });
  };

  const regenerateHashtags = () => {
    setCopyVariants((current) => {
      const next = { ...current, hashtags: current.hashtags + 1 };
      applyGeneratedCaption(
        buildSocialAICopy({
          tone: captionTone,
          hookVariant: next.hook,
          ctaVariant: next.cta,
          hashtagVariant: next.hashtags,
          post: form,
          design: form,
          product: form.product || {},
          variants: form.variants || [],
        })
      );
      return next;
    });
  };

  const addTag = () => {
    const next = normalizeHash(tagInput);
    if (!next) return;
    syncHashtags([...hashtags, next]);
    setTagInput("");
  };

  const handleTagKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTag();
  };

  const handleSubmit = async (action) => {
    if (isTikTokChannel) {
      toast.error(disabledPublishingMessage);
      return;
    }
    const payload = {
      ...form,
      hashtags: hashtags.join(" "),
      media_urls: previewMediaUrls,
      scheduled_at: scheduledAt || form.scheduled_at || null,
    };
    if (action === "publish") return onPublish?.(payload);
    if (action === "schedule") return onSchedule?.(payload, scheduledAt || form.scheduled_at || null);
    return onSaveDraft?.(payload);
  };

  const copyAudioSearchQuery = async () => {
    const query = cleanStoryText(storyAudio?.search_query);
    if (!query || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(query);
  };

  return (
    <div className="fixed inset-0 z-[1500] flex items-stretch justify-center overflow-hidden bg-black/75 p-0 backdrop-blur-md transition-opacity duration-200 md:items-center md:p-4">
      <div className="flex h-[100dvh] w-full max-w-[1480px] animate-[fadeIn_180ms_ease-out] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-2xl shadow-black/50 ring-1 ring-[var(--primary)]/20 md:h-auto md:max-h-[96vh] md:rounded-[30px]">
        <div className="flex flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)]">
              <Megaphone className="h-4 w-4" />
              {title || t("marketing.social.editorTitle")}
            </div>
            <h3 className="m1-section-title mt-1 truncate text-white">{form.title || t("marketing.posts.untitled")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto overflow-x-hidden lg:grid-cols-[390px_minmax(0,1fr)] xl:grid-cols-[410px_minmax(520px,1fr)_310px]">
          <div className="order-1 space-y-5 border-b border-[var(--border)] bg-[var(--card)] p-4 md:p-5 lg:border-b-0 lg:border-r">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.posts.headers.channel")}</span>
                <select
                  value={form.channel}
                  onChange={(event) => updateChannel(event.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)]"
                >
                  <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                  <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
                  <option value="tiktok" disabled>
                    {t("marketing.postEditor.channel.platformComingSoon", { platform: t("marketing.social.platforms.tiktok") })}
                  </option>
                  <option value="whatsapp">{t("marketing.social.platforms.whatsapp")}</option>
                  <option value="all">{t("marketing.social.allChannels")}</option>
                </select>
              </label>
              {isTikTokChannel ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-black text-white">TikTok</div>
                  <div className="mt-1 font-semibold">{t("marketing.postEditor.channel.comingSoon")}</div>
                  <div className="mt-1 text-xs text-amber-100/90">
                    {t("marketing.postEditor.channel.connectLater", { platform: t("marketing.social.platforms.tiktok") })}
                  </div>
                </div>
              ) : null}
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.posts.headers.title")}</span>
                <input
                  value={form.title || ""}
                  onChange={(event) => updateField("title", event.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                  placeholder={t("marketing.social.placeholders.title")}
                />
              </label>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] p-4 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.postEditor.caption.tone")}</span>
                  <select
                    value={captionTone}
                    onChange={(event) => setCaptionTone(event.target.value)}
                    className="w-full min-w-[220px] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] outline-none"
                  >
                    {aiToneOptions.map((tone) => (
                      <option key={tone.id} value={tone.id} className="bg-[var(--surface)]">
                        {tone.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => generateFullCaption(captionTone)}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-bold text-[var(--primary)] transition hover:brightness-110"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("marketing.postEditor.caption.generate")}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={regenerateHook}
                  className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
                >
                  <div className="text-sm font-black text-white">{t("marketing.postEditor.caption.regenerateHook")}</div>
                  <div className="text-xs text-slate-400">{composedAiCopy.hook}</div>
                </button>
                <button
                  type="button"
                  onClick={regenerateCta}
                  className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
                >
                  <div className="text-sm font-black text-white">{t("marketing.postEditor.caption.regenerateCta")}</div>
                  <div className="text-xs text-slate-400">{composedAiCopy.cta}</div>
                </button>
                <button
                  type="button"
                  onClick={regenerateHashtags}
                  className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
                >
                  <div className="text-sm font-black text-white">{t("marketing.postEditor.caption.regenerateHashtags")}</div>
                  <div className="text-xs text-slate-400">{composedAiCopy.hashtags.join(" ")}</div>
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <ImageIcon className="h-4 w-4 text-[var(--primary)]" />
                {t("marketing.social.media.title")}
              </div>
              <div className="relative">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={form.image_url || ""}
                  onChange={(event) => updateField("image_url", event.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] py-3 pl-10 pr-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                />
              </div>
              {mediaUrls.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {mediaUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => selectMainImage(url)}
                      className={`group relative aspect-square overflow-hidden rounded-[var(--radius-control)] border transition ${ form.image_url === url ? "border-[var(--primary)] shadow-lg" : "border-[var(--border)] hover:border-[var(--primary)]" }`}
                    >
                      <img src={resolveProductImageUrl(url)} alt={t("marketing.social.media.itemAlt", { index: index + 1 })} className="h-full w-full object-cover transition group-hover:scale-105" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.social.caption")}</span>
              <textarea
                value={form.caption || ""}
                onChange={(event) => updateField("caption", event.target.value)}
                rows={9}
                dir="auto"
                className="w-full resize-none rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                placeholder={t("marketing.social.placeholders.caption")}
              />
            </label>

            <label className="space-y-2 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
              <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                <span>{t("marketing.postEditor.firstComment.title")}</span>
                <span className="normal-case tracking-normal text-slate-500">{t("marketing.postEditor.firstComment.samePublisher")}</span>
              </span>
              <textarea
                value={form.first_comment || ""}
                onChange={(event) => updateField("first_comment", event.target.value)}
                rows={9}
                dir="auto"
                className="w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-emerald-400"
                placeholder={t("marketing.postEditor.firstComment.placeholder")}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.postEditor.fields.productUrl")}</span>
                <input
                  value={form.product_url || ""}
                  onChange={(event) => updateField("product_url", event.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                  placeholder="https://..."
                />
              </label>
              <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-3">
                <MetaPill label={t("marketing.postEditor.fields.price")} value={form.price} />
                <MetaPill label={t("marketing.postEditor.fields.color")} value={form.color_name} />
                <MetaPill label={t("marketing.postEditor.fields.size")} value={form.size_name} />
              </div>
            </div>

            <div className="space-y-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Hash className="h-4 w-4 text-[var(--primary)]" />
                {t("marketing.social.hashtags")}
              </div>
              <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2">
                {hashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => syncHashtags(hashtags.filter((item) => item !== tag))}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-bold text-[var(--primary)] transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-100"
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  className="min-w-[120px] flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-500"
                  placeholder={t("marketing.social.placeholders.tag")}
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="inline-flex h-[var(--control-height-md)] w-9 items-center justify-center rounded-full bg-white/5 text-white transition hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

          </div>

          <div className="order-2 min-w-0 space-y-4 border-b border-[var(--border)] bg-[var(--surface-soft)] p-4 md:p-5 lg:border-b-0 lg:border-r">
            <div className="flex gap-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-1">
              {visiblePreviewTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivePreview(tab.id)}
                  className={`shrink-0 rounded-[var(--radius-control)] px-4 py-2 text-sm font-bold transition ${ activePreview === tab.id ? "bg-[var(--primary)] text-[var(--primary-contrast)] shadow-lg" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]" }`}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
            <div className="rounded-[30px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl shadow-black/30 md:p-6">
              <PlatformShell form={form} hashtags={hashtags} type={activePreview} mediaUrls={mediaUrls} t={t} />
            </div>
            {previewMediaUrls.length > 1 ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const index = Math.max(0, previewMediaUrls.indexOf(form.image_url));
                    selectMainImage(previewMediaUrls[(index - 1 + previewMediaUrls.length) % previewMediaUrls.length]);
                  }}
                  className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.social.media.selectedPreview")}</span>
                <button
                  type="button"
                  onClick={() => {
                    const index = Math.max(0, previewMediaUrls.indexOf(form.image_url));
                    selectMainImage(previewMediaUrls[(index + 1) % previewMediaUrls.length]);
                  }}
                  className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="order-3 space-y-4 border-[var(--border)] bg-[var(--card)] p-4 md:p-5 xl:border-l xl:border-t-0">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
              <StatCard icon={Users} label={t("marketing.social.stats.estimatedReach")} value={stats.reach} tone="primary" />
              <StatCard icon={Clock3} label={t("marketing.social.stats.bestPostingTime")} value={stats.time} tone="emerald" />
              <StatCard icon={Target} label={t("marketing.social.stats.suggestedAudience")} value={stats.audience} tone="amber" />
              <StatCard icon={BarChart3} label={t("marketing.social.stats.engagementScore")} value={`${stats.engagement}/100`} tone="rose" />
            </div>

            <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <CalendarClock className="h-4 w-4 text-[var(--primary)]" />
                {t("marketing.calendar.schedule")}
              </div>
              <div className="grid gap-2">
                {[
                  ["tonight", "marketing.social.schedule.tonight8"],
                  ["morning", "marketing.social.schedule.tomorrowMorning"],
                  ["friday", "marketing.social.schedule.fridayNight"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScheduledAt(makeSchedulePreset(id))}
                    className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left text-sm font-semibold text-[var(--text)] transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
              />
              <div className="text-xs text-slate-400">
                {t("marketing.calendar.timezone", { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || t("marketing.calendar.localTime") })}
              </div>
            </div>

            {isStoryContent && storyAudio ? (
              <div className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--primary-soft)] p-4">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Music2 className="h-4 w-4 text-[var(--primary)]" />
                  Suggested Trending Audio
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                  <div className="text-sm font-black text-white">{storyAudio.title || "Arabic trend audio"}</div>
                  <div className="mt-2 grid gap-2 text-xs font-bold text-slate-300">
                    <div>Mood: {storyAudio.mood || "-"}</div>
                    <div>Platform: {storyAudio.platform_hint || "-"}</div>
                    <div className="break-words">Search: {storyAudio.search_query || "-"}</div>
                  </div>
                </div>
                {storyAudio.search_query ? (
                  <button
                    type="button"
                    onClick={copyAudioSearchQuery}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-xs font-black text-white transition hover:bg-white/10"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Search Query
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Zap className="h-4 w-4 text-amber-300" />
                {t("marketing.ai.smartSuggestions")}
              </div>
              {["bestForFacebook", "highEngagementWording", "useFewerHashtags", "addDiscountCta"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-[var(--primary)]" />
                  {t(`marketing.ai.suggestions.${item}`)}
                </div>
              ))}
            </div>

            <div className="hidden gap-3 md:grid">
              {scheduledBadgeLabel ? (
                <div className="mb-1 flex w-full">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-black text-[var(--primary)]">
                    {scheduledBadgeLabel}
                  </span>
                </div>
              ) : null}
              {actionSlot}
              {onSaveDraft ? (
                <button
                  type="button"
                  disabled={saving || isTikTokChannel}
                  onClick={() => handleSubmit("save")}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-primary disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {t("marketing.approval.saveDraft")}
                </button>
              ) : null}
              {onPublish ? (
                <button
                  type="button"
                  disabled={saving || isTikTokChannel}
                  onClick={() => handleSubmit("publish")}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/10 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {t("marketing.social.publishNow")}
                </button>
              ) : null}
              {onSchedule ? (
                <button
                  type="button"
                  disabled={saving || isTikTokChannel || (!scheduledAt && !form.scheduled_at)}
                  onClick={() => handleSubmit("schedule")}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--primary)] bg-[var(--primary-soft)] px-4 py-3 text-sm font-black text-[var(--primary)] shadow-lg transition hover:-translate-y-0.5 hover:brightness-110 disabled:opacity-60"
                >
                  <CalendarClock className="h-4 w-4" />
                  {t("marketing.calendar.schedule")}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-20 border-t border-[var(--border)] bg-[var(--card)] px-4 py-3 backdrop-blur-md md:hidden">
          {scheduledBadgeLabel ? (
            <div className="mb-3 inline-flex rounded-full border border-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-black text-[var(--primary)]">
              {scheduledBadgeLabel}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {onPublish ? (
              <button
                type="button"
                disabled={saving || isTikTokChannel}
                onClick={() => handleSubmit("publish")}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {t("marketing.social.publishNow")}
              </button>
            ) : null}
            {onSchedule ? (
              <button
                type="button"
                disabled={saving || isTikTokChannel || (!scheduledAt && !form.scheduled_at)}
                onClick={() => handleSubmit("schedule")}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--primary)] bg-[var(--primary-soft)] px-4 py-3 text-sm font-black text-[var(--primary)] shadow-lg transition hover:brightness-110 disabled:opacity-60"
              >
                <CalendarClock className="h-4 w-4" />
                {t("marketing.calendar.schedule")}
              </button>
            ) : null}
            {onSaveDraft ? (
              <button
                type="button"
                disabled={saving || isTikTokChannel}
                onClick={() => handleSubmit("save")}
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] shadow-lg shadow-emerald-500/20 transition hover:bg-primary disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {t("marketing.approval.saveDraft")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  const tones = {
    primary: "text-[var(--primary)] bg-[var(--primary-soft)] border-[var(--primary)]",
    emerald: "text-emerald-200 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-200 bg-amber-500/10 border-amber-500/20",
    rose: "text-rose-200 bg-rose-500/10 border-rose-500/20",
  };
  return (
    <div className={`rounded-3xl border p-4 ${tones[tone] || tones.primary}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function MetaPill({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white">{value || "-"}</div>
    </div>
  );
}
