import db from "../database/db.js";
import { ensureProductVariantImagesSchema } from "./productVariantImagesService.js";
import { publishPost as publishPostService } from "./socialPublisherService.js";
import { publishStoryEverywhere as publishStoryEverywhereService } from "./storyPublisherService.js";
import { generateDesignedAiMarketingStoryImages } from "./storyImageService.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { validateMetaToken } from "./metaTokenService.js";
import { syncMarketingAnalyticsForTenant } from "./marketingAnalyticsService.js";
import { getPublicBackendUrl } from "../utils/publicUrl.js";

const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const DEFAULT_STRATEGIES = {
  new_arrivals: true,
  last_size: true,
  ai_posts: true,
};

const DEFAULT_QUOTAS = [
  { id: "premium-engine", department_name: "All", segment_name: "All", stories_per_day: 12, posts_per_day: 3, priority: 100, active: true },
];

const GENERATION_JOB_TIMEOUT_MS = Math.max(30000, Math.round(Number(process.env.AI_MARKETING_GENERATION_JOB_TIMEOUT_MS) || 180000));
const GENERATION_JOB_CONCURRENCY = Math.min(2, Math.max(1, Math.round(Number(process.env.AI_MARKETING_GENERATION_CONCURRENCY) || 1)));
const generationJobQueue = [];
let activeGenerationJobs = 0;

const ARABIC_TREND_AUDIO_LIBRARY = [
  {
    id: "arabic-energetic-sneakers-beat",
    title: "Energetic Sneakers Beat",
    artist_or_source: "Curated Arabic Reels",
    mood: "energetic",
    category: "sneakers",
    platform_hint: "instagram/facebook",
    search_query: "Arabic energetic sneakers beat reels",
    recommended_for: ["sneakers", "sports shoes", "streetwear", "new arrivals"],
    energy: "high",
    is_trending_label: true,
  },
  {
    id: "arabic-remix-popular-reel",
    title: "Arabic Remix Reel Trend",
    artist_or_source: "Curated Arabic Reels",
    mood: "popular remix",
    category: "general",
    platform_hint: "instagram/facebook",
    search_query: "Arabic remix trending reel audio",
    recommended_for: ["general products", "new arrivals", "fashion"],
    energy: "medium-high",
    is_trending_label: true,
  },
  {
    id: "mahraganat-light-fashion",
    title: "Mahraganat Light Fashion Beat",
    artist_or_source: "Curated Arabic Reels",
    mood: "playful street",
    category: "streetwear",
    platform_hint: "instagram/facebook",
    search_query: "mahraganat light fashion reel audio",
    recommended_for: ["sneakers", "sports shoes", "youth fashion", "streetwear"],
    energy: "high",
    is_trending_label: true,
  },
  {
    id: "khaliji-trend-polished",
    title: "Khaliji Trend Remix",
    artist_or_source: "Curated Arabic Reels",
    mood: "polished upbeat",
    category: "khaliji",
    platform_hint: "instagram/facebook",
    search_query: "Khaliji trend remix reels audio",
    recommended_for: ["premium fashion", "modest fashion", "occasion wear"],
    energy: "medium",
    is_trending_label: true,
  },
  {
    id: "soft-luxury-arabic",
    title: "Soft Luxury Arabic",
    artist_or_source: "Curated Arabic Reels",
    mood: "soft luxury",
    category: "luxury",
    platform_hint: "instagram/facebook",
    search_query: "soft luxury Arabic reel audio",
    recommended_for: ["luxury", "female products", "bags", "dresses", "premium items"],
    energy: "low-medium",
    is_trending_label: true,
  },
  {
    id: "last-piece-fast-beat",
    title: "Last Piece Fast Beat",
    artist_or_source: "Curated Arabic Reels",
    mood: "urgent",
    category: "urgency",
    platform_hint: "instagram/facebook",
    search_query: "Arabic fast beat urgency reel audio",
    recommended_for: ["last piece", "last size", "low stock", "limited stock"],
    energy: "high",
    is_trending_label: true,
  },
  {
    id: "kids-playful-arabic-trend",
    title: "Playful Arabic Kids Trend",
    artist_or_source: "Curated Arabic Reels",
    mood: "playful",
    category: "kids",
    platform_hint: "instagram/facebook",
    search_query: "playful Arabic kids reel audio",
    recommended_for: ["kids", "children", "school shoes", "playful products"],
    energy: "medium-high",
    is_trending_label: true,
  },
  {
    id: "ramadan-eid-seasonal",
    title: "Ramadan / Eid Arabic Trend",
    artist_or_source: "Curated Arabic Seasonal Reels",
    mood: "seasonal warm",
    category: "seasonal",
    platform_hint: "instagram/facebook",
    search_query: "Ramadan Eid Arabic trending reel audio",
    recommended_for: ["Ramadan", "Eid", "seasonal drops", "occasion wear"],
    energy: "medium",
    is_trending_label: true,
  },
];

const CTA_TEXT = ["اطلب الآن", "متوفر الآن", "الحق قبل النفاد", "شوف التفاصيل", "احجز قبل ما يخلص"];
const STRATEGY_TEXT = {
  new_arrivals: ["وصل جديد", "موديل جديد وصل"],
  last_size: ["آخر مقاس", "آخر قطعة"],
  ai_posts: ["اختيار اليوم", "تفاصيل تستاهل"],
};

const normalizeJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const normalizeJsonObject = (value, fallback = {}) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const normalizeFocusedStrategies = (value = {}) => ({
  new_arrivals: value.new_arrivals !== false,
  last_size: value.last_size !== false,
  ai_posts: value.ai_posts !== false,
});

const numberValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInt = (value, fallback = 0) => Math.max(0, Math.round(numberValue(value, fallback)));

const cleanText = (value = "") => String(value || "").trim();

const uniqueTextValues = (items = []) =>
  Array.from(new Set(items.map((item) => cleanText(item)).filter(Boolean)));

const nullableText = (value = "") => {
  const text = cleanText(value);
  return text || null;
};

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const metaErrorMessage = (payload, fallback = "Meta Graph API request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const callMetaGet = async ({ path, params, label }) => {
  const target = new URL(`${GRAPH_API_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const normalized = nullableText(value);
    if (normalized !== null) target.searchParams.set(key, normalized);
  });

  const safeTarget = target
    .toString()
    .replace(/(access_token|client_secret|fb_exchange_token)=[^&]+/g, "$1=***");
  console.log("[ai-center-meta-insights] request", { label, target: safeTarget });

  const response = await fetch(target);
  const payload = await parseMetaResponse(response);
  if (response.ok) return payload;

  const error = new Error(metaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  throw error;
};

const naturalSizeSort = (left, right) => {
  const leftText = cleanText(left);
  const rightText = cleanText(right);
  const leftNumber = Number(leftText.replace(",", "."));
  const rightNumber = Number(rightText.replace(",", "."));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
};

const availableSizesLabel = (sizes = []) => {
  const normalized = uniqueTextValues(sizes).sort(naturalSizeSort);
  return normalized.length ? `AVAILABLE SIZES: ${normalized.join(", ")}` : "";
};

const normalizedSearchText = (...values) => values.map((value) => cleanText(value).toLowerCase()).filter(Boolean).join(" ");

const audioLibraryItem = (id) => ARABIC_TREND_AUDIO_LIBRARY.find((item) => item.id === id) || ARABIC_TREND_AUDIO_LIBRARY[1];

export const selectTrendingAudioForStory = ({
  productName = "",
  categoryName = "",
  colorName = "",
  sizeName = "",
  lane = "",
  layoutType = "",
  contentType = "",
} = {}) => {
  const text = normalizedSearchText(productName, categoryName, colorName, sizeName, lane, layoutType, contentType);
  const isStory = cleanText(contentType).toLowerCase() === "story" || text.includes("story");
  if (!isStory) return null;
  if (text.includes("last_piece_story") || text.includes("last_size") || text.includes("last piece") || text.includes("low stock")) {
    return { ...audioLibraryItem("last-piece-fast-beat") };
  }
  if (/(sneaker|sport|shoe|trainer|streetwear|كوتشي|حذاء|جزمة)/i.test(text)) {
    return { ...audioLibraryItem(text.includes("mahraganat") ? "mahraganat-light-fashion" : "arabic-energetic-sneakers-beat") };
  }
  if (/(luxury|premium|female|women|woman|dress|bag|soft|حريمي|نساء|فستان|شنطة|فاخر|بريميوم)/i.test(text)) {
    return { ...audioLibraryItem("soft-luxury-arabic") };
  }
  if (/(kids|children|child|boy|girl|طفل|اطفال|أطفال|ولادي|بناتي)/i.test(text)) {
    return { ...audioLibraryItem("kids-playful-arabic-trend") };
  }
  if (/(ramadan|eid|رمضان|عيد)/i.test(text)) {
    return { ...audioLibraryItem("ramadan-eid-seasonal") };
  }
  if (/(khaliji|خليجي)/i.test(text)) {
    return { ...audioLibraryItem("khaliji-trend-polished") };
  }
  return { ...audioLibraryItem("arabic-remix-popular-reel") };
};

const normalizeVideoAudioSuggestion = (audio = {}, context = {}) => ({
  id: audio.id || "arabic-remix-popular-reel",
  title: audio.title || "Arabic Remix Reel Trend",
  mood: audio.mood || "popular remix",
  platform_hint: audio.platform_hint || "instagram/facebook",
  search_query: audio.search_query || "Arabic remix trending reel audio",
  trend_label: audio.is_trending_label === false ? "Curated" : "Trending",
  energy: audio.energy || "medium-high",
  category: audio.category || "general",
  artist_or_source: audio.artist_or_source || "Curated Arabic Reels",
  recommended_for: Array.isArray(audio.recommended_for) ? audio.recommended_for : [],
  selection_context: {
    template_preset: context.templatePreset || "",
    product_category: context.categoryName || "",
    lane: context.lane || "",
    reel_type: context.reelType || "",
    hook_style: context.hookStyle || "",
  },
});

const selectTrendingAudioForVideo = ({
  productName = "",
  categoryName = "",
  colorName = "",
  sizeName = "",
  lane = "",
  layoutType = "",
  reelType = "",
  templatePreset = "",
  hookStyle = "",
} = {}) => {
  const text = normalizedSearchText(productName, categoryName, colorName, sizeName, lane, layoutType, reelType, templatePreset, hookStyle, "video reel");
  let audio = null;
  if (text.includes("last_piece") || text.includes("last_size") || text.includes("last piece") || text.includes("low stock") || text.includes("urgency")) {
    audio = audioLibraryItem("last-piece-fast-beat");
  } else if (/(offer|sale|discount|blast|limited)/i.test(text)) {
    audio = audioLibraryItem("arabic-remix-popular-reel");
  } else if (/(sneaker|sport|shoe|trainer|streetwear|hype|ظƒظˆطھط´ظٹ|ط­ط°ط§ط،|ط¬ط²ظ…ط©)/i.test(text)) {
    audio = audioLibraryItem(text.includes("mahraganat") ? "mahraganat-light-fashion" : "arabic-energetic-sneakers-beat");
  } else if (/(luxury|premium|female|women|woman|dress|bag|soft|reveal|ط­ط±ظٹظ…ظٹ|ظ†ط³ط§ط،|ظپط³طھط§ظ†|ط´ظ†ط·ط©|ظپط§ط®ط±|ط¨ط±ظٹظ…ظٹظˆظ…)/i.test(text)) {
    audio = audioLibraryItem("soft-luxury-arabic");
  } else if (/(kids|children|child|boy|girl|ط·ظپظ„|ط§ط·ظپط§ظ„|ط£ط·ظپط§ظ„|ظˆظ„ط§ط¯ظٹ|ط¨ظ†ط§طھظٹ)/i.test(text)) {
    audio = audioLibraryItem("kids-playful-arabic-trend");
  } else if (/(ramadan|eid|ط±ظ…ط¶ط§ظ†|ط¹ظٹط¯)/i.test(text)) {
    audio = audioLibraryItem("ramadan-eid-seasonal");
  } else if (/(khaliji|ط®ظ„ظٹط¬ظٹ)/i.test(text)) {
    audio = audioLibraryItem("khaliji-trend-polished");
  } else {
    audio = audioLibraryItem("arabic-remix-popular-reel");
  }
  return normalizeVideoAudioSuggestion(audio, { templatePreset, categoryName, lane, reelType, hookStyle });
};

const isDevRuntime = () => String(process.env.NODE_ENV || "development").toLowerCase() !== "production";

const logLastPieceValidation = (payload = {}) => {
  if (!isDevRuntime()) return;
  console.log("[last-piece-validate]", {
    product_id: payload.product_id ?? null,
    variant_id: payload.variant_id ?? null,
    color: payload.color || "",
    size: payload.size || "",
    queue_stock: payload.queue_stock ?? null,
    current_stock: payload.current_stock ?? null,
    accepted: Boolean(payload.accepted),
    removed: Boolean(payload.removed),
    reason: payload.reason || "",
  });
};

const BROKEN_IMAGE_VALUES = new Set(["null", "undefined", "none", "false", "#", "about:blank", "broken", "placeholder"]);

const cleanImageUrl = (value = "") => {
  const text = cleanText(value);
  if (!text || BROKEN_IMAGE_VALUES.has(text.toLowerCase())) return "";
  return text;
};

const configuredImageCdnHosts = () =>
  uniqueTextValues([
    "res.cloudinary.com",
    "ik.imagekit.io",
    "cdn.shopify.com",
    "images.ctfassets.net",
    "cdn.sanity.io",
    ...(process.env.STORY_IMAGE_CDN_HOSTS || process.env.IMAGE_CDN_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase()),
  ]);

const frontendAssetPrefixes = () =>
  uniqueTextValues([
    process.env.PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    process.env.WEBSITE_BASE_URL,
    "https://erp-system-ten-green.vercel.app",
  ]).map((value) => value.replace(/\/+$/g, "").toLowerCase());

const isForbiddenFrontendAssetUrl = (value = "") => {
  const text = cleanImageUrl(value);
  if (!text) return true;
  if (/^\/?(dashboard|marketing|shop)(\/|$)/i.test(text)) return true;
  const lower = text.toLowerCase().replace(/\/+$/g, "");
  if (frontendAssetPrefixes().some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))) return true;
  try {
    const parsed = new URL(text);
    return /^\/(dashboard|marketing|shop)(\/|$)/i.test(parsed.pathname || "");
  } catch {
    return true;
  }
};

const isDirectImageCdnUrl = (value = "") => {
  const text = cleanImageUrl(value);
  if (!/^https:\/\//i.test(text)) return false;
  if (isForbiddenFrontendAssetUrl(text)) return false;
  try {
    const parsed = new URL(text);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "res.cloudinary.com" && /^\/[^/]+\/image\/upload\//.test(parsed.pathname)) return true;
    return configuredImageCdnHosts().includes(hostname);
  } catch {
    return false;
  }
};

const publicBackendBaseUrl = () =>
  cleanText(process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_BACKEND_URL || getPublicBackendUrl()).replace(/\/+$/g, "");

const isBackendStoryAssetUrl = (value = "") => {
  const text = cleanImageUrl(value);
  if (!/^https:\/\//i.test(text) || isForbiddenFrontendAssetUrl(text)) return false;
  const backendBase = publicBackendBaseUrl().toLowerCase();
  if (!backendBase) return false;
  const lower = text.toLowerCase();
  return lower.startsWith(`${backendBase}/uploads/stories/`);
};

const isPublicStoryAssetUrl = (value = "") => isDirectImageCdnUrl(value) || isBackendStoryAssetUrl(value);

const absoluteStoryAssetUrl = (value = "") => {
  const text = cleanImageUrl(value);
  if (!text || isForbiddenFrontendAssetUrl(text)) return "";
  if (isDirectImageCdnUrl(text) || isBackendStoryAssetUrl(text)) return text;
  if (/^\/uploads\/stories\//i.test(text) || /^uploads\/stories\//i.test(text)) {
    const backendBase = publicBackendBaseUrl();
    if (!backendBase) return "";
    return `${backendBase}/${text.replace(/^\/+/, "")}`;
  }
  return "";
};

const uniqueImageUrls = (items = []) => {
  const seen = new Set();
  const output = [];
  const queue = [...items];
  for (const item of queue) {
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }
    if (typeof item === "string" && item.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(item);
        if (Array.isArray(parsed)) {
          queue.push(...parsed);
          continue;
        }
      } catch {
        // Keep malformed JSON strings as plain URL candidates below.
      }
    }
    const imageUrl = cleanImageUrl(item);
    if (!imageUrl) continue;
    const key = imageUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(imageUrl);
  }
  return output;
};

const comparableImageUrl = (value = "") => {
  const text = cleanImageUrl(value);
  if (!text) return "";
  try {
    const parsed = new URL(text, "https://local.invalid");
    return decodeURIComponent(parsed.pathname || text).replace(/\/+/g, "/").replace(/^\/+/, "").toLowerCase();
  } catch {
    return text.split("?")[0].split("#")[0].replace(/\/+/g, "/").replace(/^\/+/, "").toLowerCase();
  }
};

const sameImageUrl = (left = "", right = "") => {
  const leftKey = comparableImageUrl(left);
  const rightKey = comparableImageUrl(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
};

const slugify = (value = "") =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "");

const sanitizePublicOrigin = (value = "") => {
  const raw = cleanText(value).replace(/\/+$/g, "");
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/(^|\b)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(\b|:)/i.test(raw)) return "";
  return raw;
};

const storefrontBaseUrl = () => [
  process.env.WEBSITE_BASE_URL,
  process.env.PUBLIC_APP_URL,
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  process.env.APP_URL,
  process.env.PUBLIC_BACKEND_URL,
].map(sanitizePublicOrigin).find(Boolean) || "";

const productSlug = (product = {}) => cleanText(product.slug || product.canonical_slug || (product.id ? String(product.id) : "") || slugify(product.name || ""));

const productUrl = (product = {}) => {
  const slug = productSlug(product);
  if (!slug) return "";
  const path = `/shop/product/${slug}`;
  const base = storefrontBaseUrl();
  return base ? `${base}${path}` : path;
};

const normalizeSettings = (row = {}) => ({
  id: row.id || null,
  planning_mode: row.planning_mode || "weekly",
  stories_per_day: positiveInt(row.stories_per_day, 20),
  posts_per_day: positiveInt(row.posts_per_day, 3),
  auto_publish: row.auto_publish === true,
  require_approval: row.require_approval !== false,
  campaign_mode: row.campaign_mode || "balanced",
  active_strategies: normalizeFocusedStrategies({ ...DEFAULT_STRATEGIES, ...normalizeJsonObject(row.active_strategies, {}) }),
  active: row.active !== false,
  daily_content_quotas: normalizeJsonArray(row.daily_content_quotas, DEFAULT_QUOTAS),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const normalizeQueueRow = (row = {}) => {
  const design = normalizeJsonObject(row.design_json, {});
  const metadata = normalizeJsonObject(row.metadata, {});
  const resolvedProductUrl = cleanText(row.product_url || design.product_url || design.cta_url || metadata.product_url || metadata.cta_url);
  const resolvedCtaUrl = cleanText(design.cta_url || resolvedProductUrl);
  const resolvedProductSlug = cleanText(design.product_slug || metadata.product_slug || row.product_slug || "");
  const renderedImageUrlRaw = cleanText(row.rendered_image_url || design.rendered_image_url || metadata.rendered_image_url);
  const storyImageUrlRaw = cleanText(row.story_image_url || design.story_image_url || metadata.story_image_url);
  const finalAssetUrlRaw = cleanText(row.final_asset_url || design.final_asset_url || metadata.final_asset_url);
  const selectedPublishUrlRaw = cleanText(finalAssetUrlRaw || renderedImageUrlRaw || storyImageUrlRaw);
  const resolvedStoryAsset =
    [renderedImageUrlRaw, storyImageUrlRaw, finalAssetUrlRaw].map(absoluteStoryAssetUrl).find(Boolean) || "";
  return {
    ...row,
    product_url: resolvedProductUrl,
    product_slug: resolvedProductSlug,
    cta_url: resolvedCtaUrl,
    rendered_image_url: resolvedStoryAsset,
    story_image_url: resolvedStoryAsset,
    final_asset_url: resolvedStoryAsset,
    rendered_image_url_raw: renderedImageUrlRaw,
    story_image_url_raw: storyImageUrlRaw,
    final_asset_url_raw: finalAssetUrlRaw,
    selectedPublishUrl_raw: selectedPublishUrlRaw,
    selectedPublishUrl: resolvedStoryAsset,
    media_urls: normalizeJsonArray(row.media_urls, []),
    design_json: {
      ...design,
      ...(resolvedProductUrl ? { product_url: resolvedProductUrl } : {}),
      ...(resolvedCtaUrl ? { cta_url: resolvedCtaUrl } : {}),
      ...(resolvedProductSlug ? { product_slug: resolvedProductSlug } : {}),
      rendered_image_url: resolvedStoryAsset,
      story_image_url: resolvedStoryAsset,
      final_asset_url: resolvedStoryAsset,
    },
    metadata,
    published_platforms: normalizeJsonArray(row.published_platforms, []),
    platform_publish_results: normalizeJsonObject(row.platform_publish_results, {}),
  };
};

export const ensureAiMarketingCenterSchema = async (clientOrPool = db) => {
  await ensureProductVariantImagesSchema(clientOrPool);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_settings (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
      stories_per_day INTEGER NOT NULL DEFAULT 20,
      posts_per_day INTEGER NOT NULL DEFAULT 3,
      auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
      require_approval BOOLEAN NOT NULL DEFAULT TRUE,
      campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
      active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id)
    )
  `);
  await clientOrPool.query(`
    ALTER TABLE IF EXISTS ai_marketing_settings
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) NOT NULL DEFAULT 'weekly',
      ADD COLUMN IF NOT EXISTS stories_per_day INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS posts_per_day INTEGER NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS require_approval BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS campaign_mode VARCHAR(20) NOT NULL DEFAULT 'balanced',
      ADD COLUMN IF NOT EXISTS active_strategies JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS daily_content_quotas JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_marketing_settings_tenant ON ai_marketing_settings (tenant_id)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_content_queue (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      content_type VARCHAR(20) NOT NULL DEFAULT 'story',
      strategy_type VARCHAR(60) NOT NULL DEFAULT 'new_arrivals',
      department_id BIGINT NULL,
      department_name TEXT NOT NULL DEFAULT '',
      segment_type VARCHAR(80) NOT NULL DEFAULT '',
      segment_id BIGINT NULL,
      segment_name TEXT NOT NULL DEFAULT '',
      product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
      variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      primary_image_url TEXT NOT NULL DEFAULT '',
      variant_image_url TEXT NOT NULL DEFAULT '',
      rendered_image_url TEXT NOT NULL DEFAULT '',
      story_image_url TEXT NOT NULL DEFAULT '',
      final_asset_url TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      product_url TEXT NOT NULL DEFAULT '',
      design_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'generated',
      scheduled_at TIMESTAMP NULL,
      published_at TIMESTAMP NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      publish_status VARCHAR(30) NOT NULL DEFAULT 'draft',
      platform_post_id TEXT NULL,
      published_platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
      platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
      publish_error TEXT NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    ALTER TABLE IF EXISTS ai_marketing_content_queue
      ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS primary_image_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS variant_image_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS rendered_image_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS story_image_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS final_asset_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS publish_status VARCHAR(30) NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS platform_post_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS published_platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS platform_publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS publish_error TEXT NULL
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_status ON ai_marketing_content_queue (tenant_id, status, scheduled_at, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_tenant_product_day ON ai_marketing_content_queue (tenant_id, product_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_product_cooldown ON ai_marketing_content_queue (tenant_id, content_type, product_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_variant_cooldown ON ai_marketing_content_queue (tenant_id, content_type, variant_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_queue_dedupe_lookup ON ai_marketing_content_queue (tenant_id, content_type, product_id, variant_id, created_at DESC)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_insights_cache (
      tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      best_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
      best_days JSONB NOT NULL DEFAULT '[]'::jsonb,
      best_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
      engagement_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      timezone TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'fallback',
      last_synced_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    ALTER TABLE IF EXISTS ai_marketing_insights_cache
      ADD COLUMN IF NOT EXISTS best_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS best_days JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS best_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS engagement_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fallback',
      ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_insights_synced ON ai_marketing_insights_cache (last_synced_at DESC)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_marketing_generation_runs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_type VARCHAR(20) NOT NULL DEFAULT 'daily',
      status VARCHAR(30) NOT NULL DEFAULT 'running',
      requested_stories INTEGER NOT NULL DEFAULT 0,
      requested_posts INTEGER NOT NULL DEFAULT 0,
      generated_stories INTEGER NOT NULL DEFAULT 0,
      generated_posts INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_marketing_runs_tenant_started ON ai_marketing_generation_runs (tenant_id, started_at DESC)`);
};

export const getAiMarketingSettings = async (tenantId) => {
  await ensureAiMarketingCenterSchema();
  const existing = await db.query(`SELECT * FROM ai_marketing_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (existing.rows[0]) return normalizeSettings(existing.rows[0]);

  const inserted = await db.query(
    `
    INSERT INTO ai_marketing_settings (tenant_id, active_strategies, daily_content_quotas)
    VALUES ($1, $2::jsonb, $3::jsonb)
    ON CONFLICT (tenant_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [tenantId, JSON.stringify(DEFAULT_STRATEGIES), JSON.stringify(DEFAULT_QUOTAS)]
  );
  return normalizeSettings(inserted.rows[0]);
};

export const updateAiMarketingSettings = async (tenantId, patch = {}) => {
  const current = await getAiMarketingSettings(tenantId);
  const next = {
    planning_mode: ["weekly", "monthly"].includes(patch.planning_mode) ? patch.planning_mode : current.planning_mode,
    stories_per_day: positiveInt(patch.stories_per_day, current.stories_per_day),
    posts_per_day: positiveInt(patch.posts_per_day, current.posts_per_day),
    auto_publish: patch.auto_publish ?? current.auto_publish,
    require_approval: patch.require_approval ?? current.require_approval,
    campaign_mode: ["balanced", "aggressive", "premium"].includes(patch.campaign_mode) ? patch.campaign_mode : current.campaign_mode,
    active_strategies: normalizeFocusedStrategies({ ...current.active_strategies, ...normalizeJsonObject(patch.active_strategies, {}) }),
    active: patch.active ?? current.active,
    daily_content_quotas: normalizeJsonArray(patch.daily_content_quotas, current.daily_content_quotas).map((row, index) => ({
      id: cleanText(row.id) || `quota-${Date.now()}-${index}`,
      department_id: row.department_id || null,
      department_name: cleanText(row.department_name || row.department || "All"),
      segment_type: cleanText(row.segment_type || "grade"),
      segment_id: row.segment_id || null,
      segment_name: cleanText(row.segment_name || row.segment || "All"),
      stories_per_day: positiveInt(row.stories_per_day, 0),
      posts_per_day: positiveInt(row.posts_per_day, 0),
      priority: positiveInt(row.priority, 50),
      active: row.active !== false,
    })),
  };

  const result = await db.query(
    `
    UPDATE ai_marketing_settings
    SET planning_mode = $2,
        stories_per_day = $3,
        posts_per_day = $4,
        auto_publish = $5,
        require_approval = $6,
        campaign_mode = $7,
        active_strategies = $8::jsonb,
        active = $9,
        daily_content_quotas = $10::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1
    RETURNING *
    `,
    [
      tenantId,
      next.planning_mode,
      next.stories_per_day,
      next.posts_per_day,
      next.auto_publish,
      next.require_approval,
      next.campaign_mode,
      JSON.stringify(next.active_strategies),
      next.active,
      JSON.stringify(next.daily_content_quotas),
    ]
  );
  return normalizeSettings(result.rows[0]);
};

export const getAiMarketingOverview = async (tenantId) => {
  await ensureAiMarketingCenterSchema();
  await clearInvalidLastPieceQueueItems(tenantId);
  await markStaleAiMarketingGenerationItemsFailed(tenantId);
  const settings = await getAiMarketingSettings(tenantId);
  const result = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE content_type = 'story' AND created_at::date = CURRENT_DATE)::int AS stories_generated_today,
      COUNT(*) FILTER (WHERE content_type = 'post' AND created_at::date = CURRENT_DATE)::int AS posts_generated_today,
      COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_content,
      COUNT(*) FILTER (WHERE status = 'published')::int AS published_content,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_content,
      COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const row = result.rows[0] || {};
  const postingInsights = await getCachedAiMarketingPostingInsights(tenantId);
  return {
    ai_status: settings.active ? "Active" : "Paused",
    stories_generated_today: Number(row.stories_generated_today || 0),
    posts_generated_today: Number(row.posts_generated_today || 0),
    scheduled_content: Number(row.scheduled_content || 0),
    published_content: Number(row.published_content || 0),
    failed_content: Number(row.failed_content || 0),
    pending_approval: Number(row.pending_approval || 0),
    posting_insights: postingInsights,
  };
};

export const listAiMarketingQueue = async (tenantId, filters = {}) => {
  await ensureAiMarketingCenterSchema();
  await clearInvalidLastPieceQueueItems(tenantId);
  await markStaleAiMarketingGenerationItemsFailed(tenantId);
  const params = [tenantId];
  const clauses = ["tenant_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.content_type) {
    params.push(cleanText(filters.content_type));
    clauses.push(`content_type = $${params.length}`);
  }
  const result = await db.query(
    `
    SELECT *
    FROM ai_marketing_content_queue
    WHERE ${clauses.join(" AND ")}
    ORDER BY scheduled_at ASC NULLS LAST, created_at DESC
    LIMIT 300
    `,
    params
  );
  const rows = [];
  for (const row of result.rows.map(normalizeQueueRow)) {
    if (row.strategy_type !== "last_size") {
      rows.push(await hydrateQueueStoryForRender(tenantId, row));
      continue;
    }
    const validation = await validateLastPieceQueueItem(tenantId, row);
    if (!validation.valid) {
      await db.query(`DELETE FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2`, [row.id, tenantId]);
      continue;
    }
    rows.push(await hydrateQueueStoryForRender(tenantId, applyCurrentLastPieceStock(row, validation.stock)));
  }
  return rows;
};

const imageFromGalleryItem = (item) => {
  if (!item) return "";
  if (typeof item === "string") return item;
  return item.url || item.image_url || item.image || item.path || item.src || "";
};

const imageFromGallery = (gallery) => normalizeJsonArray(gallery).map(imageFromGalleryItem).find(Boolean) || "";

const galleryImageUrls = (value) => normalizeJsonArray(value).map(imageFromGalleryItem);

const variantMediaUrls = (variant = {}) =>
  uniqueImageUrls([
    variant.primary_image_url,
    variant.variant_image_url,
    variant.image_url,
    variant.color_image_url,
    variant.image,
    variant.photo_url,
    variant.thumbnail_url,
    ...galleryImageUrls(variant.images),
    ...galleryImageUrls(variant.gallery_images),
    ...galleryImageUrls(variant.media_urls),
  ]);

const productMediaUrls = (product = {}) =>
  uniqueImageUrls([
    product.image_url,
    product.product_image_url,
    imageFromGallery(product.gallery_images),
    ...galleryImageUrls(product.gallery_images),
    ...galleryImageUrls(product.images),
    ...galleryImageUrls(product.media_urls),
  ]);

const sellableVariants = (product = {}) => (product.variants || []).filter((variant) => variant?.is_active !== false && numberValue(variant?.stock, 0) > 0);

const videoSceneImageRoles = [
  "hero_main",
  "alternate_product",
  "detail_variant",
  "gallery",
  "lifestyle_extra",
  "hero_cta",
];

const videoSingleImageFallbacks = [
  { focus: "hero angle", crop: "full product frame", zoom: "medium", background: "clean spotlight", motion: "fast zoom + shake" },
  { focus: "side profile crop", crop: "off-center side crop", zoom: "close", background: "soft blurred backdrop", motion: "slow pan-left + zoom-in" },
  { focus: "detail zoom", crop: "tight material/detail crop", zoom: "macro", background: "blurred product echo", motion: "quick slide + blur-to-focus" },
  { focus: "price frame crop", crop: "lower-third product crop", zoom: "medium-close", background: "motion blur streaks", motion: "price pop/bounce" },
  { focus: "availability frame", crop: "diagonal crop", zoom: "close", background: "glow sweep blur", motion: "beat pulse" },
  { focus: "CTA hero crop", crop: "centered clean crop", zoom: "medium", background: "clean CTA spotlight", motion: "CTA glow pulse" },
];

const variantColorMatches = (candidate = {}, variant = null) => {
  const selectedColor = cleanText(variant?.color || "").toLowerCase();
  if (!selectedColor) return true;
  const candidateColor = cleanText(candidate?.color || candidate?.color_name || candidate?.colorName || "").toLowerCase();
  return !candidateColor || candidateColor === selectedColor;
};

const videoSceneImagePool = ({ product = {}, variant = null } = {}) => {
  const selectedVariantImages = variant ? variantMediaUrls(variant) : [];
  const productImages = productMediaUrls(product);
  const activeVariants = sellableVariants(product);
  const matchingVariantImages = uniqueImageUrls(
    activeVariants
      .filter((row) => !variant || row.id === variant.id || variantColorMatches(row, variant))
      .flatMap((row) => variantMediaUrls(row))
  );
  const fallbackVariantImages = selectedVariantImages.length || matchingVariantImages.length
    ? []
    : uniqueImageUrls(activeVariants.flatMap((row) => variantMediaUrls(row)));
  const allImages = uniqueImageUrls([
    ...selectedVariantImages,
    ...matchingVariantImages,
    ...productImages,
    ...fallbackVariantImages,
  ]);
  return {
    allImages,
    primaryImage: selectedVariantImages[0] || matchingVariantImages[0] || productImages[0] || fallbackVariantImages[0] || "",
    selectedVariantImages,
    matchingVariantImages,
    productImages,
    fallbackVariantImages,
  };
};

const imageAtSceneIndex = (images = [], sceneIndex = 0) => {
  if (!images.length) return "";
  if (images.length === 1) return images[0];
  if (sceneIndex === 0) return images[0];
  if (sceneIndex === 5) return images[0];
  const image = images[sceneIndex % images.length];
  const previous = images[(sceneIndex - 1) % images.length];
  return image === previous ? images[(sceneIndex + 1) % images.length] : image;
};

const assignVideoSceneImages = ({ scenes = [], product = {}, variant = null } = {}) => {
  const pool = videoSceneImagePool({ product, variant });
  const images = pool.allImages.length ? pool.allImages : uniqueImageUrls([getProductImage(product, variant || {})]);
  return scenes.map((scene, index) => {
    const fallback = videoSingleImageFallbacks[index] || videoSingleImageFallbacks[videoSingleImageFallbacks.length - 1];
    const imageUrl = imageAtSceneIndex(images, index);
    return {
      ...scene,
      image_url: imageUrl,
      role: videoSceneImageRoles[index] || "gallery",
      image_focus: images.length === 1 ? fallback.focus : (index === 2 ? "detail focus" : index === 5 ? "strongest hero CTA" : "scene-specific product angle"),
      crop: images.length === 1 ? fallback.crop : (index === 2 ? "detail crop" : "scene crop"),
      zoom: images.length === 1 ? fallback.zoom : (index === 2 ? "close" : "medium"),
      background_treatment: images.length === 1 ? fallback.background : "scene image background",
      motion: scene.motion || fallback.motion,
    };
  });
};

const isLastPieceVariant = (variant = {}) => {
  const stock = numberValue(variant.stock, 0);
  return variant?.is_active !== false && stock > 0 && stock <= 2;
};

const availableSizesForVariantGroup = (product = {}, variant = null) => {
  const selectedColor = cleanText(variant?.color || "");
  const selectedArticleCode = cleanText(variant?.article_code || variant?.articleCode || "");
  const sizes = usableVariants(product)
    .filter((row) => {
      if (selectedArticleCode) {
        return cleanText(row?.article_code || row?.articleCode || "").toLowerCase() === selectedArticleCode.toLowerCase();
      }
      if (!selectedColor) return true;
      const rowColor = cleanText(row?.color || "");
      return !rowColor || rowColor.toLowerCase() === selectedColor.toLowerCase();
    })
    .map((row) => row?.size);
  return uniqueTextValues(sizes).sort(naturalSizeSort);
};

const withAvailableSizes = (design = {}, sizes = []) => {
  const availableSizes = uniqueTextValues(sizes).sort(naturalSizeSort);
  const sizesLabel = availableSizesLabel(availableSizes);
  if (!availableSizes.length) {
    const { available_sizes, sizes_label, ...rest } = design || {};
    return rest;
  }
  return {
    ...(design || {}),
    available_sizes: availableSizes,
    sizes_label: sizesLabel,
  };
};

const fetchAvailableSizesForQueueItem = async (tenantId, item = {}) => {
  const productId = Number(item.product_id || item.design_json?.product_id || 0);
  if (!Number.isInteger(productId) || productId <= 0) return [];
  const variantId = cleanText(item.variant_id || item.design_json?.variant_id || "");
  const color = cleanText(item.color || item.design_json?.color_name || "");
  const result = await db.query(
    `
    WITH selected_variant AS (
      SELECT color, article_code
      FROM product_variants
      WHERE product_id = $1::bigint
        AND NULLIF($3::text, '') IS NOT NULL
        AND id = NULLIF($3::text, '')::bigint
      LIMIT 1
    )
    SELECT DISTINCT pv.size
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN selected_variant sv ON TRUE
    WHERE pv.product_id = $1::bigint
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint)
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
      AND COALESCE(pv.stock, 0) > 0
      AND NULLIF(TRIM(COALESCE(pv.size, '')), '') IS NOT NULL
      AND (
        (
          NULLIF(TRIM(COALESCE(sv.article_code, '')), '') IS NOT NULL
          AND LOWER(TRIM(COALESCE(pv.article_code, ''))) = LOWER(TRIM(COALESCE(sv.article_code, '')))
        )
        OR (
          NULLIF(TRIM(COALESCE(sv.article_code, '')), '') IS NULL
          AND (
            (
              NULLIF(TRIM(COALESCE(sv.color, '')), '') IS NOT NULL
              AND (
                NULLIF(TRIM(COALESCE(pv.color, '')), '') IS NULL
                OR LOWER(TRIM(COALESCE(pv.color, ''))) = LOWER(TRIM(COALESCE(sv.color, '')))
              )
            )
            OR (
              NULLIF(TRIM(COALESCE(sv.color, '')), '') IS NULL
              AND (
                NULLIF($4::text, '') IS NULL
                OR NULLIF(TRIM(COALESCE(pv.color, '')), '') IS NULL
                OR LOWER(TRIM(COALESCE(pv.color, ''))) = LOWER(TRIM($4::text))
              )
            )
          )
        )
      )
    `,
    [productId, tenantId, variantId, color]
  );
  return uniqueTextValues(result.rows.map((row) => row.size)).sort(naturalSizeSort);
};

const fetchProductLinkForQueueItem = async (tenantId, item = {}) => {
  const design = item.design_json || {};
  const productId = Number(item.product_id || design.product_id || 0);
  const slug = cleanText(item.product_slug || design.product_slug || "");
  if ((!Number.isInteger(productId) || productId <= 0) && !slug) return null;
  const params = [tenantId, productId || null, slug || null];
  const result = await db.query(
    `
    SELECT id, name, slug, canonical_slug
    FROM products
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND (
        ($2::bigint IS NOT NULL AND id = $2::bigint)
        OR ($3::text IS NOT NULL AND (LOWER(slug) = LOWER($3::text) OR LOWER(canonical_slug) = LOWER($3::text)))
      )
    ORDER BY CASE WHEN $2::bigint IS NOT NULL AND id = $2::bigint THEN 0 ELSE 1 END, id DESC
    LIMIT 1
    `,
    params
  );
  const product = result.rows[0] || null;
  if (!product) return null;
  const url = productUrl(product);
  return {
    product_id: product.id,
    product_slug: productSlug(product),
    product_url: url,
    cta_url: url,
  };
};

const withStoryLinks = (item = {}, link = null) => {
  const design = item.design_json || {};
  const productId = item.product_id || design.product_id || link?.product_id || null;
  const productSlugValue = cleanText(item.product_slug || design.product_slug || link?.product_slug || "");
  const productUrlValue = cleanText(item.product_url || design.product_url || link?.product_url || "");
  const ctaUrlValue = cleanText(item.cta_url || design.cta_url || link?.cta_url || productUrlValue);
  return normalizeQueueRow({
    ...item,
    product_id: productId,
    product_slug: productSlugValue,
    product_url: productUrlValue,
    cta_url: ctaUrlValue,
    design_json: {
      ...design,
      cta_text: "View details",
      availability_text: "Available now",
      ...(productId ? { product_id: productId } : {}),
      ...(productSlugValue ? { product_slug: productSlugValue } : {}),
      ...(productUrlValue ? { product_url: productUrlValue } : {}),
      ...(ctaUrlValue ? { cta_url: ctaUrlValue } : {}),
    },
  });
};

const hydrateQueueStoryMetadata = async (tenantId, item = {}) => {
  const design = item.design_json || {};
  const isStory = item.content_type === "story" || cleanText(design.layout_type).toLowerCase().includes("story");
  if (!isStory) return item;
  const availableSizes = await fetchAvailableSizesForQueueItem(tenantId, item);
  const link = (!item.product_url || !design.product_url || !design.cta_url || !design.product_slug)
    ? await fetchProductLinkForQueueItem(tenantId, item)
    : null;
  const withSizes = availableSizes.length ? {
    ...item,
    design_json: withAvailableSizes(design, availableSizes),
  } : item;
  return withStoryLinks(withSizes, link);
};

const hydrateQueueStoryForRender = async (tenantId, item = {}) => {
  const hydrated = await hydrateQueueStoryMetadata(tenantId, item);
  if (!isStoryQueueItem(hydrated) || queueStoryFinalAssetUrl(hydrated)) return hydrated;
  try {
    return await ensureQueueStoryRenderedAsset(tenantId, hydrated);
  } catch (error) {
    console.error("[ai-story-asset] render failed", {
      tenant_id: tenantId,
      queue_id: hydrated?.id || null,
      error: error?.message || "Failed to render AI story asset",
    });
    return normalizeQueueRow({
      ...hydrated,
      metadata: {
        ...(hydrated.metadata || {}),
        story_asset_error: error?.message || "Failed to render AI story asset",
      },
    });
  }
};

const resolveAiContentMedia = ({ product = {}, variant = null, strategy = "", contentType = "story" } = {}) => {
  const activeVariants = sellableVariants(product);
  const productImages = productMediaUrls(product);
  const selectedVariantImages = variant ? variantMediaUrls(variant) : [];
  const variantImages = uniqueImageUrls(activeVariants.flatMap((row) => variantMediaUrls(row)));
  const lastSizeImages = strategy === "last_size" ? selectedVariantImages : [];
  const primaryPool = strategy === "new_arrivals" || contentType === "post"
    ? [...variantImages, ...productImages]
    : strategy === "last_size"
      ? [...lastSizeImages, ...productImages]
    : [...lastSizeImages, ...selectedVariantImages, ...variantImages, ...productImages];
  const mediaUrls = uniqueImageUrls(primaryPool);
  return {
    media_urls: mediaUrls,
    primary_image_url: mediaUrls[0] || "",
    variant_image_url: selectedVariantImages[0] || "",
    variant_media_urls: selectedVariantImages,
    product_media_urls: productImages,
  };
};

const getProductImage = (product = {}, variant = {}) =>
  resolveAiContentMedia({ product, variant }).primary_image_url ||
  cleanText(variant.primary_image_url || variant.variant_image_url || variant.image_url || product.image_url || product.product_image_url || imageFromGallery(product.gallery_images));

const getProductPrice = (product = {}, variant = {}) => {
  const variantSale = numberValue(variant.sale_price, 0);
  const variantPrice = numberValue(variant.price, 0);
  const productSale = product.sale_price_enabled ? numberValue(product.sale_price, 0) : 0;
  return variantSale || variantPrice || productSale || numberValue(product.price, 0) || numberValue(product.regular_price, 0);
};

const getCurrentVariantStock = async (tenantId, variantId) => {
  const normalizedVariantId = Number(variantId);
  if (!Number.isInteger(normalizedVariantId) || normalizedVariantId <= 0) return null;
  const result = await db.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.color,
      pv.size,
      pv.stock,
      pv.is_active,
      pv.deleted_at,
      COALESCE(p.status, 'active') AS product_status
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [normalizedVariantId, tenantId]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    product_id: row.product_id,
    variant_id: row.variant_id,
    color: row.color || "",
    size: row.size || "",
    stock: numberValue(row.stock, 0),
    is_active: row.is_active !== false,
    is_sellable: row.is_active !== false && !row.deleted_at && row.product_status === "active" && numberValue(row.stock, 0) > 0,
  };
};

const getMarketingSettingsRow = async (tenantId) => {
  await ensureMarketingSchema();
  await db.query(
    `
    INSERT INTO marketing_settings (tenant_id, provider)
    VALUES ($1::bigint, 'meta'::varchar)
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenantId]
  );
  const result = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

const resultStatus = (result = {}) => result.status || "failed";

const publishedPlatformsFromResults = (results = {}) =>
  Object.entries(results)
    .filter(([, value]) => value?.status === "published")
    .map(([platform]) => platform);

const normalizePlatformResults = (result = {}, contentType = "post") => {
  if (contentType === "story") return result.story_publish_results || {};
  if (result.platform_publish_results && Object.keys(result.platform_publish_results).length) return result.platform_publish_results;
  return {
    facebook: {
      status: result.status || "failed",
      platform_post_id: result.platform_post_id || result.external_post_id || null,
      error: result.error_message || null,
    },
  };
};

const platformPostIdFromResults = (results = {}) =>
  Object.values(results).find((value) => value?.platform_post_id || value?.platform_story_id || value?.id)?.platform_post_id ||
  Object.values(results).find((value) => value?.platform_story_id || value?.id)?.platform_story_id ||
  Object.values(results).find((value) => value?.id)?.id ||
  null;

const serviceError = (message, status = 500, details = {}) => {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
};

const withTimeout = (promise, timeoutMs, label = "generation job") =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(serviceError(`${label} timed out after ${timeoutMs}ms`, 504)), timeoutMs);
    }),
  ]);

const processGenerationJobs = () => {
  while (activeGenerationJobs < GENERATION_JOB_CONCURRENCY && generationJobQueue.length) {
    const job = generationJobQueue.shift();
    activeGenerationJobs += 1;
    Promise.resolve()
      .then(() => withTimeout(job.run(), job.timeoutMs || GENERATION_JOB_TIMEOUT_MS, job.label || "AI marketing generation job"))
      .catch((error) => {
        console.error("[ai-marketing-generation-job-failed]", {
          type: job.type || "",
          tenantId: job.tenantId || null,
          runId: job.runId || null,
          queueId: job.queueId || null,
          error: error?.message || "Generation job failed",
        });
      })
      .finally(() => {
        activeGenerationJobs = Math.max(0, activeGenerationJobs - 1);
        setImmediate(processGenerationJobs);
      });
  }
};

const enqueueGenerationJob = (job) => {
  generationJobQueue.push(job);
  setImmediate(processGenerationJobs);
  return {
    queued: true,
    queue_depth: generationJobQueue.length,
    active_generation_jobs: activeGenerationJobs,
  };
};

const markStaleAiMarketingGenerationItemsFailed = async (tenantId) => {
  const timeoutMs = GENERATION_JOB_TIMEOUT_MS;
  const result = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = 'failed',
        metadata = metadata || $3::jsonb,
        error_message = $4::text,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1
      AND status IN ('queued', 'generating_image', 'uploading')
      AND updated_at < NOW() - ($2::text::interval)
    RETURNING id, status, metadata
    `,
    [
      tenantId,
      `${Math.ceil(timeoutMs / 1000)} seconds`,
      JSON.stringify({
        generation_stage: "failed",
        story_asset_error: `Generation timed out after ${timeoutMs}ms. Retry is available.`,
        retryable: true,
        timeout_ms: timeoutMs,
        failed_reason: "generation_timeout",
        failed_at: new Date().toISOString(),
      }),
      `Generation timed out after ${timeoutMs}ms. Retry is available.`,
    ]
  );
  if (result.rowCount) {
    console.warn("[ai-marketing-stale-generation-cleanup]", {
      tenantId,
      timeoutMs,
      failedCount: result.rowCount,
      queueIds: result.rows.map((row) => row.id),
    });
  }
  return result.rowCount || 0;
};

const logPublishQueueNotFound = async (tenantId, queueId, reason = "not_found") => {
  const sample = await db.query(
    `
    SELECT id, status, publish_status, content_type, strategy_type, product_id, variant_id
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 12
    `,
    [tenantId]
  );
  console.error("[ai-publish-queue-not-found]", {
    tenant_id: tenantId,
    queue_id: queueId,
    reason,
    existing_ids_sample: sample.rows,
  });
};

const queueItemPostPayload = (item = {}) => {
  const design = item.design_json || {};
  const hashtags = Array.isArray(design.hashtags) ? design.hashtags.join(" ") : cleanText(design.hashtags || "");
  const productLink = cleanText(item.product_url || design.product_url);
  const caption = [item.caption, productLink].map(cleanText).filter(Boolean).join("\n\n");
  const carouselImages = [
    ...(Array.isArray(design.carousel) ? design.carousel.map(imageFromGalleryItem) : []),
    ...(Array.isArray(design.slides) ? design.slides.map(imageFromGalleryItem) : []),
  ];
  return {
    id: item.id,
    tenant_id: item.tenant_id,
    product_id: item.product_id,
    title: item.title || design.title || design.product_name || "",
    caption,
    hashtags,
    image_url: item.primary_image_url || item.image_url || design.primary_image_url || design.image_url || "",
    media_urls: uniqueImageUrls([...(Array.isArray(item.media_urls) ? item.media_urls : []), ...(Array.isArray(design.media_urls) ? design.media_urls : []), ...carouselImages]),
    channel: "all",
  };
};

const queueItemStoryPayload = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const productLink = cleanText(item.cta_url || design.cta_url || item.product_url || design.product_url);
  const finalAssetUrl = storySelectedPublishUrl(item);
  const slideGeneratedAssetUrls = Array.isArray(design.slides)
    ? design.slides.flatMap((slide) => [
        slide?.rendered_asset_url,
        slide?.final_asset_url,
        slide?.story_image_url,
        slide?.generated_asset_url,
        slide?.generated_asset_urls,
        slide?.generated_media_urls,
        slide?.image_url,
      ])
    : [];
  const expectedGeneratedCount = Number(metadata.generated_asset_count || metadata.generated_slide_count || design.generated_asset_count || 0);
  const countedGeneratedMediaSet = new Set(
    expectedGeneratedCount > 0
      ? uniqueImageUrls([item.media_urls, design.media_urls, metadata.media_urls]).slice(0, expectedGeneratedCount).map((url) => cleanImageUrl(url).toLowerCase())
      : []
  );
  const generatedMediaUrls = uniqueImageUrls([
    item.final_asset_urls,
    item.generated_asset_urls,
    item.generated_media_urls,
    design.final_asset_urls,
    design.generated_asset_urls,
    ...(Array.isArray(design.generated_media_urls) ? design.generated_media_urls : []),
    metadata.final_asset_urls,
    metadata.generated_asset_urls,
    ...(Array.isArray(metadata.generated_media_urls) ? metadata.generated_media_urls : []),
    item.final_asset_url,
    item.rendered_image_url,
    item.story_image_url,
    design.final_asset_url,
    design.rendered_image_url,
    design.story_image_url,
    metadata.final_asset_url,
    metadata.rendered_image_url,
    metadata.story_image_url,
    ...(Array.isArray(item.media_urls) ? item.media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
    ...(Array.isArray(metadata.media_urls) ? metadata.media_urls : []),
    ...slideGeneratedAssetUrls,
  ]).filter((url) => isKnownRenderedStoryUrl(url, item) || sameImageUrl(url, finalAssetUrl) || countedGeneratedMediaSet.has(cleanImageUrl(url).toLowerCase()));
  const slideImages = [
    ...(Array.isArray(design.slides) ? design.slides.map((slide) => slide?.source_product_image_url || slide?.original_image_url || slide?.image_url) : []),
    ...(Array.isArray(design.carousel) ? design.carousel.map((slide) => slide?.image_url) : []),
  ];
  const mediaUrls = uniqueImageUrls([
    item.primary_image_url,
    item.image_url,
    design.primary_image_url,
    design.image_url,
    ...(Array.isArray(item.media_urls) ? item.media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
    ...slideImages,
  ]);
  return {
    id: item.id,
    tenant_id: item.tenant_id,
    product_id: item.product_id,
    product_name: design.product_name || item.title || "",
    title: item.title || design.product_name || "",
    caption: item.caption || design.caption || "",
    image_url: finalAssetUrl,
    media_urls: generatedMediaUrls.length ? generatedMediaUrls : (finalAssetUrl ? [finalAssetUrl] : []),
    rendered_image_url: finalAssetUrl,
    story_image_url: finalAssetUrl,
    final_asset_url: finalAssetUrl,
    source_product_image_url: mediaUrls[0] || "",
    story_type: "ai_center",
    require_generated_story_asset: true,
    product_slug: item.product_slug || design.product_slug || "",
    product_url: item.product_url || design.product_url || productLink || "",
    cta_url: productLink,
    cta_text: "View details",
    availability_text: "Available now",
    design_json: design,
  };
};

const isStoryQueueItem = (item = {}) => {
  const design = item.design_json || {};
  return cleanText(item.content_type).toLowerCase() === "story" || cleanText(design.layout_type).toLowerCase().includes("story");
};

const queueStoryFinalAssetUrl = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  return [
    item.rendered_image_url,
    item.story_image_url,
    item.final_asset_url,
    design.rendered_image_url,
    design.story_image_url,
    design.final_asset_url,
    metadata.rendered_image_url,
    metadata.story_image_url,
    metadata.final_asset_url,
  ].map(absoluteStoryAssetUrl).find(Boolean) || "";
};

const storySelectedPublishUrl = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  return [
    item.final_asset_url,
    design.final_asset_url,
    metadata.final_asset_url,
    item.rendered_image_url,
    design.rendered_image_url,
    metadata.rendered_image_url,
    item.story_image_url,
    design.story_image_url,
    metadata.story_image_url,
  ].map(absoluteStoryAssetUrl).find(Boolean) || "";
};

const rawStorySelectedPublishUrl = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  return cleanText(
    item.final_asset_url ||
      design.final_asset_url ||
      metadata.final_asset_url ||
      item.rendered_image_url ||
      design.rendered_image_url ||
      metadata.rendered_image_url ||
      item.story_image_url ||
      design.story_image_url ||
      metadata.story_image_url
  );
};

const isKnownRenderedStoryUrl = (url = "", item = {}) => {
  const value = cleanImageUrl(url);
  if (!value) return false;
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const knownAssets = [
    item.final_asset_url,
    item.rendered_image_url,
    item.story_image_url,
    design.final_asset_url,
    design.rendered_image_url,
    design.story_image_url,
    metadata.final_asset_url,
    metadata.rendered_image_url,
    metadata.story_image_url,
    item.final_asset_urls,
    item.generated_asset_urls,
    item.generated_media_urls,
    design.final_asset_urls,
    design.generated_asset_urls,
    ...(Array.isArray(design.generated_media_urls) ? design.generated_media_urls : []),
    metadata.final_asset_urls,
    metadata.generated_asset_urls,
    ...(Array.isArray(metadata.generated_media_urls) ? metadata.generated_media_urls : []),
  ].flatMap((candidate) => Array.isArray(candidate) ? candidate : [candidate]).map(cleanImageUrl).filter(Boolean);
  return /(^|\/)uploads\/stories\//.test(value) || /\/(?:erp\/)?stories\//i.test(value) || knownAssets.some((asset) => sameImageUrl(asset, value));
};

const rawStoryImageUrls = (item = {}) => {
  const design = item.design_json || {};
  const slideImages = [
    ...(Array.isArray(design.slides) ? design.slides.map((slide) => slide?.source_product_image_url || slide?.variant_image_url || slide?.original_image_url || slide?.image_url) : []),
    ...(Array.isArray(design.carousel) ? design.carousel.map((slide) => slide?.source_product_image_url || slide?.variant_image_url || slide?.original_image_url || slide?.image_url) : []),
  ];
  return uniqueImageUrls([
    item.variant_image_url,
    design.variant_image_url,
    ...(Array.isArray(item.variant_media_urls) ? item.variant_media_urls : []),
    ...(Array.isArray(design.variant_media_urls) ? design.variant_media_urls : []),
    ...(Array.isArray(design.source_media_urls) ? design.source_media_urls : []),
    ...slideImages,
    ...(Array.isArray(item.media_urls) ? item.media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
    item.primary_image_url,
    item.image_url,
    design.primary_image_url,
    design.image_url,
  ]).filter((url) => !isKnownRenderedStoryUrl(url, item));
};

const storyProductImageUrl = (item = {}) => rawStoryImageUrls(item)[0] || "";
const AI_MARKETING_STORY_RENDERER = "ai_marketing_story_preview_parity_v2";

const isValidRenderedStoryAsset = (item = {}, assetUrl = "") => {
  const selectedAsset = cleanImageUrl(assetUrl);
  if (!selectedAsset) return false;
  if (!isPublicStoryAssetUrl(selectedAsset)) return false;
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const renderer = cleanText(metadata.story_asset_renderer || design.story_asset_renderer);
  if (renderer !== AI_MARKETING_STORY_RENDERER) return false;
  return !rawStoryImageUrls(item).some((productImageUrl) => sameImageUrl(selectedAsset, productImageUrl));
};

const markQueueStoryRenderFailure = async (tenantId, item = {}, error) => {
  if (!item?.id) return normalizeQueueRow(item);
  const nextMetadata = {
    ...(item.metadata || {}),
    story_asset_error: error?.message || "Story render failed",
    story_asset_failed_at: new Date().toISOString(),
    generation_stage: "failed",
  };
  const updated = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = 'failed',
        metadata = $3::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2
    RETURNING *
    `,
    [item.id, tenantId, JSON.stringify(nextMetadata)]
  );
  return updated.rows[0] ? normalizeQueueRow(updated.rows[0]) : normalizeQueueRow({ ...item, metadata: nextMetadata });
};

const updateQueueGenerationStage = async (tenantId, id, stage, extraMetadata = {}) => {
  const nextMetadata = {
    generation_stage: stage,
    generation_stage_updated_at: new Date().toISOString(),
    ...extraMetadata,
  };
  const updated = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = $3::varchar,
        metadata = metadata || $4::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2
    RETURNING *
    `,
    [id, tenantId, stage, JSON.stringify(nextMetadata)]
  );
  return updated.rows[0] ? normalizeQueueRow(updated.rows[0]) : null;
};

const ensureQueueStoryRenderedAsset = async (tenantId, item = {}, { force = false } = {}) => {
  if (!isStoryQueueItem(item)) return item;
  const existingAsset = queueStoryFinalAssetUrl(item);
  if (!force && isValidRenderedStoryAsset(item, existingAsset)) return normalizeQueueRow(item);

  const rawImages = rawStoryImageUrls(item);
  const design = item.design_json || {};
  console.log("[story-source-images]", {
    queueId: item.id || null,
    count: rawImages.length,
    image_urls: rawImages,
    design_slides_length: Array.isArray(design.slides) ? design.slides.length : 0,
  });
  let renderedAssetUrl = "";
  let renderedAssetUrls = [];
  let renderedSlides = [];
  try {
    const rendered = await generateDesignedAiMarketingStoryImages({
      tenantId,
      postId: item.id,
      story: {
        ...item,
        image_url: rawImages[0] || item.image_url || design.image_url || "",
        source_product_image_url: rawImages[0] || "",
        media_urls: rawImages,
        available_sizes: design.available_sizes,
        sizes_label: design.sizes_label,
        price: item.price || design.price || design.product_price,
        currency: item.currency || design.currency,
        strategy_type: item.strategy_type || design.strategy_type,
        layout_type: item.layout_type || design.layout_type,
        design_json: {
          ...design,
          image_url: rawImages[0] || design.image_url || item.image_url || "",
          media_urls: rawImages,
          source_media_urls: rawImages,
        },
      },
    });
    renderedAssetUrls = uniqueImageUrls((rendered.media_urls || []).map(absoluteStoryAssetUrl));
    renderedSlides = Array.isArray(rendered.slides) ? rendered.slides.map((slide, index) => ({
      ...slide,
      rendered_asset_url: absoluteStoryAssetUrl(slide.rendered_asset_url || slide.final_asset_url || slide.image_url),
      image_url: absoluteStoryAssetUrl(slide.rendered_asset_url || slide.final_asset_url || slide.image_url),
      source_product_image_url: rawImages[index] || slide.source_product_image_url || "",
      slide_number: index + 1,
    })) : [];
    renderedAssetUrl = renderedAssetUrls[0] || absoluteStoryAssetUrl(rendered.final_asset_url);
    console.log("[story-generated-assets]", {
      queueId: item.id || null,
      generated_asset_count: renderedAssetUrls.length,
      generated_asset_urls: renderedAssetUrls,
      media_urls_length: renderedAssetUrls.length,
      rendered_slides_length: renderedSlides.length,
      source_image_count: rawImages.length,
      generated_matches_source_count: renderedAssetUrls.length === rawImages.length,
    });
    if (renderedAssetUrls.length !== rawImages.length) {
      console.warn("[story-generated-assets-mismatch]", {
        queueId: item.id || null,
        source_image_count: rawImages.length,
        generated_asset_count: renderedAssetUrls.length,
        generated_asset_urls: renderedAssetUrls,
      });
    }
  } catch (error) {
    await markQueueStoryRenderFailure(tenantId, item, error);
    throw error;
  }
  if (!isValidRenderedStoryAsset({
    ...item,
    design_json: { ...design, story_asset_renderer: AI_MARKETING_STORY_RENDERER },
    metadata: { ...(item.metadata || {}), story_asset_renderer: AI_MARKETING_STORY_RENDERER },
  }, renderedAssetUrl)) {
    const error = serviceError("Story asset URL is not a public image URL.", 500, {
      queue_id: item.id,
      rendered_asset_url: renderedAssetUrl,
      product_image_url: rawImages[0] || "",
      required_prefix: "https://res.cloudinary.com/ or BACKEND_PUBLIC_URL + /uploads/stories/...",
    });
    await markQueueStoryRenderFailure(tenantId, item, error);
    throw error;
  }

  const nextDesign = {
    ...design,
    source_media_urls: rawImages,
    generated_media_urls: renderedAssetUrls,
    rendered_image_url: renderedAssetUrl,
    story_image_url: renderedAssetUrl,
    final_asset_url: renderedAssetUrl,
    source_product_image_url: rawImages[0] || "",
    story_asset_renderer: AI_MARKETING_STORY_RENDERER,
    media_urls: renderedAssetUrls,
    media_urls_length: renderedAssetUrls.length,
    generated_asset_count: renderedAssetUrls.length,
    rendered_slides_length: renderedSlides.length,
    source_image_count: rawImages.length,
    slides: (renderedSlides.length ? renderedSlides : renderedAssetUrls.map((url, index) => ({
      image_url: url,
      rendered_asset_url: url,
      final_asset_url: url,
      source_product_image_url: rawImages[index] || "",
      slide_number: index + 1,
    }))).map((slide, index) => ({
      ...(Array.isArray(design.slides) ? design.slides[index] || {} : {}),
      ...slide,
      image_url: slide.rendered_asset_url || slide.image_url,
      rendered_asset_url: slide.rendered_asset_url || slide.image_url,
      final_asset_url: slide.final_asset_url || slide.rendered_asset_url || slide.image_url,
      story_image_url: slide.story_image_url || slide.rendered_asset_url || slide.image_url,
      source_product_image_url: slide.source_product_image_url || rawImages[index] || "",
      original_image_url: slide.source_product_image_url || rawImages[index] || "",
      slide_number: index + 1,
    })),
  };
  const nextMetadata = {
    ...(item.metadata || {}),
    rendered_image_url: renderedAssetUrl,
    story_image_url: renderedAssetUrl,
    final_asset_url: renderedAssetUrl,
    source_image_count: rawImages.length,
    source_image_urls: rawImages,
    generated_media_urls: renderedAssetUrls,
    generated_asset_count: renderedAssetUrls.length,
    generated_asset_urls: renderedAssetUrls,
    generated_slide_count: renderedAssetUrls.length,
    rendered_slides_length: nextDesign.slides.length,
    media_urls_length: renderedAssetUrls.length,
    generated_matches_source_count: renderedAssetUrls.length === rawImages.length,
    story_asset_error: "",
    story_asset_renderer: AI_MARKETING_STORY_RENDERER,
    story_asset_generated_at: new Date().toISOString(),
    generation_stage: "ready",
  };
  const updated = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = 'ready',
        rendered_image_url = $3,
        story_image_url = $3,
        final_asset_url = $3,
        media_urls = $6::jsonb,
        image_url = $3,
        design_json = $4::jsonb,
        metadata = $5::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2
    RETURNING *
    `,
    [item.id, tenantId, renderedAssetUrl, JSON.stringify(nextDesign), JSON.stringify(nextMetadata), JSON.stringify(renderedAssetUrls)]
  );
  console.log("[story-asset-url-persist]", {
    queueId: item.id,
    rendered_image_url: renderedAssetUrl,
    story_image_url: renderedAssetUrl,
    final_asset_url: renderedAssetUrl,
    selectedPublishUrl: renderedAssetUrl,
    source_image_count: rawImages.length,
    source_image_urls: rawImages,
    generated_media_urls: renderedAssetUrls,
    generated_asset_count: renderedAssetUrls.length,
    generated_asset_urls: renderedAssetUrls,
    generated_slide_count: renderedAssetUrls.length,
    design_slides_length: nextDesign.slides.length,
    rendered_slides_length: nextDesign.slides.length,
    media_urls_length: renderedAssetUrls.length,
    generated_matches_source_count: renderedAssetUrls.length === rawImages.length,
    rendered_image_url_valid: isPublicStoryAssetUrl(renderedAssetUrl),
    final_asset_url_valid: isPublicStoryAssetUrl(renderedAssetUrl),
  });
  return updated.rows[0] ? normalizeQueueRow(updated.rows[0]) : normalizeQueueRow({ ...item, ...nextMetadata, design_json: nextDesign });
};

export const generateAiMarketingQueueStoryAsset = async (tenantId, id) => {
  await ensureAiMarketingCenterSchema();
  const current = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  const currentItem = current.rows[0] ? normalizeQueueRow(current.rows[0]) : null;
  if (!currentItem) {
    await logPublishQueueNotFound(tenantId, id, "story_asset_queue_not_found");
    throw serviceError("Queue item not found", 404, { queue_id: id, reason: "not_found_or_tenant_mismatch" });
  }
  if (!isStoryQueueItem(currentItem)) {
    throw serviceError("Queue item is not a story.", 400, { queue_id: id, content_type: currentItem.content_type || "" });
  }
  const hydrated = await hydrateQueueStoryMetadata(tenantId, currentItem);
  return ensureQueueStoryRenderedAsset(tenantId, hydrated, { force: true });
};

export const enqueueAiMarketingQueueStoryAssetGeneration = async (tenantId, id, { force = false } = {}) => {
  await ensureAiMarketingCenterSchema();
  const current = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  const currentItem = current.rows[0] ? normalizeQueueRow(current.rows[0]) : null;
  if (!currentItem) {
    await logPublishQueueNotFound(tenantId, id, "story_asset_queue_not_found");
    throw serviceError("Queue item not found", 404, { queue_id: id, reason: "not_found_or_tenant_mismatch" });
  }
  if (!isStoryQueueItem(currentItem)) {
    throw serviceError("Queue item is not a story.", 400, { queue_id: id, content_type: currentItem.content_type || "" });
  }
  if (!force && isValidRenderedStoryAsset(currentItem, queueStoryFinalAssetUrl(currentItem))) {
    return { queued: false, reused: true, item: currentItem };
  }
  if (!force) {
    const design = currentItem.design_json || {};
    const reusable = await db.query(
      `
      SELECT *
      FROM ai_marketing_content_queue
      WHERE tenant_id = $1
        AND id <> $2
        AND content_type = $3
        AND product_id = $4
        AND COALESCE(strategy_type, '') = COALESCE($5, '')
        AND COALESCE(design_json->>'layout_type', '') = COALESCE($6, '')
        AND created_at::date = CURRENT_DATE
        AND final_asset_url <> ''
        AND status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [tenantId, id, currentItem.content_type, currentItem.product_id, currentItem.strategy_type || "", design.layout_type || ""]
    );
    const reusableItem = reusable.rows[0] ? normalizeQueueRow(reusable.rows[0]) : null;
    const reusableUrl = queueStoryFinalAssetUrl(reusableItem || {});
    if (reusableItem && isValidRenderedStoryAsset(reusableItem, reusableUrl)) {
      const nextDesign = {
        ...design,
        rendered_image_url: reusableUrl,
        story_image_url: reusableUrl,
        final_asset_url: reusableUrl,
        story_asset_renderer: AI_MARKETING_STORY_RENDERER,
      };
      const nextMetadata = {
        ...(currentItem.metadata || {}),
        rendered_image_url: reusableUrl,
        story_image_url: reusableUrl,
        final_asset_url: reusableUrl,
        story_asset_error: "",
        story_asset_reused_from_queue_id: reusableItem.id,
        story_asset_reused_at: new Date().toISOString(),
        story_asset_renderer: AI_MARKETING_STORY_RENDERER,
        generation_stage: "ready",
      };
      const updated = await db.query(
        `
        UPDATE ai_marketing_content_queue
        SET status = 'ready',
            rendered_image_url = $3,
            story_image_url = $3,
            final_asset_url = $3,
            image_url = $3,
            design_json = $4::jsonb,
            metadata = $5::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
        `,
        [id, tenantId, reusableUrl, JSON.stringify(nextDesign), JSON.stringify(nextMetadata)]
      );
      return { queued: false, reused: true, item: normalizeQueueRow(updated.rows[0]) };
    }
  }

  const queuedItem = await updateQueueGenerationStage(tenantId, id, "queued", {
    story_asset_error: "",
    story_asset_queued_at: new Date().toISOString(),
  });
  const queueState = enqueueGenerationJob({
    type: "story_asset",
    tenantId,
    queueId: id,
    label: `AI marketing story asset ${id}`,
    run: async () => {
      try {
        await updateQueueGenerationStage(tenantId, id, "generating_image");
        const hydratedCurrent = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
        const hydratedItem = hydratedCurrent.rows[0] ? normalizeQueueRow(hydratedCurrent.rows[0]) : null;
        if (!hydratedItem) throw serviceError("Queue item not found", 404);
        await updateQueueGenerationStage(tenantId, id, "uploading");
        await generateAiMarketingQueueStoryAsset(tenantId, id);
      } catch (error) {
        const latest = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
        const latestItem = latest.rows[0] ? normalizeQueueRow(latest.rows[0]) : queuedItem;
        await markQueueStoryRenderFailure(tenantId, latestItem, error);
        throw error;
      }
    },
  });
  return { queued: true, reused: false, item: queuedItem, ...queueState };
};

const logStoryPublishAsset = ({ item = {}, selectedPublishUrl = "", reason = "" } = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const productImageUrl = storyProductImageUrl(item);
  const finalAssetUrlRaw = cleanText(item.final_asset_url || design.final_asset_url || metadata.final_asset_url);
  const selectedPublishUrlRaw = rawStorySelectedPublishUrl(item);
  console.log("[story-publish-asset]", {
    queueId: item.id || null,
    productImageUrl,
    rendered_image_url: cleanText(item.rendered_image_url || design.rendered_image_url),
    story_image_url: cleanText(item.story_image_url || design.story_image_url),
    final_asset_url: finalAssetUrlRaw,
    final_asset_url_raw: finalAssetUrlRaw,
    selectedPublishUrl,
    selectedPublishUrl_raw: selectedPublishUrlRaw,
    selectedPublishUrl_valid: isPublicStoryAssetUrl(selectedPublishUrl),
    selectedPublishUrlReason: reason,
    contentType: item.content_type || "",
    layout: item.layout_type || design.layout_type || "",
  });
};

const assertStoryPublishAsset = (item = {}) => {
  const selectedPublishUrl = storySelectedPublishUrl(item);
  const selectedPublishUrlRaw = rawStorySelectedPublishUrl(item);
  const productImageUrl = storyProductImageUrl(item);
  const reason = selectedPublishUrl
    ? selectedPublishUrl === cleanText(item.final_asset_url || item.design_json?.final_asset_url)
      ? "final_asset_url"
      : selectedPublishUrl === cleanText(item.rendered_image_url || item.design_json?.rendered_image_url)
        ? "rendered_image_url"
        : "story_image_url"
    : "missing";
  logStoryPublishAsset({ item, selectedPublishUrl, reason });
  if (!selectedPublishUrl || !isValidRenderedStoryAsset(item, selectedPublishUrl) || sameImageUrl(selectedPublishUrl, productImageUrl)) {
    throw serviceError("Story asset not generated.", 409, {
      queue_id: item.id,
      product_image_url: productImageUrl,
      selected_publish_url: selectedPublishUrl,
      selected_publish_url_raw: selectedPublishUrlRaw,
      selected_publish_url_reason: reason,
    });
  }
  return selectedPublishUrl;
};

const persistQueuePublishResult = async ({ tenantId, id, item, result, platformResults, statusOverride = null, errorOverride = null }) => {
  const status = statusOverride || resultStatus(result);
  const publishedPlatforms = publishedPlatformsFromResults(platformResults);
  const platformPostId = result.platform_post_id || result.external_post_id || platformPostIdFromResults(platformResults);
  const publishedAt = result.published_at || (publishedPlatforms.length ? new Date().toISOString() : null);
  const errorMessage = errorOverride || result.error_message || null;
  const nextQueueStatus = status === "published" || status === "partial_success" ? "published" : "failed";
  const updated = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = $3::varchar,
        publish_status = $4::varchar,
        published_at = $5::timestamp,
        platform_post_id = $6::text,
        published_platforms = $7::jsonb,
        platform_publish_results = $8::jsonb,
        publish_error = $9::text,
        error_message = $9::text,
        metadata = metadata || $10::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2
    RETURNING *
    `,
    [
      id,
      tenantId,
      nextQueueStatus,
      status,
      publishedAt,
      platformPostId,
      JSON.stringify(publishedPlatforms),
      JSON.stringify(platformResults),
      errorMessage,
      JSON.stringify({ publish_adapter: "meta_existing_connection", source_status: item?.status || null }),
    ]
  );
  return updated.rows[0] ? normalizeQueueRow(updated.rows[0]) : null;
};

const getLastPieceInvalidReason = (variantStock = null) => {
  if (!variantStock) return "variant_missing";
  if (!variantStock.is_active || !variantStock.is_sellable) return "variant_not_sellable";
  if (variantStock.stock <= 0) return "stock_not_positive";
  if (variantStock.stock > 2) return "stock_above_last_piece_threshold";
  return "";
};

export const validateLastPieceQueueItem = async (tenantId, item = {}) => {
  if (item.strategy_type !== "last_size") return { valid: true, stock: null, reason: "" };
  if (!item.variant_id) return { valid: false, stock: null, reason: "missing_variant_id" };
  const stock = await getCurrentVariantStock(tenantId, item.variant_id);
  const productMismatch = stock?.product_id && item.product_id && String(stock.product_id) !== String(item.product_id);
  const reason = productMismatch ? "variant_product_mismatch" : getLastPieceInvalidReason(stock);
  const queueStock = numberValue(item.design_json?.stock ?? item.metadata?.stock ?? item.stock, null);
  logLastPieceValidation({
    product_id: stock?.product_id ?? item.product_id,
    variant_id: item.variant_id,
    color: stock?.color || item.color,
    size: stock?.size || item.size,
    queue_stock: queueStock,
    current_stock: stock?.stock ?? null,
    accepted: !reason,
    removed: Boolean(reason),
    reason: reason || "accepted_current_variant_stock",
  });
  return { valid: !reason, stock, reason };
};

const applyCurrentLastPieceStock = (item = {}, stock = null) => {
  if (!stock || item.strategy_type !== "last_size") return item;
  return normalizeQueueRow({
    ...item,
    color: stock.color || item.color,
    size: stock.size || item.size,
    design_json: {
      ...(item.design_json || {}),
      stock: stock.stock,
      color_name: stock.color || item.design_json?.color_name || item.color || "",
      size_name: stock.size || item.design_json?.size_name || item.size || null,
      variant_id: stock.variant_id || item.variant_id,
    },
    metadata: {
      ...(item.metadata || {}),
      last_piece_validated_at: new Date().toISOString(),
      current_variant_stock: stock.stock,
    },
  });
};

const clearInvalidLastPieceQueueItems = async (tenantId) => {
  const result = await db.query(
    `
    WITH checked AS (
      SELECT
        q.id,
        q.product_id,
        q.variant_id,
        q.color,
        q.size,
        q.design_json->>'stock' AS queue_stock,
        pv.stock AS resolved_stock,
        pv.color AS resolved_color,
        pv.size AS resolved_size,
        CASE
          WHEN q.variant_id IS NULL THEN 'missing_variant_id'
          WHEN pv.id IS NULL THEN 'variant_missing'
          WHEN pv.product_id IS DISTINCT FROM q.product_id THEN 'variant_product_mismatch'
          WHEN pv.is_active IS FALSE OR pv.deleted_at IS NOT NULL OR COALESCE(p.status, 'active') <> 'active' THEN 'variant_not_sellable'
          WHEN COALESCE(pv.stock, 0) <= 0 THEN 'stock_not_positive'
          WHEN COALESCE(pv.stock, 0) > 2 THEN 'stock_above_last_piece_threshold'
          ELSE ''
        END AS reason
      FROM ai_marketing_content_queue q
      LEFT JOIN product_variants pv
        ON pv.id = q.variant_id
      LEFT JOIN products p
        ON p.id = pv.product_id
       AND p.tenant_id = q.tenant_id
      WHERE q.tenant_id = $1
        AND q.strategy_type = 'last_size'
    ),
    deleted AS (
      DELETE FROM ai_marketing_content_queue q
      USING checked
      WHERE q.id = checked.id
        AND checked.reason <> ''
      RETURNING checked.*
    )
    SELECT * FROM deleted
    `,
    [tenantId]
  );
  result.rows.forEach((row) =>
    logLastPieceValidation({
      product_id: row.product_id,
      variant_id: row.variant_id,
      color: row.resolved_color || row.color,
      size: row.resolved_size || row.size,
      queue_stock: row.queue_stock,
      current_stock: row.resolved_stock,
      accepted: false,
      removed: true,
      reason: row.reason,
    })
  );
  return result.rows.length;
};

const departmentMatches = (product = {}, quota = {}) => {
  const target = cleanText(quota.department_name).toLowerCase();
  if (!target || target === "all") return true;
  return [product.gender, product.main_category, product.category_name, product.category].some((value) => cleanText(value).toLowerCase().includes(target));
};

const segmentMatches = (product = {}, quota = {}) => {
  const target = cleanText(quota.segment_name).toLowerCase();
  if (!target || target === "all") return true;
  return [product.grade, product.style, product.product_type, product.category_name, product.category, product.brand].some((value) => cleanText(value).toLowerCase().includes(target));
};

const loadProducts = async (tenantId) => {
  const result = await db.query(
    `
    SELECT
      p.id,
      p.name,
      p.slug,
      p.canonical_slug,
      p.image_url,
      p.gallery_images,
      p.price,
      p.regular_price,
      p.sale_price,
      p.sale_price_enabled,
      p.id AS product_freshness_rank,
      p.gender,
      p.product_type,
      p.style,
      p.grade,
      p.stock,
      p.low_stock_alert,
      c.id AS category_id,
      c.name AS category_name,
      b.name AS brand,
      pv.id AS variant_id,
      pv.color,
      pv.size,
      pv.article_code,
      pv.price AS variant_price,
      pv.sale_price AS variant_sale_price,
      pv.stock AS variant_stock,
      pv.is_active AS variant_is_active,
      pv.image_url AS variant_image_url,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', vi.id,
            'image_url', vi.image_url,
            'color_name', vi.color_name,
            'color_value', vi.color_value,
            'sort_order', vi.sort_order,
            'is_primary', vi.is_primary
          )
          ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
        )
        FROM product_variant_images vi
        WHERE vi.product_id = p.id
          AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
          AND (
            vi.variant_id = pv.id
            OR (vi.variant_id IS NULL AND LOWER(TRIM(vi.color_name)) = LOWER(TRIM(COALESCE(pv.color, ''))))
            OR LOWER(TRIM(vi.color_name)) = LOWER(TRIM(COALESCE(pv.color, '')))
          )
      ), '[]'::jsonb) AS variant_images
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active IS DISTINCT FROM FALSE AND pv.deleted_at IS NULL
    WHERE p.tenant_id = $1
      AND COALESCE(p.status, 'active') = 'active'
      AND COALESCE(pv.stock, 0) > 0
    ORDER BY p.id DESC, pv.color ASC NULLS LAST, pv.size ASC NULLS LAST
    LIMIT 2000
    `,
    [tenantId]
  );

  const byProduct = new Map();
  for (const row of result.rows) {
    const product = byProduct.get(row.id) || {
      id: row.id,
      name: row.name || "Product",
      slug: row.slug || row.canonical_slug || "",
      canonical_slug: row.canonical_slug || "",
      image_url: row.image_url || "",
      gallery_images: row.gallery_images,
      price: row.price,
      regular_price: row.regular_price,
      sale_price: row.sale_price,
      sale_price_enabled: row.sale_price_enabled,
      freshness_rank: numberValue(row.product_freshness_rank, row.id),
      gender: row.gender || "",
      product_type: row.product_type || "",
      style: row.style || "",
      grade: row.grade || "",
      stock: numberValue(row.stock, 0),
      low_stock_alert: numberValue(row.low_stock_alert, 0),
      category_id: row.category_id || null,
      category_name: row.category_name || row.category || "",
      brand: row.brand || "",
      variants: [],
    };
    if (row.variant_id) {
      const variantImages = normalizeJsonArray(row.variant_images, []);
      const primaryVariantImage = variantImages.find((image) => image?.is_primary)?.image_url || variantImages[0]?.image_url || "";
      product.variants.push({
        id: row.variant_id,
        color: row.color || "",
        size: row.size || "",
        article_code: row.article_code || "",
        price: row.variant_price,
        sale_price: row.variant_sale_price,
        stock: numberValue(row.variant_stock, 0),
        is_active: row.variant_is_active !== false,
        images: variantImages,
        image_url: primaryVariantImage || row.variant_image_url || "",
        variant_image_url: primaryVariantImage || row.variant_image_url || "",
        primary_image_url: primaryVariantImage || row.variant_image_url || "",
      });
    }
    byProduct.set(row.id, product);
  }
  return Array.from(byProduct.values());
};

const strategyForProduct = (product, settings, offset = 0) => {
  const active = Object.entries(settings.active_strategies).filter(([, enabled]) => enabled).map(([key]) => key);
  if (!active.length) return "new_arrivals";
  if (settings.active_strategies.last_size && product.variants.some(isLastPieceVariant)) return "last_size";
  return active[offset % active.length];
};

const repetitionLimit = (mode) => (mode === "aggressive" ? 3 : 1);

const loadTodayProductCounts = async (tenantId) => {
  const result = await db.query(
    `
    SELECT product_id, COUNT(*)::int AS count
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1
      AND product_id IS NOT NULL
      AND created_at::date = CURRENT_DATE
    GROUP BY product_id
    `,
    [tenantId]
  );
  return new Map(result.rows.map((row) => [Number(row.product_id), Number(row.count || 0)]));
};

const candidateProducts = (products, quota) => {
  const exact = products.filter((product) => departmentMatches(product, quota) && segmentMatches(product, quota));
  if (exact.length) return exact;
  const sameDepartment = products.filter((product) => departmentMatches(product, quota));
  return sameDepartment.length ? sameDepartment : products;
};

const expandProductCreatives = ({ product, contentType, quota, settings, strategy, remaining, forceAllVariants = true }) => {
  const hasVariantColors = product.variants.filter((variant) => cleanText(variant.color)).length > 1;
  const variants = hasVariantColors ? product.variants.filter((variant) => variant.stock > 0) : [product.variants.find((variant) => variant.stock > 0) || null];
  const selected = forceAllVariants && hasVariantColors ? variants : variants.slice(0, Math.max(remaining, 1));
  return selected.map((variant, index) => {
    const phrase = STRATEGY_TEXT[strategy]?.[index % (STRATEGY_TEXT[strategy]?.length || 1)] || "متوفر الآن";
    const cta = contentType === "story" ? "View details" : CTA_TEXT[(product.id + index) % CTA_TEXT.length];
    const imageUrl = getProductImage(product, variant || {});
    const price = getProductPrice(product, variant || {});
    const storyProductSlug = productSlug(product);
    const storyProductUrl = productUrl(product);
    const colorName = cleanText(variant?.color || "");
    const sizeName = cleanText(variant?.size || "") || null;
    const layoutType = contentType === "story" ? "simple_product_story" : "simple_product_post";
    const availableSizes = contentType === "story" ? availableSizesForVariantGroup(product, variant) : [];
    const audio = contentType === "story"
      ? selectTrendingAudioForStory({
        productName: product.name,
        categoryName: product.category_name || product.category || product.product_type || "",
        colorName,
        sizeName,
        lane: strategy,
        layoutType,
        contentType,
      })
      : null;
    const title = product.name;
    const captionProductLine = contentType === "story" ? product.name : `${product.name}${colorName ? ` - ${colorName}` : ""}`;
    const caption = `${phrase}\n${captionProductLine}\n${price ? `${price} EGP` : ""}\n${cta}`.trim();
    return {
      content_type: contentType,
      strategy_type: strategy,
      department_id: quota.department_id || null,
      department_name: quota.department_name || "",
      segment_type: quota.segment_type || "grade",
      segment_id: quota.segment_id || null,
      segment_name: quota.segment_name || "",
      product_id: product.id,
      variant_id: variant?.id || null,
      title,
      caption,
      image_url: imageUrl,
      product_url: storyProductUrl,
      design_json: withAvailableSizes({
        layout_type: layoutType,
        cta_text: contentType === "story" ? "View details" : cta,
        availability_text: contentType === "story" ? "Available now" : undefined,
        product_id: product.id,
        product_slug: storyProductSlug,
        product_name: product.name,
        image_url: imageUrl,
        product_url: storyProductUrl,
        cta_url: storyProductUrl,
        price,
        currency: "EGP",
        variant_id: variant?.id || null,
        color_name: colorName,
        size_name: sizeName,
        ...(audio ? { audio } : {}),
        background_style: settings.campaign_mode === "premium" ? "premium_dark" : "enterprise_dark",
        text_position_config: {
          canvas: contentType === "story" ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 },
          direction: "rtl",
          name: { top: 110, align: "center" },
          image: { top: 320, width: 900, height: 1020, fit: "contain" },
          price: { top: 1390, align: "center" },
          link: { bottom: 120, align: "center" },
        },
      }, availableSizes),
      metadata: {
        quota_id: quota.id,
        campaign_mode: settings.campaign_mode,
        source: "autonomous_ai_marketing_center",
      },
    };
  });
};

const buildLegacyGenerationPlan = async ({ tenantId, runType, settings }) => {
  const products = await loadProducts(tenantId);
  const counts = await loadTodayProductCounts(tenantId);
  const limit = repetitionLimit(settings.campaign_mode);
  const quotas = settings.daily_content_quotas.filter((quota) => quota.active !== false).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  const dayMultiplier = runType === "weekly" ? 7 : runType === "monthly" ? 30 : 1;
  const rows = [];

  for (const quota of quotas) {
    const targets = [
      { type: "story", count: positiveInt(quota.stories_per_day, 0) * dayMultiplier },
      { type: "post", count: positiveInt(quota.posts_per_day, 0) * dayMultiplier },
    ];
    const candidates = candidateProducts(products, quota);
    for (const target of targets) {
      let generatedForQuota = 0;
      let candidateIndex = 0;
      while (generatedForQuota < target.count && candidateIndex < candidates.length * 3) {
        const product = candidates[candidateIndex % candidates.length];
        candidateIndex += 1;
        if (!product) break;
        const used = counts.get(Number(product.id)) || 0;
        if (used >= limit) continue;
        const strategy = strategyForProduct(product, settings, candidateIndex);
        const creatives = expandProductCreatives({
          product,
          contentType: target.type,
          quota,
          settings,
          strategy,
          remaining: target.count - generatedForQuota,
          forceAllVariants: target.type === "story",
        });
        if (!creatives.length) continue;
        rows.push(...creatives);
        counts.set(Number(product.id), used + creatives.length);
        generatedForQuota += creatives.length;
      }
    }
  }

  return interleaveQueue(rows);
};

const interleaveQueue = (items = []) => {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.department_name || "All"}:${item.segment_name || "All"}:${item.content_type}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const orderedGroups = Array.from(groups.values());
  const output = [];
  let cursor = 0;
  while (orderedGroups.some((group) => group.length)) {
    const group = orderedGroups[cursor % orderedGroups.length];
    const next = group.shift();
    if (next) output.push(next);
    cursor += 1;
  }
  return output;
};

const POSTING_WINDOWS = [
  { id: "morning", start: 10 * 60, end: 12 * 60 },
  { id: "afternoon", start: 14 * 60, end: 17 * 60 },
  { id: "evening", start: 19 * 60, end: 21 * 60 },
  { id: "night", start: 22 * 60, end: 23 * 60 + 30 },
];

const INSIGHTS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const daysForRunType = (runType) => (runType === "monthly" ? 30 : runType === "weekly" ? 7 : 1);

const normalizePostingWindow = (window = {}, index = 0) => {
  const start = Math.max(0, Math.min(23 * 60 + 55, Math.round(numberValue(window.start, 0))));
  const end = Math.max(start + 20, Math.min(24 * 60 - 1, Math.round(numberValue(window.end, start + 90))));
  const dayOfWeek = window.day_of_week === null || window.day_of_week === undefined ? null : Math.max(0, Math.min(6, Math.round(numberValue(window.day_of_week, 0))));
  return {
    id: cleanText(window.id) || `insight-${index}`,
    start,
    end,
    day_of_week: dayOfWeek,
    score: numberValue(window.score, 0),
    source: cleanText(window.source || "fallback"),
    label: cleanText(window.label),
  };
};

const normalizePostingWindows = (windows = []) => {
  const normalized = normalizeJsonArray(windows, [])
    .map(normalizePostingWindow)
    .filter((window) => window.end > window.start);
  return normalized.length ? normalized : POSTING_WINDOWS.map((window, index) => normalizePostingWindow({ ...window, source: "fallback" }, index));
};

const cacheFresh = (row = null) => {
  if (!row?.last_synced_at) return false;
  const syncedAt = new Date(row.last_synced_at);
  const ttl = row.source === "fallback" ? 60 * 60 * 1000 : INSIGHTS_CACHE_TTL_MS;
  return !Number.isNaN(syncedAt.getTime()) && Date.now() - syncedAt.getTime() < ttl;
};

const normalizeInsightsCacheRow = (row = null) => {
  if (!row) return null;
  const bestWindows = normalizePostingWindows(row.best_windows);
  const engagementScores = normalizeJsonObject(row.engagement_scores, {});
  return {
    tenant_id: row.tenant_id,
    best_hours: normalizeJsonArray(row.best_hours, []),
    best_days: normalizeJsonArray(row.best_days, []),
    best_windows: bestWindows,
    engagement_scores: engagementScores,
    timezone: cleanText(row.timezone),
    source: cleanText(row.source || "fallback"),
    status: cleanText(engagementScores.status || (row.source === "fallback" ? "fallback" : "ready")),
    reason: cleanText(engagementScores.reason || engagementScores.warning || ""),
    warnings: normalizeJsonArray(engagementScores.warnings, []),
    last_synced_at: row.last_synced_at || null,
    labels: bestWindows.slice(0, 3).map((window) => cleanText(window.label)).filter(Boolean),
  };
};

const formatWindowLabel = (dayOfWeek, hour) => {
  const period = hour >= 18 ? "Night" : hour >= 12 ? "Afternoon" : "Morning";
  const displayHour = hour % 12 || 12;
  const suffix = hour >= 12 ? "PM" : "AM";
  const dayLabel = Number.isInteger(dayOfWeek) ? DAY_NAMES[dayOfWeek] || "" : "";
  return `${dayLabel} ${displayHour}:00 ${suffix}`.trim() || period;
};

const engagementScore = (row = {}) =>
  numberValue(row.engagement, 0) * 5 +
  numberValue(row.reach, 0) * 0.03 +
  numberValue(row.impressions, 0) * 0.01 +
  numberValue(row.post_count, 0);

const buildFallbackInsights = (timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "") => ({
  best_hours: POSTING_WINDOWS.map((window) => ({
    hour: Math.floor((window.start + window.end) / 120),
    score: 1,
    source: "fallback",
  })),
  best_days: [],
  best_windows: POSTING_WINDOWS.map((window, index) =>
    normalizePostingWindow({
      ...window,
      id: window.id,
      score: POSTING_WINDOWS.length - index,
      source: "fallback",
      label: cleanText(window.id),
    })
  ),
  engagement_scores: { source: "fallback", status: "fallback", reason: "No Meta engagement cache available" },
  timezone,
  source: "fallback",
});

const loadInsightsCache = async (tenantId) => {
  const result = await db.query(
    `
    SELECT *
    FROM ai_marketing_insights_cache
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

const upsertInsightsCache = async (tenantId, insights = {}) => {
  const result = await db.query(
    `
    INSERT INTO ai_marketing_insights_cache (
      tenant_id,
      best_hours,
      best_days,
      best_windows,
      engagement_scores,
      timezone,
      source,
      last_synced_at
    )
    VALUES ($1::bigint,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::text,CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id)
    DO UPDATE SET
      best_hours = EXCLUDED.best_hours,
      best_days = EXCLUDED.best_days,
      best_windows = EXCLUDED.best_windows,
      engagement_scores = EXCLUDED.engagement_scores,
      timezone = EXCLUDED.timezone,
      source = EXCLUDED.source,
      last_synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      tenantId,
      JSON.stringify(insights.best_hours || []),
      JSON.stringify(insights.best_days || []),
      JSON.stringify(insights.best_windows || []),
      JSON.stringify(insights.engagement_scores || {}),
      cleanText(insights.timezone),
      cleanText(insights.source || "fallback"),
    ]
  );
  return normalizeInsightsCacheRow(result.rows[0] || null);
};

const fetchMetaAccountInsightSignals = async ({ tenantId, settings, accessToken }) => {
  const warnings = [];
  const signals = { facebook: null, instagram: null, instagram_audience: null };
  const since = Math.floor((Date.now() - 28 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const pageId = cleanText(settings?.facebook_page_id || settings?.page_id);
  const instagramAccountId = cleanText(settings?.instagram_account_id);

  if (pageId) {
    try {
      signals.facebook = await callMetaGet({
        path: `/${encodeURIComponent(pageId)}/insights`,
        label: "facebook_page_activity_insights",
        params: {
          metric: "page_impressions,page_impressions_unique,page_post_engagements",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });
    } catch (error) {
      warnings.push(`Facebook Page insights unavailable: ${error?.message || "Meta request failed"}`);
      console.warn("[ai-center-meta-insights] facebook unavailable", { tenantId, error: error?.message });
    }
  }

  if (instagramAccountId) {
    try {
      signals.instagram = await callMetaGet({
        path: `/${encodeURIComponent(instagramAccountId)}/insights`,
        label: "instagram_account_activity_insights",
        params: {
          metric: "impressions,reach,profile_views",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });
    } catch (error) {
      warnings.push(`Instagram insights unavailable: ${error?.message || "Meta request failed"}`);
      console.warn("[ai-center-meta-insights] instagram unavailable", { tenantId, error: error?.message });
    }

    try {
      signals.instagram_audience = await callMetaGet({
        path: `/${encodeURIComponent(instagramAccountId)}/insights`,
        label: "instagram_audience_active_times",
        params: {
          metric: "online_followers",
          period: "lifetime",
          access_token: accessToken,
        },
      });
    } catch (error) {
      warnings.push(`Instagram audience active times unavailable: ${error?.message || "Meta request failed"}`);
      console.warn("[ai-center-meta-insights] instagram audience unavailable", { tenantId, error: error?.message });
    }
  }

  return { signals, warnings };
};

const missingMetaSettingsReasons = (settings = {}) => {
  const reasons = [];
  if (!cleanText(settings?.page_access_token || settings?.access_token_encrypted || settings?.access_token)) reasons.push("missing token");
  if (!cleanText(settings?.facebook_page_id || settings?.page_id)) reasons.push("missing page id");
  if (!cleanText(settings?.instagram_account_id)) reasons.push("missing instagram account id");
  return reasons;
};

const isPermissionError = (errorOrMessage = "") => {
  const message = String(errorOrMessage?.message || errorOrMessage || "").toLowerCase();
  const code = Number(errorOrMessage?.metaResponse?.error?.code || errorOrMessage?.metaResponse?.error?.error_subcode || 0);
  return message.includes("permission") || message.includes("insufficient") || message.includes("unsupported get request") || [10, 200, 2500].includes(code);
};

const extractOnlineFollowerHours = (payload = {}) => {
  const hours = new Map();
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const visit = (value, keyHint = "") => {
    if (typeof value === "number" && Number.isFinite(value)) {
      const hourMatch = String(keyHint).match(/(?:^|\D)([01]?\d|2[0-3])(?:\D|$)/);
      if (!hourMatch) return;
      const hour = Number(hourMatch[1]);
      hours.set(hour, (hours.get(hour) || 0) + value);
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => visit(child, key));
    }
  };
  entries.forEach((entry) => {
    (Array.isArray(entry?.values) ? entry.values : []).forEach((row) => visit(row?.value, row?.end_time || ""));
  });
  return Array.from(hours.entries())
    .map(([hour, score]) => ({ hour, score }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score);
};

const loadMetaEngagementBuckets = async (tenantId) => {
  const result = await db.query(
    `
    SELECT
      EXTRACT(DOW FROM COALESCE(p.published_at, p.created_at))::int AS day_of_week,
      EXTRACT(HOUR FROM COALESCE(p.published_at, p.created_at))::int AS hour,
      COUNT(*)::int AS post_count,
      COALESCE(SUM(COALESCE(a.likes, 0) + COALESCE(a.comments, 0) + COALESCE(a.shares, 0) + COALESCE(a.saves, 0) + COALESCE(a.clicks, 0)), 0)::int AS engagement,
      COALESCE(SUM(COALESCE(a.reach, 0)), 0)::int AS reach,
      COALESCE(SUM(COALESCE(a.impressions, 0)), 0)::int AS impressions
    FROM marketing_post_analytics a
    INNER JOIN marketing_posts p ON p.id = a.post_id
    WHERE p.tenant_id = $1::bigint
      AND COALESCE(p.published_at, p.created_at) >= NOW() - INTERVAL '120 days'
    GROUP BY 1, 2
    ORDER BY engagement DESC, impressions DESC, post_count DESC
    LIMIT 48
    `,
    [tenantId]
  );
  return result.rows || [];
};

const countMarketingAnalyticsRows = async (tenantId) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM marketing_post_analytics a
    INNER JOIN marketing_posts p ON p.id = a.post_id
    WHERE p.tenant_id = $1::bigint
    `,
    [tenantId]
  );
  return Number(result.rows[0]?.count || 0);
};

const countPublishedMarketingPosts = async (tenantId) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM marketing_posts
    WHERE tenant_id = $1::bigint
      AND (
        status = 'published'
        OR status = 'partial_success'
        OR published_at IS NOT NULL
        OR platform_post_id IS NOT NULL
        OR platform_publish_results <> '{}'::jsonb
      )
    `,
    [tenantId]
  );
  return Number(result.rows[0]?.count || 0);
};

const buildInsightWindowsFromBuckets = (buckets = []) => {
  const ranked = buckets
    .map((row) => ({ ...row, score: engagementScore(row) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;

  const bestHours = ranked.slice(0, 12).map((row) => ({
    day_of_week: Number(row.day_of_week),
    hour: Number(row.hour),
    score: row.score,
    engagement: Number(row.engagement || 0),
    reach: Number(row.reach || 0),
    impressions: Number(row.impressions || 0),
    source: "meta_post_analytics",
  }));
  const dayScores = new Map();
  ranked.forEach((row) => {
    const day = Number(row.day_of_week);
    dayScores.set(day, (dayScores.get(day) || 0) + row.score);
  });
  const bestDays = Array.from(dayScores.entries())
    .map(([day_of_week, score]) => ({ day_of_week, label: DAY_NAMES[day_of_week] || "", score }))
    .sort((left, right) => right.score - left.score);
  const bestWindows = bestHours.slice(0, 16).map((row, index) => {
    const hour = Number(row.hour);
    return normalizePostingWindow({
      id: `meta-${row.day_of_week}-${hour}-${index}`,
      day_of_week: row.day_of_week,
      start: Math.max(8 * 60, hour * 60 - 35),
      end: Math.min(23 * 60 + 45, hour * 60 + 55),
      score: row.score,
      source: "meta_post_analytics",
      label: formatWindowLabel(row.day_of_week, hour),
    });
  });

  return {
    best_hours: bestHours,
    best_days: bestDays,
    best_windows: bestWindows,
    engagement_scores: {
      source: "meta_post_analytics",
      bucket_count: buckets.length,
      top_score: ranked[0]?.score || 0,
    },
    source: "meta_post_analytics",
  };
};

const buildInsightWindowsFromAudienceSignals = (signals = {}) => {
  const activeHours = extractOnlineFollowerHours(signals.instagram_audience);
  if (!activeHours.length) return null;
  const bestHours = activeHours.slice(0, 12).map((row) => ({
    hour: row.hour,
    score: row.score,
    source: "instagram_audience_active_times",
  }));
  const bestWindows = bestHours.slice(0, 8).map((row, index) =>
    normalizePostingWindow({
      id: `ig-active-${row.hour}-${index}`,
      day_of_week: null,
      start: Math.max(8 * 60, row.hour * 60 - 30),
      end: Math.min(23 * 60 + 45, row.hour * 60 + 60),
      score: row.score,
      source: "instagram_audience_active_times",
      label: formatWindowLabel(null, row.hour),
    })
  );
  return {
    best_hours: bestHours,
    best_days: [],
    best_windows: bestWindows,
    engagement_scores: {
      source: "instagram_audience_active_times",
      bucket_count: activeHours.length,
      top_score: activeHours[0]?.score || 0,
    },
    source: "instagram_audience_active_times",
  };
};

export const syncAiMarketingPostingInsights = async ({ tenantId, force = false } = {}) => {
  await ensureAiMarketingCenterSchema();
  const cached = await loadInsightsCache(tenantId);
  if (!force && cacheFresh(cached)) return normalizeInsightsCacheRow(cached);

  const fallback = buildFallbackInsights();
  const fallbackWithReason = (reason, extra = {}) =>
    upsertInsightsCache(tenantId, {
      ...fallback,
      engagement_scores: {
        ...fallback.engagement_scores,
        ...extra,
        status: extra.status || "fallback",
        reason,
      },
    });

  try {
    const settings = await getMarketingSettingsRow(tenantId);
    const missingSettings = missingMetaSettingsReasons(settings);
    if (missingSettings.includes("missing token")) {
      return fallbackWithReason("missing token", { status: "missing_token", missing: missingSettings });
    }
    const validation = validateMetaToken(settings || {});
    let analyticsSync = null;
    try {
      analyticsSync = await syncMarketingAnalyticsForTenant({ tenantId });
    } catch (error) {
      console.warn("[ai-center-meta-insights] analytics sync failed", { tenantId, error: error?.message });
      analyticsSync = {
        skipped: true,
        reason: error?.message || "Marketing analytics sync failed",
        warnings: [error?.message || "Marketing analytics sync failed"],
      };
    }
    const metaSignals = await fetchMetaAccountInsightSignals({ tenantId, settings, accessToken: validation.accessToken });
    const buckets = await loadMetaEngagementBuckets(tenantId);
    const publishedPostsCount = await countPublishedMarketingPosts(tenantId);
    const derived = buildInsightWindowsFromBuckets(buckets) || buildInsightWindowsFromAudienceSignals(metaSignals.signals) || {};
    if (!derived.best_windows?.length) {
      const warnings = [...(analyticsSync?.warnings || []), ...(metaSignals.warnings || [])].filter(Boolean);
      const permissionMissing = warnings.some(isPermissionError);
      const reason = permissionMissing
        ? "Permission missing: insights permission required"
        : analyticsSync?.reason
          ? analyticsSync.reason
          : !buckets.length
            ? publishedPostsCount > 0 ? "No historical analytics yet" : "No published posts found"
            : missingSettings.includes("missing page id") && missingSettings.includes("missing instagram account id")
              ? "missing page id and missing instagram account id"
              : warnings[0] || "Meta API returned no insight windows";
      return fallbackWithReason(reason, {
        status: permissionMissing ? "permission_missing" : "no_insights",
        missing: missingSettings,
        warnings,
        analytics_sync: analyticsSync,
        published_posts_count: publishedPostsCount,
        meta_account_signals: metaSignals.signals,
      });
    }
    const next = {
      ...fallback,
      ...derived,
      engagement_scores: {
        ...fallback.engagement_scores,
        ...(derived.engagement_scores || {}),
        status: "ready",
        reason: "",
        analytics_sync: analyticsSync,
        published_posts_count: publishedPostsCount,
        meta_account_signals: metaSignals.signals,
        warnings: metaSignals.warnings,
        missing: missingSettings,
      },
      source: derived.source || (metaSignals.signals.facebook || metaSignals.signals.instagram ? "meta_account_insights" : "fallback"),
    };
    return upsertInsightsCache(tenantId, next);
  } catch (error) {
    console.warn("[ai-center-meta-insights] using fallback windows", { tenantId, error: error?.message || "Meta insights failed" });
    return fallbackWithReason(isPermissionError(error) ? "Permission missing: insights permission required" : error?.message || "Meta insights unavailable", {
      status: isPermissionError(error) ? "permission_missing" : "api_error",
      warning: error?.message || "Meta insights unavailable",
    });
  }
};

export const buildAiMarketingPostingInsightsResponse = async ({ tenantId, force = true } = {}) => {
  await ensureAiMarketingCenterSchema();
  const settings = await getMarketingSettingsRow(tenantId);
  const insights = await syncAiMarketingPostingInsights({ tenantId, force });
  const diagnosticsSource = normalizeJsonObject(insights?.engagement_scores, {});
  const warnings = normalizeJsonArray(insights?.warnings, diagnosticsSource.warnings || []);
  const fallbackReason = cleanText(insights?.reason || diagnosticsSource.reason || diagnosticsSource.warning || "");
  return {
    success: true,
    source: insights?.source || "fallback",
    windows: normalizePostingWindows(insights?.best_windows).filter((window) => (insights?.source || "fallback") !== "fallback" || window.source !== "fallback"),
    fallback_reason: insights?.source === "fallback" ? fallbackReason || "Using fallback" : "",
    message: insights?.source === "fallback" ? fallbackReason || "Using fallback" : "Using Instagram/Facebook insights",
    last_synced_at: insights?.last_synced_at || null,
    insights,
    diagnostics: {
      has_token: Boolean(cleanText(settings?.page_access_token || settings?.access_token_encrypted || settings?.access_token)),
      has_page_id: Boolean(cleanText(settings?.facebook_page_id || settings?.page_id)),
      has_instagram_account_id: Boolean(cleanText(settings?.instagram_account_id)),
      analytics_rows_count: await countMarketingAnalyticsRows(tenantId),
      published_posts_count: await countPublishedMarketingPosts(tenantId),
      permissions_error: insights?.status === "permission_missing" || warnings.some(isPermissionError),
      meta_error: insights?.status === "api_error" ? fallbackReason || "Meta API error" : "",
    },
  };
};

const getCachedAiMarketingPostingInsights = async (tenantId) => {
  await ensureAiMarketingCenterSchema();
  return normalizeInsightsCacheRow(await loadInsightsCache(tenantId));
};

const stableScheduleSeed = (...values) => {
  const text = values.map((value) => cleanText(value)).join(":");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const seededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
};

const scheduleDateAtMinutes = (baseDate, dayOffset, minutesOfDay) => {
  const date = new Date(baseDate.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(baseDate.getDate() + dayOffset);
  date.setMinutes(minutesOfDay);
  return date;
};

const minutesBetween = (left, right) => Math.abs(left.getTime() - right.getTime()) / 60000;

const windowUsageKey = (date, window = {}) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${window.id || "window"}`;

const contentTypeMinimumSpacing = (contentType = "story", rng = Math.random, relaxation = 0) => {
  const base = contentType === "post" ? 240 : 120;
  const jitter = Math.round(rng() * (contentType === "post" ? 60 : 120));
  return Math.max(35, Math.round((base + jitter) * relaxation));
};

const crossContentMinimumSpacing = (rng = Math.random, relaxation = 0) =>
  Math.max(25, Math.round((45 + rng() * 45) * relaxation));

const spacingRelaxationForAttempt = (attempt, runType) => {
  if (attempt < 90) return 1;
  if (attempt < 180) return runType === "daily" ? 0.55 : 0.7;
  if (attempt < 260) return runType === "daily" ? 0.35 : 0.5;
  return 0.2;
};

const validScheduleCandidate = ({ date, item, state, rng, attempt, runType, window }) => {
  const minuteKey = Math.floor(date.getTime() / 60000);
  const hourKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
  const usageKey = windowUsageKey(date, window);
  if (state.usedMinutes.has(minuteKey)) return false;
  const relaxation = spacingRelaxationForAttempt(attempt, runType);
  const hourLimit = item.content_type === "post" ? 1 : 2;
  if ((state.hourCounts.get(hourKey) || 0) >= hourLimit && attempt < 220) return false;
  if ((state.windowCounts.get(usageKey) || 0) >= (item.content_type === "post" ? 1 : 3) && attempt < 180) return false;

  const sameTypeSpacing = contentTypeMinimumSpacing(item.content_type, rng, relaxation);
  const crossTypeSpacing = crossContentMinimumSpacing(rng, relaxation);
  for (const previous of state.scheduled) {
    const diff = minutesBetween(date, previous.date);
    if (previous.contentType === item.content_type && diff < sameTypeSpacing) return false;
    if (previous.contentType !== item.content_type && diff < crossTypeSpacing) return false;
    if (diff < (attempt < 180 ? 20 : 10)) return false;
  }
  return true;
};

const weightedPick = (items = [], weightForItem = () => 1, rng = Math.random) => {
  if (!items.length) return null;
  const weights = items.map((item) => Math.max(0.1, Number(weightForItem(item)) || 0.1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = rng() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1];
};

const insightDayScoreMap = (days = []) => {
  const scores = new Map();
  normalizeJsonArray(days, []).forEach((row) => {
    const day = Number(row?.day_of_week);
    if (Number.isInteger(day) && day >= 0 && day <= 6) scores.set(day, Math.max(1, numberValue(row.score, 1)));
  });
  return scores;
};

const candidateDayOffsets = (state) => Array.from({ length: Math.max(1, state.days || 1) }, (_, index) => index);

const chooseDayOffset = ({ index, item, state, rng, attempt }) => {
  if ((state.days || 1) <= 1) return 0;
  const days = candidateDayOffsets(state);
  const seedOffset = stableScheduleSeed(index, item.content_type, item.product_id, item.variant_id, attempt) % days.length;
  const shuffled = days.map((day) => days[(day + seedOffset) % days.length]);
  return weightedPick(
    shuffled,
    (dayOffset) => {
      const date = scheduleDateAtMinutes(state.baseDate, dayOffset, 0);
      const dayScore = state.dayScores.get(date.getDay()) || 1;
      const densityPenalty = 1 + (state.dayCounts.get(dayOffset) || 0) * 1.35;
      const typePenalty = 1 + (state.dayTypeCounts.get(`${dayOffset}:${item.content_type}`) || 0) * 0.8;
      const spreadBoost = attempt < 100 && !state.dayCounts.has(dayOffset) ? 1.5 : 1;
      return (dayScore * spreadBoost) / (densityPenalty * typePenalty);
    },
    rng
  );
};

const chooseWindowForDay = ({ dayDate, item, state, rng }) => {
  const dayOfWeek = dayDate.getDay();
  const matching = state.postingWindows.filter((window) => window.day_of_week === null || window.day_of_week === dayOfWeek);
  const windows = matching.length ? matching : state.postingWindows;
  return weightedPick(
    windows,
    (window) => {
      const usage = state.windowCounts.get(windowUsageKey(dayDate, window)) || 0;
      const score = Math.max(1, numberValue(window.score, 1));
      const contentPenalty = item.content_type === "post" && usage > 0 ? 3 : 1;
      return score / ((1 + usage * 1.25) * contentPenalty);
    },
    rng
  );
};

const randomMinuteInWindow = (window = {}, rng = Math.random) => {
  const start = Math.max(0, Math.round(numberValue(window.start, 10 * 60)));
  const end = Math.max(start + 20, Math.round(numberValue(window.end, start + 90)));
  const guard = Math.min(14, Math.max(5, Math.floor((end - start) * 0.12)));
  const min = start + guard;
  const max = Math.max(min + 1, end - guard);
  return Math.min(end - 3, Math.max(start + 3, Math.round(min + rng() * (max - min))));
};

const createScheduleState = (runType = "daily", insights = null) => {
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);
  const useInsights = insights?.source && insights.source !== "fallback";
  return {
    baseDate,
    days: daysForRunType(runType),
    usedMinutes: new Set(),
    hourCounts: new Map(),
    dayCounts: new Map(),
    dayTypeCounts: new Map(),
    windowCounts: new Map(),
    scheduled: [],
    postingWindows: normalizePostingWindows(useInsights ? insights?.best_windows : POSTING_WINDOWS),
    dayScores: insightDayScoreMap(useInsights ? insights?.best_days : []),
    insightSource: cleanText(insights?.source || "fallback"),
  };
};

const scheduledTimeFor = (index, runType, item = {}, state = createScheduleState(runType)) => {
  const seed = stableScheduleSeed(runType, index, item.content_type, item.product_id, item.variant_id, item.strategy_type);
  const rng = seededRandom(seed || 1);
  const attempts = Math.max(320, (state.days || 1) * state.postingWindows.length * 12);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dayOffset = chooseDayOffset({ index, item, state, rng, attempt });
    const dayDate = scheduleDateAtMinutes(state.baseDate, dayOffset, 0);
    const window = chooseWindowForDay({ dayDate, item, state, rng });
    if (!window) continue;
    const minutesOfDay = randomMinuteInWindow(window, rng);
    const date = scheduleDateAtMinutes(state.baseDate, dayOffset, minutesOfDay);

    if (runType === "daily") {
      const minimum = new Date(Date.now() + 30 * 60 * 1000);
      if (date.getTime() < minimum.getTime()) {
        const minimumMinutes = minimum.getHours() * 60 + minimum.getMinutes();
        if (minimumMinutes < window.end - 5) {
          const nudgedMinutes = Math.min(window.end - 5, minimumMinutes + 7 + Math.round(rng() * 23));
          date.setHours(Math.floor(nudgedMinutes / 60), nudgedMinutes % 60, 0, 0);
        } else if (attempt < attempts - 1) {
          continue;
        } else {
          date.setHours(23, 45, 0, 0);
        }
      }
    }

    if (!validScheduleCandidate({ date, item, state, rng, attempt, runType, window })) continue;
    const minuteKey = Math.floor(date.getTime() / 60000);
    const hourKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    const usageKey = windowUsageKey(date, window);
    state.usedMinutes.add(minuteKey);
    state.hourCounts.set(hourKey, (state.hourCounts.get(hourKey) || 0) + 1);
    state.dayCounts.set(dayOffset, (state.dayCounts.get(dayOffset) || 0) + 1);
    state.dayTypeCounts.set(`${dayOffset}:${item.content_type}`, (state.dayTypeCounts.get(`${dayOffset}:${item.content_type}`) || 0) + 1);
    state.windowCounts.set(usageKey, (state.windowCounts.get(usageKey) || 0) + 1);
    state.scheduled.push({ date, contentType: item.content_type, windowId: window.id });
    date.postingWindow = window.id;
    date.dayOffset = dayOffset;
    date.insightSource = state.insightSource || window.source || "fallback";
    return date;
  }

  const fallbackDayOffset = chooseDayOffset({ index, item, state, rng, attempt: attempts });
  const fallbackDayDate = scheduleDateAtMinutes(state.baseDate, fallbackDayOffset, 0);
  const fallbackWindow = chooseWindowForDay({ dayDate: fallbackDayDate, item, state, rng }) || normalizePostingWindows()[0];
  const fallback = scheduleDateAtMinutes(state.baseDate, fallbackDayOffset, randomMinuteInWindow(fallbackWindow, rng));
  const minuteKey = Math.floor(fallback.getTime() / 60000);
  state.usedMinutes.add(minuteKey);
  state.scheduled.push({ date: fallback, contentType: item.content_type, windowId: fallbackWindow.id });
  fallback.postingWindow = fallbackWindow.id || "balanced";
  fallback.dayOffset = fallbackDayOffset;
  fallback.insightSource = state.insightSource || "fallback";
  return fallback;
};

const FOCUSED_CTA_TEXT = ["View details"];

const usableVariants = (product = {}) =>
  (product.variants || []).filter((variant) => variant?.is_active !== false && numberValue(variant.stock, 0) > 0);

const hasUsableImage = (product = {}, variant = {}) => Boolean(getProductImage(product, variant));

const contentCooldownHours = (contentType) => (contentType === "post" ? 72 : 24);

const loadCooldownRows = async (tenantId) => {
  const result = await db.query(
    `
    SELECT product_id, variant_id, content_type, MAX(created_at) AS last_created_at
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1
      AND product_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '72 hours'
    GROUP BY product_id, variant_id, content_type
    `,
    [tenantId]
  );
  return result.rows;
};

const buildCooldownState = (rows = []) => {
  const products = new Map();
  const variants = new Map();
  rows.forEach((row) => {
    const contentType = row.content_type || "story";
    const createdAt = new Date(row.last_created_at).getTime();
    products.set(`${contentType}:${row.product_id}`, Math.max(products.get(`${contentType}:${row.product_id}`) || 0, createdAt));
    if (row.variant_id) variants.set(`${contentType}:${row.variant_id}`, Math.max(variants.get(`${contentType}:${row.variant_id}`) || 0, createdAt));
  });
  return { products, variants };
};

const isInCooldown = (state, item, nowMs = Date.now()) => {
  const contentType = item.content_type || "story";
  const thresholdMs = contentCooldownHours(contentType) * 60 * 60 * 1000;
  const productTime = state.products.get(`${contentType}:${item.product_id}`) || 0;
  const variantTime = item.variant_id ? state.variants.get(`${contentType}:${item.variant_id}`) || 0 : 0;
  return nowMs - productTime < thresholdMs || nowMs - variantTime < thresholdMs;
};

const markCooldown = (state, item, nowMs = Date.now()) => {
  const contentType = item.content_type || "story";
  state.products.set(`${contentType}:${item.product_id}`, nowMs);
  if (item.variant_id) state.variants.set(`${contentType}:${item.variant_id}`, nowMs);
};

const itemKey = (item) => `${item.content_type}:${item.product_id}:${item.variant_id || 0}`;

const makeFocusedCreative = ({ product, variant, contentType, strategy, layoutType, quota, index = 0 }) => {
  const media = resolveAiContentMedia({ product, variant, strategy, contentType });
  const imageUrl = media.primary_image_url || getProductImage(product, variant || {});
  const price = getProductPrice(product, variant || {});
  const storyProductSlug = productSlug(product);
  const storyProductUrl = productUrl(product);
  const colorName = cleanText(variant?.color || "");
  const sizeName = cleanText(variant?.size || "");
  const availableSizes = contentType === "story" ? availableSizesForVariantGroup(product, variant) : [];
  const audio = contentType === "story"
    ? selectTrendingAudioForStory({
      productName: product.name,
      categoryName: product.category_name || product.category || product.product_type || product.style || "",
      colorName,
      sizeName,
      lane: strategy,
      layoutType,
      contentType,
    })
    : null;
  const headline = contentType === "story" ? "NEW COLLECTION" : strategy === "new_arrivals" ? "New arrival" : "AI product post";
  const cta = contentType === "story" ? "View details" : FOCUSED_CTA_TEXT[(Number(product.id || 0) + index) % FOCUSED_CTA_TEXT.length];
  const caption = [
    headline,
    contentType === "story" ? product.name : [product.name, [colorName, sizeName].filter(Boolean).join(" / ")].filter(Boolean).join(" - "),
    price ? `${price} EGP` : "",
    cta,
    contentType === "post" ? "#newarrival #sneakers #tigerstore" : "",
  ].filter(Boolean).join("\n");

  return {
    content_type: contentType,
    strategy_type: strategy,
    department_id: quota?.department_id || null,
    department_name: quota?.department_name || "All",
    segment_type: quota?.segment_type || "all",
    segment_id: quota?.segment_id || null,
    segment_name: quota?.segment_name || "All",
    product_id: product.id,
    variant_id: variant?.id || null,
    title: product.name,
    caption,
    image_url: imageUrl,
    media_urls: media.media_urls.length ? media.media_urls : uniqueImageUrls([imageUrl]),
    primary_image_url: imageUrl,
    variant_image_url: media.variant_image_url,
    color: colorName,
    size: sizeName,
    product_url: storyProductUrl,
    design_json: withAvailableSizes({
      layout_type: layoutType,
      cta_text: contentType === "story" ? "View details" : cta,
      availability_text: contentType === "story" ? "Available now" : undefined,
      product_id: product.id,
      product_slug: storyProductSlug,
      product_name: product.name,
      image_url: imageUrl,
      media_urls: media.media_urls.length ? media.media_urls : uniqueImageUrls([imageUrl]),
      primary_image_url: imageUrl,
      variant_image_url: media.variant_image_url,
      product_url: storyProductUrl,
      cta_url: storyProductUrl,
      price,
      currency: "EGP",
      variant_id: variant?.id || null,
      color_name: colorName,
      size_name: sizeName || null,
      stock: variant ? numberValue(variant.stock, 0) : null,
      ...(audio ? { audio } : {}),
      slides: media.media_urls.map((url, slideIndex) => {
        const slideVariant = usableVariants(product).find((row) => variantMediaUrls(row).includes(url)) || variant || null;
        const slideAvailableSizes = contentType === "story" ? availableSizesForVariantGroup(product, slideVariant) : [];
        return {
          image_url: url,
          cta_text: "View details",
          availability_text: "Available now",
          product_id: product.id,
          product_slug: storyProductSlug,
          product_url: storyProductUrl,
          cta_url: storyProductUrl,
          variant_id: slideVariant?.id || null,
          color_name: cleanText(slideVariant?.color || ""),
          size_name: cleanText(slideVariant?.size || ""),
          available_sizes: slideAvailableSizes,
          sizes_label: availableSizesLabel(slideAvailableSizes),
          slide_number: slideIndex + 1,
        };
      }),
      aspect_ratio: contentType === "post" ? "4:5" : "9:16",
      typography: contentType === "post" ? "premium_editorial" : "bold_story",
      cta,
      hashtags: contentType === "post" ? ["#newarrival", "#sneakers", "#tigerstore"] : [],
      text_position_config: {
        canvas: contentType === "story" ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 },
        direction: "rtl",
        name: { top: contentType === "story" ? 110 : 90, align: "center" },
        image: { top: contentType === "story" ? 320 : 260, width: contentType === "story" ? 900 : 880, height: contentType === "story" ? 1020 : 760, fit: "contain" },
        price: { top: contentType === "story" ? 1390 : 1080, align: "center" },
        link: { bottom: contentType === "story" ? 120 : 90, align: "center" },
      },
    }, availableSizes),
    metadata: {
      quota_id: quota?.id || "premium-engine",
      source: "ai_marketing_engine",
      engine_version: "focused-2026-05",
    },
  };
};

const buildLastPieceStories = (products, quota, limit) => {
  const candidates = [];
  for (const product of products) {
    for (const variant of product.variants || []) {
      const resolvedStock = numberValue(variant.stock, 0);
      const baseLog = {
        product_id: product.id,
        variant_id: variant.id,
        color: variant.color,
        size: variant.size,
        queue_stock: null,
        current_stock: resolvedStock,
      };
      if (variant?.is_active === false) {
        logLastPieceValidation({ ...baseLog, accepted: false, removed: false, reason: "skipped_inactive_variant" });
        continue;
      }
      if (resolvedStock <= 0) {
        logLastPieceValidation({ ...baseLog, accepted: false, removed: false, reason: "skipped_stock_not_positive" });
        continue;
      }
      if (resolvedStock > 2) {
        logLastPieceValidation({ ...baseLog, accepted: false, removed: false, reason: "skipped_stock_above_last_piece_threshold" });
        continue;
      }
      if (!hasUsableImage(product, variant)) {
        logLastPieceValidation({ ...baseLog, accepted: false, removed: false, reason: "skipped_no_media" });
        continue;
      }
      logLastPieceValidation({ ...baseLog, accepted: true, removed: false, reason: "accepted_current_variant_stock" });
      candidates.push({ product, variant });
    }
  }

  return candidates
    .sort((a, b) => numberValue(a.variant.stock, 0) - numberValue(b.variant.stock, 0))
    .slice(0, limit)
    .map(({ product, variant }, index) => makeFocusedCreative({ product, variant, contentType: "story", strategy: "last_size", layoutType: "last_piece_story", quota, index }));
};

const buildNewArrivalStories = (products, quota, limit) =>
  products
    .filter((product) => usableVariants(product).some((variant) => hasUsableImage(product, variant)))
    .sort((a, b) => numberValue(b.freshness_rank, b.id) - numberValue(a.freshness_rank, a.id))
    .slice(0, limit)
    .map((product, index) => {
      const variant = usableVariants(product).find((row) => hasUsableImage(product, row)) || null;
      return makeFocusedCreative({ product, variant, contentType: "story", strategy: "new_arrivals", layoutType: "new_arrival_story", quota, index });
    });

const buildAiPosts = (products, quota, limit) =>
  products
    .filter((product) => usableVariants(product).some((variant) => hasUsableImage(product, variant)))
    .sort((a, b) => {
      const aImages = usableVariants(a).filter((variant) => hasUsableImage(a, variant)).length;
      const bImages = usableVariants(b).filter((variant) => hasUsableImage(b, variant)).length;
      return bImages - aImages || numberValue(b.freshness_rank, b.id) - numberValue(a.freshness_rank, a.id);
    })
    .slice(0, limit)
    .map((product, index) => {
      const imageVariants = usableVariants(product).filter((variant) => hasUsableImage(product, variant));
      const variant = imageVariants[0] || null;
      const layoutType = imageVariants.length >= 3 && index % 2 === 1 ? "carousel_product_post" : "single_product_post";
      const item = makeFocusedCreative({ product, variant, contentType: "post", strategy: "ai_posts", layoutType, quota, index });
      if (layoutType === "carousel_product_post") {
        const usedImages = new Set();
        item.design_json.carousel = imageVariants
          .map((row) => ({
            variant_id: row.id,
            color_name: cleanText(row.color || ""),
            size_name: cleanText(row.size || ""),
            image_url: variantMediaUrls(row)[0] || "",
          }))
          .filter((slide) => {
            if (!slide.image_url || usedImages.has(slide.image_url.toLowerCase())) return false;
            usedImages.add(slide.image_url.toLowerCase());
            return true;
          })
          .slice(0, 5);
      }
      return item;
    });

const buildGenerationPlan = async ({ tenantId, runType, settings }) => {
  const products = await loadProducts(tenantId);
  const cooldownState = buildCooldownState(await loadCooldownRows(tenantId));
  const quota = (settings.daily_content_quotas || []).find((row) => row.active !== false) || DEFAULT_QUOTAS[0];
  const runMultiplier = runType === "monthly" ? 30 : runType === "weekly" ? 7 : 1;
  const storyLimit = Math.max(1, Math.min(positiveInt(settings.stories_per_day, 12) * runMultiplier, 360));
  const postLimit = Math.max(0, Math.min(positiveInt(settings.posts_per_day, 3) * runMultiplier, 90));
  const activeStrategies = normalizeFocusedStrategies(settings.active_strategies || {});
  const candidates = [
    ...(activeStrategies.last_size ? buildLastPieceStories(products, quota, storyLimit) : []),
    ...(activeStrategies.new_arrivals ? buildNewArrivalStories(products, quota, storyLimit) : []),
    ...(activeStrategies.ai_posts ? buildAiPosts(products, quota, postLimit) : []),
  ];
  const plan = [];
  const seen = new Set();

  for (const item of candidates) {
    if (!item.product_id || !item.image_url) continue;
    const key = itemKey(item);
    if (seen.has(key) || isInCooldown(cooldownState, item)) continue;
    seen.add(key);
    markCooldown(cooldownState, item);
    plan.push(item);
    const stories = plan.filter((row) => row.content_type === "story").length;
    const posts = plan.filter((row) => row.content_type === "post").length;
    if (stories >= storyLimit && posts >= postLimit) break;
  }

  return plan;
};

export const enqueueAiMarketingBatchGeneration = async ({ tenantId, runType = "daily" } = {}) => {
  await ensureAiMarketingCenterSchema();
  const settings = await getAiMarketingSettings(tenantId);
  const requestedStories = settings.daily_content_quotas.reduce((sum, row) => sum + (row.active === false ? 0 : positiveInt(row.stories_per_day, 0)), 0) * (runType === "weekly" ? 7 : runType === "monthly" ? 30 : 1);
  const requestedPosts = settings.daily_content_quotas.reduce((sum, row) => sum + (row.active === false ? 0 : positiveInt(row.posts_per_day, 0)), 0) * (runType === "weekly" ? 7 : runType === "monthly" ? 30 : 1);
  const run = await db.query(
    `
    INSERT INTO ai_marketing_generation_runs (tenant_id, run_type, status, requested_stories, requested_posts, metadata)
    VALUES ($1,$2,'queued',$3,$4,$5::jsonb)
    RETURNING *
    `,
    [tenantId, runType, requestedStories, requestedPosts, JSON.stringify({ settings_id: settings.id, queue_stage: "queued" })]
  );
  const runId = run.rows[0].id;
  const queueState = enqueueGenerationJob({
    type: "batch",
    tenantId,
    runId,
    label: `AI marketing ${runType} batch`,
    run: () => generateAiMarketingBatch({ tenantId, runType, runId }),
  });
  return { run_id: runId, run_status: "queued", requested_stories: requestedStories, requested_posts: requestedPosts, ...queueState };
};

export const generateAiMarketingBatch = async ({ tenantId, runType = "daily", runId: existingRunId = null } = {}) => {
  await ensureAiMarketingCenterSchema();
  await clearInvalidLastPieceQueueItems(tenantId);
  const settings = await getAiMarketingSettings(tenantId);
  const requestedStories = settings.daily_content_quotas.reduce((sum, row) => sum + (row.active === false ? 0 : positiveInt(row.stories_per_day, 0)), 0) * (runType === "weekly" ? 7 : runType === "monthly" ? 30 : 1);
  const requestedPosts = settings.daily_content_quotas.reduce((sum, row) => sum + (row.active === false ? 0 : positiveInt(row.posts_per_day, 0)), 0) * (runType === "weekly" ? 7 : runType === "monthly" ? 30 : 1);
  let runId = existingRunId;
  if (runId) {
    await db.query(
      `
      UPDATE ai_marketing_generation_runs
      SET status = 'running',
          metadata = metadata || $2::jsonb
      WHERE id = $1 AND tenant_id = $3
      `,
      [runId, JSON.stringify({ queue_stage: "generating_copy", started_at: new Date().toISOString() }), tenantId]
    );
  } else {
    const run = await db.query(
      `
      INSERT INTO ai_marketing_generation_runs (tenant_id, run_type, status, requested_stories, requested_posts, metadata)
      VALUES ($1,$2,'running',$3,$4,$5::jsonb)
      RETURNING *
      `,
      [tenantId, runType, requestedStories, requestedPosts, JSON.stringify({ settings_id: settings.id })]
    );
    runId = run.rows[0].id;
  }

  try {
    const plan = await buildGenerationPlan({ tenantId, runType, settings });
    const status = "ready";
    const inserted = [];
    const postingInsights = await syncAiMarketingPostingInsights({ tenantId });
    const scheduleState = createScheduleState(runType, postingInsights);
    for (let index = 0; index < plan.length; index += 1) {
      let item = plan[index];
      if (item.strategy_type === "last_size") {
        const validation = await validateLastPieceQueueItem(tenantId, item);
        if (!validation.valid) continue;
        item = applyCurrentLastPieceStock(item, validation.stock);
      }
      const scheduledAt = scheduledTimeFor(index, runType, item, scheduleState);
      console.log("[ai-center-schedule-assignment]", {
        run_type: runType,
        item_index: index,
        content_type: item.content_type,
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        day_index: scheduledAt.dayOffset ?? null,
        posting_window: scheduledAt.postingWindow || "",
        insight_source: scheduledAt.insightSource || "fallback",
        scheduled_at: scheduledAt.toISOString(),
      });
      const scheduledDesign = {
        ...(item.design_json || {}),
        scheduled_at: scheduledAt.toISOString(),
        best_posting_time: scheduledAt.toISOString(),
        posting_window: scheduledAt.postingWindow || "",
        posting_insight_source: scheduledAt.insightSource || "fallback",
      };
      const result = await db.query(
        `
        INSERT INTO ai_marketing_content_queue (
          tenant_id, content_type, strategy_type, department_id, department_name, segment_type, segment_id, segment_name,
          product_id, variant_id, title, caption, image_url, media_urls, primary_image_url, variant_image_url, color, size,
          product_url, design_json, status, scheduled_at, metadata
        )
        SELECT $1::bigint,$2::varchar,$3::varchar,$4::bigint,$5::text,$6::varchar,$7::bigint,$8::text,$9::bigint,$10::bigint,$11::text,$12::text,$13::text,$14::jsonb,$15::text,$16::text,$17::text,$18::text,$19::text,$20::jsonb,$21::varchar,$22::timestamp,$23::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM ai_marketing_content_queue existing
          WHERE existing.tenant_id = $1
            AND existing.content_type = $2::varchar
            AND existing.product_id = $9
            AND COALESCE(existing.variant_id, 0) = COALESCE($10::bigint, 0)
            AND existing.created_at::date = CURRENT_DATE
        )
        RETURNING *
        `,
        [
          tenantId,
          item.content_type,
          item.strategy_type,
          item.department_id,
          item.department_name,
          item.segment_type,
          item.segment_id,
          item.segment_name,
          item.product_id,
          item.variant_id,
          item.title,
          item.caption,
          item.image_url,
          JSON.stringify(uniqueImageUrls(item.media_urls || [item.primary_image_url, item.image_url])),
          item.primary_image_url || item.image_url || "",
          item.variant_image_url || "",
          item.color || "",
          item.size || "",
          item.product_url,
          JSON.stringify(scheduledDesign),
          status,
          scheduledAt,
          JSON.stringify({
            ...item.metadata,
            run_id: runId,
            generation_stage: "ready",
            approval_required: settings.require_approval !== false,
            next_status_after_ready: settings.require_approval ? "pending_approval" : "scheduled",
          }),
        ]
      );
      if (result.rows[0]) inserted.push(normalizeQueueRow(result.rows[0]));
    }

    const generatedStories = inserted.filter((item) => item.content_type === "story").length;
    const generatedPosts = inserted.filter((item) => item.content_type === "post").length;
    await db.query(
      `
      UPDATE ai_marketing_generation_runs
      SET status = 'completed',
          generated_stories = $2,
          generated_posts = $3,
          failed_count = 0,
          finished_at = CURRENT_TIMESTAMP,
          metadata = metadata || $4::jsonb
      WHERE id = $1
      `,
      [
        runId,
        generatedStories,
        generatedPosts,
        JSON.stringify({
          generated_count: inserted.length,
          posting_insight_source: postingInsights?.source || "fallback",
          best_posting_windows: postingInsights?.best_windows?.slice(0, 5) || [],
        }),
      ]
    );
    return { run_id: runId, generated_stories: generatedStories, generated_posts: generatedPosts, rows: inserted };
  } catch (error) {
    console.error("[ai-daily-generate-query-error]", error);
    await db.query(
      `
      UPDATE ai_marketing_generation_runs
      SET status = 'failed',
          failed_count = 1,
          finished_at = CURRENT_TIMESTAMP,
          metadata = metadata || $2::jsonb
      WHERE id = $1
      `,
      [runId, JSON.stringify({ error: error?.message || "Generation failed" })]
    );
    throw error;
  }
};

const VIDEO_LANES = [
  { strategy_type: "new_arrival_video", layout_type: "new_arrival_video", label: "New Arrivals Video" },
  { strategy_type: "last_piece_video", layout_type: "last_piece_video", label: "Last Piece Video" },
  { strategy_type: "product_video", layout_type: "product_video", label: "Product Promo Video" },
  { strategy_type: "offer_video", layout_type: "offer_video", label: "Offer Video" },
];

const videoLaneForIndex = (index = 0) => VIDEO_LANES[index % VIDEO_LANES.length];

const VIDEO_TEMPLATE_PRESETS = {
  sneakers_hype_reel: {
    name: "Sneakers Hype Reel",
    colors: ["#050816", "#22d3ee", "#facc15", "#ffffff"],
    hookText: "NEW DROP",
    motionStyle: "snap zooms + diagonal product pans + kinetic captions",
    transitionStyle: "white flash + whip pan cuts",
    captionTone: "streetwear hype, short punchy lines",
    pacing: "fast 2-3 second beat cuts",
    reelEnergy: "hype athletic",
  },
  last_piece_urgency_reel: {
    name: "Last Piece Urgency Reel",
    colors: ["#09090b", "#fb7185", "#fbbf24", "#ffffff"],
    hookText: "LAST PIECE",
    motionStyle: "fast punch-in + shake hits + stock pulse",
    transitionStyle: "red flash + hard zoom cuts",
    captionTone: "urgent scarce-stock callouts",
    pacing: "aggressive short scenes",
    reelEnergy: "high urgency",
  },
  luxury_reveal_reel: {
    name: "Luxury Reveal Reel",
    colors: ["#050505", "#d6b46a", "#f8fafc", "#1f2937"],
    hookText: "LUXURY REVEAL",
    motionStyle: "slow reveal push + soft parallax + elegant text rise",
    transitionStyle: "soft fade + light sweep",
    captionTone: "premium minimal product story",
    pacing: "controlled cinematic reveal",
    reelEnergy: "premium cinematic",
  },
  offer_blast_reel: {
    name: "Offer Blast Reel",
    colors: ["#07111f", "#38bdf8", "#f97316", "#ffffff"],
    hookText: "LIMITED OFFER",
    motionStyle: "flash cuts + price bounce + CTA pulse",
    transitionStyle: "flash pop + zoom cut",
    captionTone: "bold offer-first conversion copy",
    pacing: "fast sale reveal",
    reelEnergy: "offer blast",
  },
};

const videoPresetForLane = (lane = {}, product = {}) => {
  if (lane.strategy_type === "last_piece_video") return VIDEO_TEMPLATE_PRESETS.last_piece_urgency_reel;
  if (lane.strategy_type === "offer_video") return VIDEO_TEMPLATE_PRESETS.offer_blast_reel;
  const text = normalizedSearchText(lane.strategy_type, lane.layout_type, lane.label, product.category_name, product.brand, product.product_type, product.style, product.name);
  if (/(luxury|watch|perfume|women|female|dress|bag)/i.test(text)) return VIDEO_TEMPLATE_PRESETS.luxury_reveal_reel;
  return VIDEO_TEMPLATE_PRESETS.sneakers_hype_reel;
};

const chooseSceneImages = ({ product = {}, variant = null, media = {} } = {}) => {
  const pool = videoSceneImagePool({ product, variant });
  const mainImage = pool.primaryImage || media.primary_image_url || product.image_url || "";
  const selectedVariantImages = pool.selectedVariantImages.length ? pool.selectedVariantImages : (Array.isArray(media.variant_media_urls) ? media.variant_media_urls : []);
  const productImages = pool.productImages.length ? pool.productImages : (Array.isArray(media.product_media_urls) ? media.product_media_urls : []);
  const matchingVariantImages = pool.matchingVariantImages.length ? pool.matchingVariantImages : selectedVariantImages;
  const fallbackImages = uniqueImageUrls([mainImage, ...matchingVariantImages, ...productImages, ...pool.fallbackVariantImages]);
  const takeImage = (preferred = [], fallbackIndex = 0, previous = "") => {
    const candidates = uniqueImageUrls(preferred).concat(fallbackImages);
    const nonRepeating = candidates.find((image) => image && image.toLowerCase() !== cleanText(previous).toLowerCase());
    return nonRepeating || candidates.find(Boolean) || mainImage || "";
  };

  const sceneImages = [];
  sceneImages[0] = takeImage([mainImage, matchingVariantImages[0], productImages[0]], 0);
  sceneImages[1] = takeImage([matchingVariantImages[1], productImages[1], fallbackImages[1]], 1, sceneImages[0]);
  sceneImages[2] = takeImage([matchingVariantImages[2], selectedVariantImages[1], productImages[2], fallbackImages[2]], 2, sceneImages[1]);
  sceneImages[3] = takeImage([productImages[2], matchingVariantImages[3], productImages[1], fallbackImages[3]], 3, sceneImages[2]);
  sceneImages[4] = takeImage([productImages[3], productImages[4], matchingVariantImages[4], fallbackImages[4]], 4, sceneImages[3]);
  sceneImages[5] = takeImage([mainImage, matchingVariantImages[0], productImages[0]], 0, sceneImages[4]);
  return sceneImages;
};

const buildReadinessChecks = ({ sceneImages = [], hookCopy = "", price = 0, audio = null } = {}) => ({
  uses_multiple_images: uniqueImageUrls(sceneImages).length > 1,
  has_hook: Boolean(cleanText(hookCopy)),
  has_cta: true,
  has_price: Boolean(price),
  has_audio_suggestion: Boolean(audio && Object.keys(audio).length),
});

const qualityScoreFromChecks = (checks = {}) => {
  const weights = {
    uses_multiple_images: 25,
    has_hook: 20,
    has_cta: 20,
    has_price: 20,
    has_audio_suggestion: 15,
  };
  return Object.entries(weights).reduce((score, [key, weight]) => score + (checks[key] ? weight : 0), 0);
};

const legacyVideoPresetName = (presetName = "") => {
  if (presetName === "Sneakers Hype Reel") return "Trendy Sneakers Reel";
  if (presetName === "Last Piece Urgency Reel") return "Last Piece Urgency";
  if (presetName === "Offer Blast Reel") return "Offer Blast";
  if (presetName === "Luxury Reveal Reel") return "Luxury Reveal";
  return presetName || "Sneakers Hype Reel";
};

const buildProfessionalVideoScenes = ({ product = {}, variant = null, lane = VIDEO_LANES[0], preset = VIDEO_TEMPLATE_PRESETS.sneakers_hype_reel, sceneImages = [], priceCaption = "", variantCaption = "", sizesLabel = "", price = 0 } = {}) => {
  const urgencyCaption = lane.strategy_type === "last_piece_video"
    ? [variant?.size ? `Size ${variant.size}` : "", "last piece"].filter(Boolean).join(" - ") || "Only one left"
    : sizesLabel
      ? `Sizes ready: ${sizesLabel}`
      : "Available now";
  const definitions = [
    ["hook_stop_scroll", "hook", "Hook / Stop Scroll", preset.hookText, 1.8, "white flash into whip pan", "1.35x punch zoom, micro shake, background flash", "kinetic text flash", "hook_flash_shake", `${preset.hookText} stop-scroll hook`],
    ["product_hero", "product", "Hero Angle", product.name || "Product hero", 2.8, "whip pan zoom cut", "1.05x to 1.38x zoom-in with left parallax pan", "spotlight glow + shadow lift", "product_hero_parallax", "Large product reveal with zoom-in"],
    ["detail_variant", "detail", "Detail / Variant", variantCaption, 2.4, "blur-to-focus swipe", "cropped 1.55x detail push with tilt", "detail crop focus", "detail_crop_push", variantCaption],
    ["price_pop", "price", "Price Pop", priceCaption, 2.4, "flash pop cut", "product dips back while price card bounces 0.85x to 1.12x", "price card bounce", "price_bounce_pop", priceCaption],
    ["stock_urgency", "urgency", "Stock / Size Push", urgencyCaption, 2.3, "glow flash", "side pan, badge pulse, quick tilt", "stock badge pulse", "urgency_light_sweep", urgencyCaption],
    ["cta_close", "cta", "CTA Close", price ? "Shop before it sells out" : "View details", 2.5, "clean fade + final flash", "center lockup with CTA pulse and final scale-in", "CTA glow pulse", "cta_glow_pulse", "View details"],
  ];
  let cursor = 0;
  return definitions.map(([id, role, title, caption, duration, transition, motion, effect, animationPreset, visual], index) => {
    const start = Number(cursor.toFixed(2));
    cursor += duration;
    return {
      id,
      role,
      label: `Scene ${index + 1}`,
      title,
      caption,
      image_url: sceneImages[index] || sceneImages[0] || "",
      image_focus: uniqueImageUrls(sceneImages).length === 1 ? (videoSingleImageFallbacks[index]?.focus || "product focus") : role,
      crop: uniqueImageUrls(sceneImages).length === 1 ? (videoSingleImageFallbacks[index]?.crop || "scene crop") : "scene crop",
      zoom: uniqueImageUrls(sceneImages).length === 1 ? (videoSingleImageFallbacks[index]?.zoom || "medium") : (role === "detail_variant" ? "close" : "medium"),
      background_treatment: uniqueImageUrls(sceneImages).length === 1 ? (videoSingleImageFallbacks[index]?.background || "blurred backdrop") : "scene image background",
      start,
      end: Number(cursor.toFixed(2)),
      scene_duration: duration,
      duration_seconds: duration,
      duration,
      transition,
      motion,
      effect,
      animation_preset: animationPreset,
      visual,
    };
  });
};

const buildVideoQueueItem = ({ product = {}, variant = null, lane = VIDEO_LANES[0], index = 0 } = {}) => {
  const media = resolveAiContentMedia({ product, variant, strategy: "video", contentType: "video" });
  const imageUrl = media.primary_image_url || product.image_url || "";
  const price = getProductPrice(product, variant || {});
  const url = productUrl(product);
  const availableSizes = availableSizesForVariantGroup(product, variant);
  const sizesLabel = availableSizesLabel(availableSizes);
  const preset = videoPresetForLane(lane, product);
  const hookCopy = preset.hookText;
  const audio = selectTrendingAudioForVideo({
    productName: product.name,
    categoryName: product.category_name,
    colorName: variant?.color,
    sizeName: variant?.size,
    lane: lane.strategy_type,
    layoutType: lane.layout_type,
    reelType: lane.label,
    templatePreset: preset.name,
    hookStyle: hookCopy,
  });
  const title = `${lane.label}: ${product.name || "Product"}`;
  const variantCaption = [variant?.color, sizesLabel].filter(Boolean).join(" | ") || "Available variants";
  const priceCaption = price ? `${price} EGP` : "Price available in store";
  const sceneImages = chooseSceneImages({ product, variant, media });
  const scenes = buildProfessionalVideoScenes({ product, variant, lane, preset, sceneImages, priceCaption, variantCaption, sizesLabel, price });
  const durationSeconds = scenes.reduce((total, scene) => total + Number(scene.duration || scene.scene_duration || 0), 0);
  const videoMediaUrls = uniqueImageUrls([imageUrl, ...scenes.map((scene) => scene.image_url), ...media.media_urls]);
  const readinessChecks = buildReadinessChecks({ sceneImages, hookCopy, price, audio });
  const qualityScore = qualityScoreFromChecks(readinessChecks);
  const script = [
    `0.0s: ${hookCopy}.`,
    `${scenes[1].start.toFixed(1)}s: ${product.name || "Product hero"}.`,
    `${scenes[2].start.toFixed(1)}s: ${variantCaption}.`,
    `${scenes[3].start.toFixed(1)}s: ${priceCaption}.`,
    `${scenes[4].start.toFixed(1)}s: ${scenes[4].caption}.`,
    `${scenes[5].start.toFixed(1)}s: View details.`,
  ].join("\n");
  return {
    content_type: "video",
    strategy_type: lane.strategy_type,
    department_id: null,
    department_name: "All",
    segment_type: "all",
    segment_id: null,
    segment_name: "All",
    product_id: product.id,
    variant_id: variant?.id || null,
    title,
    caption: `${product.name || "Featured product"}\n${script}`,
    image_url: imageUrl,
    media_urls: videoMediaUrls,
    primary_image_url: imageUrl,
    variant_image_url: variant?.variant_image_url || variant?.image_url || "",
    color: variant?.color || "",
    size: variant?.size || "",
    product_url: url,
    metadata: { mvp_video_queue: true },
    design_json: {
      content_type: "video",
      layout_type: lane.layout_type,
      strategy_type: lane.strategy_type,
      video_status: "pending_generation",
      video_url: "",
      duration_seconds: durationSeconds,
      duration_presets: [12, 15, 18],
      preset: legacyVideoPresetName(preset.name),
      template_preset: preset.name,
      template_config: preset,
      aspect_ratio: "9:16",
      reel_type: lane.label,
      reel_energy: preset.reelEnergy,
      estimated_engagement: lane.strategy_type === "last_piece_video" ? "High" : "Medium-high",
      hook_strength: lane.strategy_type === "last_piece_video" ? 94 : 88,
      pacing_score: lane.strategy_type === "last_piece_video" ? 93 : 90,
      cta_strength: lane.strategy_type === "offer_video" ? 89 : 84,
      trend_fit_score: preset.name === "Sneakers Hype Reel" ? 92 : 86,
      motion_style: preset.motionStyle,
      transition_style: preset.transitionStyle,
      caption_tone: preset.captionTone,
      pacing: preset.pacing,
      scenes,
      transitions: scenes.slice(1).map((scene, sceneIndex) => ({
        from: scenes[sceneIndex]?.id,
        to: scene.id,
        type: scene.transition,
        at_second: scene.start,
      })),
      beat_markers: [0, 0.35, 0.9, 1.8, 3.2, 4.6, 6.1, 7.4, 8.2, 9.8, 11.2, 12.8, 13.8],
      waveform_hint: "upbeat Arabic reel waveform with hook hits and CTA close",
      animation_presets: scenes.map((scene) => scene.animation_preset),
      audio_sync_points: [
        { second: 0, beat: "hook_hit", scene_id: "hook_stop_scroll" },
        { second: scenes[1].start, beat: "zoom_cut", scene_id: "product_hero" },
        { second: scenes[3].start, beat: "price_pop", scene_id: "price_pop" },
        { second: scenes[5].start, beat: "cta_in", scene_id: "cta_close" },
      ],
      hook_frame: { second: 0, text: hookCopy, style: "kinetic_reel_hook" },
      outro_frame: { second: durationSeconds - 1, text: "View details", style: "cta_close" },
      captions_timeline: scenes.map((scene) => ({
        start_second: scene.start,
        end_second: scene.end,
        text: scene.caption || scene.visual,
      })),
      caption_timeline: scenes.map((scene) => ({
        start_second: scene.start,
        end_second: scene.end,
        text: scene.caption || scene.visual,
      })),
      platform_targets: ["Instagram", "Facebook", "TikTok later"],
      product_id: product.id,
      product_slug: productSlug(product),
      product_name: product.name || "",
      product_url: url,
      cta_url: url,
      cta_text: "View details",
      image_url: imageUrl,
      media_urls: videoMediaUrls,
      price,
      currency: "EGP",
      color_name: variant?.color || "",
      size_name: variant?.size || "",
      available_sizes: availableSizes,
      sizes_label: sizesLabel,
      title,
      script,
      caption: `${product.name || "Featured product"}\n${script}`,
      audio,
      quality_score: qualityScore,
      readiness_checks: readinessChecks,
      future_ready: {
        mp4_generation: true,
        beat_sync: true,
        captions: true,
        templates: ["sneakers/sports", "luxury", "women", "watches", "perfumes"],
        publishing: ["instagram_reels", "facebook_reels", "tiktok"],
      },
    },
    sort_index: index,
  };
};

export const generateAiMarketingVideoBatch = async ({ tenantId, runType = "daily", videosPerDay = 4 } = {}) => {
  await ensureAiMarketingCenterSchema();
  const products = await loadProducts(tenantId);
  const runMultiplier = runType === "monthly" ? 30 : runType === "weekly" ? 7 : 1;
  const limit = Math.max(1, Math.min(positiveInt(videosPerDay, 4) * runMultiplier, 120));
  const candidates = products
    .filter((product) => hasUsableImage(product, usableVariants(product)[0] || null))
    .slice(0, Math.max(limit * 2, limit));
  const postingInsights = await syncAiMarketingPostingInsights({ tenantId });
  const scheduleState = createScheduleState(runType, postingInsights);
  const inserted = [];

  for (let index = 0; index < candidates.length && inserted.length < limit; index += 1) {
    const product = candidates[index];
    const variant = usableVariants(product).find((row) => hasUsableImage(product, row)) || usableVariants(product)[0] || null;
    const lane = videoLaneForIndex(index);
    const item = buildVideoQueueItem({ product, variant, lane, index });
    const scheduledAt = scheduledTimeFor(index, runType, item, scheduleState);
    const design = {
      ...item.design_json,
      scheduled_at: scheduledAt.toISOString(),
      best_posting_time: scheduledAt.toISOString(),
      posting_window: scheduledAt.postingWindow || "",
      posting_insight_source: scheduledAt.insightSource || "fallback",
    };
    const result = await db.query(
      `
      INSERT INTO ai_marketing_content_queue (
        tenant_id, content_type, strategy_type, department_id, department_name, segment_type, segment_id, segment_name,
        product_id, variant_id, title, caption, image_url, media_urls, primary_image_url, variant_image_url, color, size,
        product_url, design_json, status, scheduled_at, metadata
      )
      SELECT $1::bigint,$2::varchar,$3::varchar,$4::bigint,$5::text,$6::varchar,$7::bigint,$8::text,$9::bigint,$10::bigint,$11::text,$12::text,$13::text,$14::jsonb,$15::text,$16::text,$17::text,$18::text,$19::text,$20::jsonb,$21::varchar,$22::timestamp,$23::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM ai_marketing_content_queue existing
        WHERE existing.tenant_id = $1
          AND existing.content_type = 'video'
          AND existing.product_id = $9
          AND existing.strategy_type = $3::varchar
          AND existing.created_at::date = CURRENT_DATE
      )
      RETURNING *
      `,
      [
        tenantId,
        "video",
        item.strategy_type,
        item.department_id,
        item.department_name,
        item.segment_type,
        item.segment_id,
        item.segment_name,
        item.product_id,
        item.variant_id,
        item.title,
        item.caption,
        item.image_url,
        JSON.stringify(item.media_urls),
        item.primary_image_url,
        item.variant_image_url,
        item.color,
        item.size,
        item.product_url,
        JSON.stringify(design),
        "pending_generation",
        scheduledAt,
        JSON.stringify(item.metadata),
      ]
    );
    if (result.rows[0]) {
      inserted.push(normalizeQueueRow(result.rows[0]));
      continue;
    }

    const refreshed = await db.query(
      `
      UPDATE ai_marketing_content_queue
      SET title = $4::text,
          caption = $5::text,
          image_url = $6::text,
          media_urls = $7::jsonb,
          primary_image_url = $8::text,
          variant_image_url = $9::text,
          product_url = $10::text,
          design_json = $11::jsonb,
          metadata = COALESCE(metadata, '{}'::jsonb) || $12::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = (
        SELECT existing.id
        FROM ai_marketing_content_queue existing
        WHERE existing.tenant_id = $1
          AND existing.content_type = 'video'
          AND existing.product_id = $2
          AND existing.strategy_type = $3::varchar
          AND existing.created_at::date = CURRENT_DATE
          AND COALESCE(existing.publish_status, existing.status, '') NOT IN ('published', 'publishing')
        ORDER BY existing.created_at DESC, existing.id DESC
        LIMIT 1
      )
      RETURNING *
      `,
      [
        tenantId,
        item.product_id,
        item.strategy_type,
        item.title,
        item.caption,
        item.image_url,
        JSON.stringify(item.media_urls),
        item.primary_image_url,
        item.variant_image_url,
        item.product_url,
        JSON.stringify(design),
        JSON.stringify({ ...item.metadata, refreshed_professional_video_design: true }),
      ]
    );
    if (refreshed.rows[0]) inserted.push(normalizeQueueRow(refreshed.rows[0]));
  }

  return { generated_videos: inserted.length, rows: inserted };
};

export const approveAiMarketingQueueItem = async (tenantId, id) => {
  await ensureAiMarketingCenterSchema();
  const current = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  const currentItem = current.rows[0] ? normalizeQueueRow(current.rows[0]) : null;
  const validation = await validateLastPieceQueueItem(tenantId, currentItem || {});
  if (currentItem?.strategy_type === "last_size" && !validation.valid) {
    await db.query(`DELETE FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return null;
  }
  const hydratedItem = await hydrateQueueStoryMetadata(
    tenantId,
    currentItem?.strategy_type === "last_size" ? applyCurrentLastPieceStock(currentItem, validation.stock) : currentItem
  );
  const currentDesign = hydratedItem?.design_json;
  const result = await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = CASE WHEN content_type = 'video' THEN 'approved' ELSE 'scheduled' END,
        design_json = COALESCE($3::jsonb, design_json),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2 AND status IN ('generated', 'pending_generation', 'ready', 'pending_approval')
    RETURNING *
    `,
    [id, tenantId, currentDesign ? JSON.stringify(currentDesign) : null]
  );
  return result.rows[0] ? normalizeQueueRow(result.rows[0]) : null;
};

export const publishAiMarketingQueueItemNow = async (tenantId, id) => {
  await ensureAiMarketingCenterSchema();
  const current = await db.query(`SELECT * FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  const currentItem = current.rows[0] ? normalizeQueueRow(current.rows[0]) : null;
  if (!currentItem) {
    await logPublishQueueNotFound(tenantId, id, "not_found_or_tenant_mismatch");
    throw serviceError("Queue item not found", 404, { queue_id: id, reason: "not_found_or_tenant_mismatch" });
  }
  if (currentItem.status === "published" || currentItem.publish_status === "published") {
    throw serviceError("Queue item already published", 409, { queue_id: id, reason: "already_published" });
  }
  if (currentItem.status === "publishing" || currentItem.publish_status === "publishing") {
    throw serviceError("Queue item is already publishing", 409, { queue_id: id, reason: "already_publishing" });
  }
  const validation = await validateLastPieceQueueItem(tenantId, currentItem || {});
  if (currentItem?.strategy_type === "last_size" && !validation.valid) {
    await db.query(`DELETE FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    await logPublishQueueNotFound(tenantId, id, `stale_last_piece_${validation.reason || "invalid"}`);
    throw serviceError("This last-piece item was removed because stock changed. Queue updated.", 410, {
      queue_id: id,
      reason: validation.reason || "stale_last_piece",
    });
  }
  const publishItem = await hydrateQueueStoryMetadata(
    tenantId,
    currentItem?.strategy_type === "last_size" ? applyCurrentLastPieceStock(currentItem, validation.stock) : currentItem
  );
  const isStory = isStoryQueueItem(publishItem);
  if (isStory) assertStoryPublishAsset(publishItem);
  await db.query(
    `
    UPDATE ai_marketing_content_queue
    SET status = 'publishing',
        publish_status = 'publishing',
        publish_error = NULL,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP,
        design_json = COALESCE($3::jsonb, design_json)
    WHERE id = $1 AND tenant_id = $2
    `,
    [id, tenantId, publishItem.design_json ? JSON.stringify(publishItem.design_json) : null]
  );

  try {
    const settings = await getMarketingSettingsRow(tenantId);
    if (publishItem.content_type === "video") {
      const result = {
        status: "failed",
        published_at: null,
        error_message: "AI video publishing is not implemented yet. Video queue is ready for MP4/Reels publishing in a later phase.",
        video_url: publishItem.design_json?.video_url || "",
      };
      const platformResults = {
        instagram: { status: "failed", platform_post_id: null, error: result.error_message },
        facebook: { status: "failed", platform_post_id: null, error: result.error_message },
        tiktok: { status: "skipped", platform_post_id: null, error: "TikTok publishing later" },
      };
      return persistQueuePublishResult({ tenantId, id, item: publishItem, result, platformResults, statusOverride: "failed", errorOverride: result.error_message });
    }
    const publishResult = isStory
      ? await publishStoryEverywhereService({ story: queueItemStoryPayload(publishItem), settings })
      : await publishPostService(queueItemPostPayload(publishItem), settings);
    const platformResults = normalizePlatformResults(publishResult, isStory ? "story" : "post");
    return persistQueuePublishResult({ tenantId, id, item: publishItem, result: publishResult, platformResults });
  } catch (error) {
    const failedResults = {
      facebook: { status: "failed", platform_post_id: null, error: error?.message || "Meta publish failed" },
      instagram: { status: "failed", platform_post_id: null, error: error?.message || "Meta publish failed" },
    };
    return persistQueuePublishResult({
      tenantId,
      id,
      item: publishItem,
      result: { status: "failed", published_at: null, error_message: error?.message || "Meta publish failed" },
      platformResults: failedResults,
      statusOverride: "failed",
      errorOverride: error?.message || "Meta publish failed",
    });
  }
};

export const deleteAiMarketingQueueItem = async (tenantId, id) => {
  await ensureAiMarketingCenterSchema();
  const queueItemId = Number(id);
  if (!Number.isInteger(queueItemId) || queueItemId <= 0) return false;
  const result = await db.query(`DELETE FROM ai_marketing_content_queue WHERE id = $1 AND tenant_id = $2 RETURNING id`, [queueItemId, tenantId]);
  return Boolean(result.rows[0]);
};

export const setAiMarketingAutomationActive = async (tenantId, active) => {
  await getAiMarketingSettings(tenantId);
  const result = await db.query(
    `
    UPDATE ai_marketing_settings
    SET active = $2, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1
    RETURNING *
    `,
    [tenantId, active]
  );
  return normalizeSettings(result.rows[0]);
};
