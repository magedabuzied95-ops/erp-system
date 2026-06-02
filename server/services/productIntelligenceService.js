import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTELLIGENCE_PATH = path.resolve(__dirname, "../data/productIntelligence.json");
const STYLE_VOCABULARY_PATH = path.resolve(__dirname, "../data/styleVocabulary.json");

const FALLBACK_INTELLIGENCE = Object.freeze({
  aliases: [],
  styles: [],
  occasions: [],
  gender_fit: [],
  vibe_tags: [],
  outfit_tags: [],
  aesthetic_tags: [],
  personality_lines: [],
  selling_points: [],
  target_customer: [],
  priority_score: 0,
  is_trending: false,
});

export const RESPONSE_VARIATIONS = Object.freeze({
  greetings: [
    "أيوه يا فندم",
    "خلينا نطلعلك حاجة تقيلة",
    "تمام، عندي كذا اختيار حلو",
    "لو عايز رأيي",
  ],
  urgency: [
    "المقاسات دي بتتحرك بسرعة",
    "لو مقاسك موجود الحقه",
    "ده بيخلص بسرعة لما بينزل",
    "الاستوك منه مش بيقعد كتير",
  ],
  recommendations: [
    "ده لايق جدًا",
    "اختيار نضيف بصراحة",
    "ده عامل شغل جامد",
    "هيديك لوك مرتب",
  ],
  outOfStock: [
    "الموديل ده خلصان حاليًا، بس عندي شبهه قريب جدًا",
    "ده مش متاح دلوقتي، نطلعلك نفس الستايل في موديل تاني",
    "المقاس ده خلص بسرعة، فيه بدائل لايقة جدًا",
    "مش موجود حاليًا، بس في اختيارات قريبة وشكلها جامد",
  ],
  sellingPoints: [
    "خامته نضيفة جدًا",
    "معمول حلو بصراحة",
    "مريح جدًا في اللبس",
    "الناس مبسوطة منه جدًا",
  ],
});

const INTENT_MAP = Object.freeze({
  casual: {
    styles: ["casual", "classic", "clean", "minimal"],
    occasions: ["daily", "college", "outfit"],
    terms: ["casual", "كاجوال", "يومي", "كل يوم"],
  },
  premium: {
    styles: ["premium", "clean", "minimal"],
    occasions: ["smart casual", "outfit", "date"],
    terms: ["premium", "شيك", "نضيف", "غالي", "خروجة", "خروجات", "سمارت"],
  },
  daily: {
    styles: ["casual", "comfortable", "classic", "sporty"],
    occasions: ["daily", "walking", "college", "travel"],
    terms: ["daily", "يومي", "مشاوير", "مشي", "جامعة", "كل يوم"],
  },
  outfit: {
    styles: ["streetwear", "premium", "clean", "retro"],
    occasions: ["outfit", "smart casual", "night out", "street"],
    terms: ["outfit", "fit", "لوك", "طقم", "لبس", "خروجة", "خروجات"],
  },
  sporty: {
    styles: ["sporty", "comfortable", "streetwear", "chunky"],
    occasions: ["gym", "walking", "daily", "street"],
    terms: ["sporty", "sport", "رياضي", "جيم", "مريح", "شوز"],
  },
  trending: {
    styles: ["streetwear", "retro", "chunky", "premium"],
    occasions: ["outfit", "street", "daily"],
    terms: ["trend", "trending", "ترند", "موضة", "عامل شغل"],
    trendingOnly: true,
  },
});

let cachedIntelligence = null;
let cachedIndex = null;
let cachedStyleVocabulary = null;
let cachedStyleIndex = null;

export const getRecommendationMode = () => {
  const mode = toText(process.env.AI_RECOMMENDATION_MODE || "clearance").toLowerCase();
  return ["clearance", "balanced", "high_stock"].includes(mode) ? mode : "clearance";
};

const toText = (value, fallback = "") => String(value ?? fallback).trim();

export const normalizeIntelligenceText = (value = "") =>
  toText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeList = (value = []) =>
  (Array.isArray(value) ? value : [value])
    .map((item) => toText(item))
    .filter(Boolean);

const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeInventorySize = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^eu/, "")
    .trim();

export const getInventoryState = ({ totalStock = 0, requestedSizeStock = null } = {}) => {
  const stock = Math.max(0, numeric(requestedSizeStock ?? totalStock, 0));
  if (stock <= 2) return "almost_sold_out";
  if (stock <= 5) return "low_stock";
  if (stock <= 12) return "medium_stock";
  return "well_stocked";
};

export const buildInventoryProfile = (product = {}, requestedSize = "") => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const normalizedSize = normalizeInventorySize(requestedSize);
  const totalStock = Math.max(
    0,
    numeric(
      product.total_stock ?? product.stock,
      variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant?.stock, 0)), 0)
    )
  );
  const sizeVariants = normalizedSize
    ? variants.filter((variant) => normalizeInventorySize(variant?.size) === normalizedSize)
    : [];
  const requestedSizeStock = normalizedSize
    ? sizeVariants.reduce((sum, variant) => sum + Math.max(0, numeric(variant?.stock, 0)), 0)
    : null;
  const stockedVariantCount = Math.max(
    0,
    numeric(
      product.remaining_variant_count ?? product.stocked_variant_count,
      variants.filter((variant) => numeric(variant?.stock, 0) > 0).length
    )
  );
  const remainingSizeCount = Math.max(
    0,
    numeric(
      product.remaining_size_count,
      new Set(variants.filter((variant) => numeric(variant?.stock, 0) > 0).map((variant) => normalizeInventorySize(variant?.size)).filter(Boolean)).size
    )
  );
  const remainingColorCount = Math.max(
    0,
    numeric(
      product.remaining_color_count,
      new Set(variants.filter((variant) => numeric(variant?.stock, 0) > 0).map((variant) => normalizeIntelligenceText(variant?.color)).filter(Boolean)).size
    )
  );
  const lowVariantCount = variants.filter((variant) => {
    const stock = numeric(variant?.stock, 0);
    return stock > 0 && stock <= 2;
  }).length;
  const state = getInventoryState({ totalStock, requestedSizeStock });
  const isAvailable = totalStock > 0;
  const requestedSizeAvailable = normalizedSize ? requestedSizeStock > 0 : null;
  const requestedSizeStrong = normalizedSize ? requestedSizeStock >= 3 : false;
  const requestedSizeLimited = normalizedSize ? requestedSizeStock > 0 && requestedSizeStock <= 2 : false;

  return {
    total_stock: totalStock,
    inventory_state: state,
    requested_size: requestedSize ? toText(requestedSize).toUpperCase() : "",
    requested_size_stock: requestedSizeStock,
    requested_size_available: requestedSizeAvailable,
    requested_size_strong: requestedSizeStrong,
    requested_size_limited: requestedSizeLimited,
    stocked_variant_count: stockedVariantCount,
    remaining_variant_count: stockedVariantCount,
    remaining_size_count: remainingSizeCount,
    remaining_color_count: remainingColorCount,
    low_variant_count: lowVariantCount,
    low_inventory: isAvailable && totalStock <= 5,
    almost_sold_out: isAvailable && totalStock <= 2,
    availability: isAvailable ? "available" : "out_of_stock",
  };
};

const boundedStockScore = (stock) => Math.min(950, Math.log2(Math.max(0, numeric(stock, 0)) + 1) * 210);

const clearanceStockScore = (stock) => {
  const value = Math.max(0, numeric(stock, 0));
  if (value <= 0) return -10_000;
  if (value <= 2) return 1_400;
  if (value <= 5) return 1_050;
  if (value <= 12) return 520;
  return Math.max(0, 260 - Math.min(260, (value - 12) * 18));
};

const inventoryStateRank = (state = "", mode = getRecommendationMode()) => {
  const clearance = {
    almost_sold_out: 900,
    low_stock: 650,
    medium_stock: 260,
    well_stocked: 0,
  };
  const highStock = {
    well_stocked: 600,
    medium_stock: 360,
    low_stock: 80,
    almost_sold_out: -180,
  };
  const balanced = {
    low_stock: 420,
    medium_stock: 360,
    almost_sold_out: 220,
    well_stocked: 160,
  };
  const map = mode === "high_stock" ? highStock : mode === "balanced" ? balanced : clearance;
  return map[state] ?? 0;
};

export const inventorySalesScore = ({ product = {}, requestedSize = "", shoppingIntent = {}, memory = null } = {}) => {
  const profile = buildInventoryProfile(product, requestedSize);
  const intelligence = getProductIntelligence(product);
  const mode = getRecommendationMode();
  const recentSalesMomentum = numeric(
    product.recent_sales_momentum ??
      product.recent_sales_30d ??
      product.sales_30d ??
      product.sold_30d ??
      product.recent_sales ??
      product.sales_count,
    0
  );
  const createdAtMs = product.created_at ? Date.parse(product.created_at) : NaN;
  const daysSinceCreated = Number.isFinite(createdAtMs) ? (Date.now() - createdAtMs) / 86_400_000 : null;

  let score = 0;
  const breakdown = {};
  breakdown.recommendation_mode = mode;
  breakdown.total_stock = mode === "clearance"
    ? Math.round(clearanceStockScore(profile.total_stock))
    : Math.round(boundedStockScore(profile.total_stock));
  score += breakdown.total_stock;

  if (profile.requested_size) {
    if (profile.requested_size_available) {
      breakdown.requested_size = mode === "clearance"
        ? 5_000 + (profile.requested_size_limited ? 460 : 180)
        : 1_200 + Math.min(420, profile.requested_size_stock * 70);
    } else {
      breakdown.requested_size = -100_000;
    }
    score += breakdown.requested_size;
  }

  breakdown.inventory_state = inventoryStateRank(profile.inventory_state, mode);
  score += breakdown.inventory_state;

  breakdown.variant_depth = mode === "clearance"
    ? Math.max(0, 520 - profile.remaining_variant_count * 90)
    : profile.stocked_variant_count >= 4 ? 220 : 0;
  breakdown.remaining_sizes = mode === "clearance" ? Math.max(0, 360 - profile.remaining_size_count * 90) : 0;
  breakdown.remaining_colors = mode === "clearance" ? Math.max(0, 240 - profile.remaining_color_count * 70) : 0;
  score += breakdown.variant_depth + breakdown.remaining_sizes + breakdown.remaining_colors;

  breakdown.trending = intelligence.is_trending ? (mode === "clearance" ? 120 : 380) : 0;
  breakdown.priority = Math.round(numeric(intelligence.priority_score || product.priority_score, 0) * (mode === "clearance" ? 3 : 8));
  breakdown.momentum = mode === "clearance" ? Math.min(220, recentSalesMomentum * 35) : Math.min(560, recentSalesMomentum * 65);
  breakdown.recently_added = daysSinceCreated !== null && daysSinceCreated >= 0 && daysSinceCreated <= 30 ? (mode === "clearance" ? 30 : 180) : 0;
  score += breakdown.trending + breakdown.priority + breakdown.momentum + breakdown.recently_added;

  if (shoppingIntent?.trendingOnly && !intelligence.is_trending) {
    breakdown.trending_filter = -420;
    score += breakdown.trending_filter;
  }

  const memorySize = memory?.preferences?.size;
  if (!requestedSize && memorySize) {
    const memoryProfile = buildInventoryProfile(product, memorySize);
    if (memoryProfile.requested_size_strong) score += 460;
    else if (memoryProfile.requested_size_available === false) score -= 520;
  }

  return {
    score: Math.round(score),
    profile,
    breakdown,
  };
};

export const rankProductsByInventorySalesStrategy = ({ products = [], requestedSize = "", shoppingIntent = {}, memory = null } = {}) => {
  const mode = getRecommendationMode();
  const ranked = products.map((product, originalIndex) => {
    const inventory = inventorySalesScore({ product, requestedSize, shoppingIntent, memory });
    return {
      product: {
        ...product,
        inventory_state: inventory.profile.inventory_state,
        inventory_profile: inventory.profile,
        inventory_sales_score: inventory.score,
        inventory_sales_breakdown: inventory.breakdown,
      },
      originalIndex,
      inventory,
      intelligence: getProductIntelligence(product),
    };
  });

  if (requestedSize) {
    return ranked
      .filter((item) => item.inventory.profile.requested_size_available === true)
      .sort((left, right) => right.inventory.score - left.inventory.score || left.inventory.profile.total_stock - right.inventory.profile.total_stock || left.originalIndex - right.originalIndex)
      .map((item) => item.product);
  }

  if (mode === "clearance") {
    return ranked
      .filter((item) => item.inventory.profile.total_stock > 0)
      .sort((left, right) => right.inventory.score - left.inventory.score || left.inventory.profile.total_stock - right.inventory.profile.total_stock || left.originalIndex - right.originalIndex)
      .map((item) => item.product);
  }

  const safe = ranked
    .filter((item) => item.inventory.profile.total_stock > 2 && (!requestedSize || item.inventory.profile.requested_size_stock >= 2))
    .sort((left, right) => right.inventory.score - left.inventory.score || left.originalIndex - right.originalIndex);
  const trending = ranked
    .filter((item) => item.intelligence.is_trending && item.inventory.profile.total_stock > 0)
    .sort((left, right) => right.inventory.score - left.inventory.score || left.originalIndex - right.originalIndex);
  const urgency = ranked
    .filter((item) => item.inventory.profile.total_stock > 0 && item.inventory.profile.total_stock <= 5)
    .sort((left, right) => right.inventory.score - left.inventory.score || left.originalIndex - right.originalIndex);

  const mixed = [];
  const seen = new Set();
  const addFrom = (items, count) => {
    for (const item of items) {
      if (mixed.length >= count && count !== Infinity) break;
      const key = String(item.product.id ?? item.originalIndex);
      if (seen.has(key)) continue;
      seen.add(key);
      mixed.push(item.product);
    }
  };

  addFrom(safe, Math.ceil(products.length * 0.7));
  addFrom(trending, mixed.length + Math.max(1, Math.floor(products.length * 0.2)));
  addFrom(urgency, mixed.length + Math.max(1, Math.floor(products.length * 0.1)));
  addFrom(
    ranked.sort((left, right) => right.inventory.score - left.inventory.score || left.originalIndex - right.originalIndex),
    Infinity
  );

  return mixed;
};

const randomFrom = (items = [], fallback = "") => {
  const values = normalizeList(items);
  if (!values.length) return fallback;
  return values[Math.floor(Math.random() * values.length)] || fallback;
};

const readIntelligence = () => {
  if (cachedIntelligence) return cachedIntelligence;
  try {
    cachedIntelligence = JSON.parse(fs.readFileSync(INTELLIGENCE_PATH, "utf8"));
  } catch (error) {
    console.warn("[product-intelligence] failed to load data", { message: error?.message });
    cachedIntelligence = {};
  }
  return cachedIntelligence;
};

const readStyleVocabulary = () => {
  if (cachedStyleVocabulary) return cachedStyleVocabulary;
  try {
    cachedStyleVocabulary = JSON.parse(fs.readFileSync(STYLE_VOCABULARY_PATH, "utf8"));
  } catch (error) {
    console.warn("[product-intelligence] failed to load style vocabulary", { message: error?.message });
    cachedStyleVocabulary = {};
  }
  return cachedStyleVocabulary;
};

const entryWithName = (name, data = {}) => ({
  canonical_name: name,
  ...FALLBACK_INTELLIGENCE,
  ...data,
  aliases: normalizeList(data.aliases),
  styles: normalizeList(data.styles),
  occasions: normalizeList(data.occasions),
  gender_fit: normalizeList(data.gender_fit),
  vibe_tags: normalizeList(data.vibe_tags),
  outfit_tags: normalizeList(data.outfit_tags),
  aesthetic_tags: normalizeList(data.aesthetic_tags),
  personality_lines: normalizeList(data.personality_lines),
  selling_points: normalizeList(data.selling_points),
  target_customer: normalizeList(data.target_customer),
  priority_score: Number(data.priority_score || 0),
  is_trending: Boolean(data.is_trending),
});

const styleEntryWithName = (name, data = {}) => ({
  name,
  aliases: normalizeList(data.aliases),
  styles: normalizeList(data.styles),
  occasions: normalizeList(data.occasions),
  colors: normalizeList(data.colors),
  keywords: normalizeList(data.keywords),
  vibe_tags: normalizeList(data.vibe_tags),
  outfit_tags: normalizeList(data.outfit_tags),
  aesthetic_tags: normalizeList(data.aesthetic_tags),
  response_hint: toText(data.response_hint),
  trendingOnly: Boolean(data.trendingOnly),
});

const getStyleIndex = () => {
  if (cachedStyleIndex) return cachedStyleIndex;
  const entries = Object.entries(readStyleVocabulary()).map(([name, entry]) => styleEntryWithName(name, entry));
  const aliasIndex = entries.flatMap((entry) =>
    [entry.name, ...entry.aliases, ...entry.keywords, ...entry.styles, ...entry.occasions, ...entry.vibe_tags, ...entry.outfit_tags, ...entry.aesthetic_tags]
      .map((alias) => ({
        alias,
        normalizedAlias: normalizeIntelligenceText(alias),
        entry,
      }))
      .filter((item) => item.normalizedAlias.length >= 2)
  );
  cachedStyleIndex = { entries, aliasIndex };
  return cachedStyleIndex;
};

const getIndex = () => {
  if (cachedIndex) return cachedIndex;
  const data = readIntelligence();
  const entries = Object.entries(data).map(([name, entry]) => entryWithName(name, entry));
  const aliasIndex = entries.flatMap((entry) =>
    [entry.canonical_name, ...entry.aliases].map((alias) => ({
      alias,
      normalizedAlias: normalizeIntelligenceText(alias),
      entry,
    }))
  );
  cachedIndex = { entries, aliasIndex };
  return cachedIndex;
};

const productNameCandidates = (product = {}) =>
  [
    product.name,
    product.title,
    product.name_ar,
    product.name_en,
    product.title_ar,
    product.title_en,
    product.meta_title_ar,
    product.meta_title_en,
    product.edition_name,
    product.sku,
  ].filter(Boolean);

const matchesNormalized = (left = "", right = "") => {
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
};

export const findByAlias = (text = "") => {
  const normalized = normalizeIntelligenceText(text);
  if (!normalized) return [];
  const seen = new Set();
  return getIndex().aliasIndex
    .filter(({ normalizedAlias }) => normalizedAlias && matchesNormalized(normalized, normalizedAlias))
    .map(({ alias, entry }) => ({ alias, ...entry }))
    .filter((entry) => {
      if (seen.has(entry.canonical_name)) return false;
      seen.add(entry.canonical_name);
      return true;
    });
};

export const getProductIntelligence = (product = {}) => {
  const candidates = productNameCandidates(product).map(normalizeIntelligenceText).filter(Boolean);
  const match = getIndex().entries.find((entry) => {
    const aliases = [entry.canonical_name, ...entry.aliases].map(normalizeIntelligenceText);
    return candidates.some((candidate) => aliases.some((alias) => matchesNormalized(candidate, alias)));
  });
  return match || entryWithName(toText(product.name || product.title || ""), FALLBACK_INTELLIGENCE);
};

export const getTrendingProducts = () =>
  getIndex().entries
    .filter((entry) => entry.is_trending)
    .sort((left, right) => Number(right.priority_score || 0) - Number(left.priority_score || 0));

export const getProductsByStyle = (style = "") => {
  const normalizedStyle = normalizeIntelligenceText(style);
  return getIndex().entries
    .filter((entry) => entry.styles.some((item) => normalizeIntelligenceText(item) === normalizedStyle))
    .sort((left, right) => Number(right.priority_score || 0) - Number(left.priority_score || 0));
};

export const getProductsByOccasion = (occasion = "") => {
  const normalizedOccasion = normalizeIntelligenceText(occasion);
  return getIndex().entries
    .filter((entry) => entry.occasions.some((item) => normalizeIntelligenceText(item) === normalizedOccasion))
    .sort((left, right) => Number(right.priority_score || 0) - Number(left.priority_score || 0));
};

const STYLE_STOP_TOKENS = new Set([
  "حاجه",
  "عايز",
  "عايزه",
  "عاوز",
  "عاوزه",
  "محتاج",
  "محتاجه",
  "شبه",
  "زي",
  "زى",
  "ستايل",
  "لوك",
  "style",
  "look",
  "want",
  "need",
]);

const tokenSet = (value = "") =>
  new Set(normalizeIntelligenceText(value).split(/\s+/).filter((token) => token && !STYLE_STOP_TOKENS.has(token)));

const fuzzyTokenOverlap = (left = "", right = "") => {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let matches = 0;
  for (const leftToken of leftTokens) {
    for (const rightToken of rightTokens) {
      if (
        leftToken === rightToken ||
        leftToken.includes(rightToken) ||
        rightToken.includes(leftToken) ||
        (leftToken.length >= 4 && rightToken.length >= 4 && leftToken.slice(0, 4) === rightToken.slice(0, 4))
      ) {
        matches += 1;
        break;
      }
    }
  }
  return matches / Math.max(leftTokens.size, rightTokens.size);
};

const scoreStyleEntry = (query, entry) => {
  const normalizedQuery = normalizeIntelligenceText(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  const weightedGroups = [
    [[entry.name, ...entry.aliases], 120],
    [entry.keywords, 80],
    [entry.styles, 70],
    [entry.occasions, 65],
    [entry.vibe_tags, 60],
    [entry.outfit_tags, 55],
    [entry.aesthetic_tags, 55],
    [entry.colors, 35],
  ];
  for (const [items, weight] of weightedGroups) {
    for (const item of items) {
      const normalizedItem = normalizeIntelligenceText(item);
      if (!normalizedItem) continue;
      if (normalizedQuery === normalizedItem) score += weight * 2;
      else if (normalizedQuery.includes(normalizedItem) || normalizedItem.includes(normalizedQuery)) score += weight;
      else score += Math.round(fuzzyTokenOverlap(normalizedQuery, normalizedItem) * weight);
    }
  }
  return score;
};

export const detectStyleIntent = (query = "") => {
  const normalized = normalizeIntelligenceText(query);
  const empty = {
    hasIntent: false,
    labels: [],
    styles: [],
    occasions: [],
    colors: [],
    keywords: [],
    vibe_tags: [],
    outfit_tags: [],
    aesthetic_tags: [],
    search_terms: [],
    response_hint: "",
    trendingOnly: false,
    matches: [],
  };
  if (!normalized) return empty;

  const scored = getStyleIndex().entries
    .map((entry) => ({ entry, score: scoreStyleEntry(normalized, entry) }))
    .filter((item) => item.score >= 130)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
  if (!scored.length) return empty;

  const entries = scored.map((item) => item.entry);
  const collect = (key) => [...new Set(entries.flatMap((entry) => entry[key] || []))];
  const labels = entries.map((entry) => entry.name);
  const styles = collect("styles");
  const occasions = collect("occasions");
  const colors = collect("colors");
  const keywords = collect("keywords");
  const vibeTags = collect("vibe_tags");
  const outfitTags = collect("outfit_tags");
  const aestheticTags = collect("aesthetic_tags");
  const searchTerms = [
    ...labels,
    ...styles,
    ...occasions,
    ...colors,
    ...keywords,
    ...vibeTags,
    ...outfitTags,
    ...aestheticTags,
  ].filter(Boolean);

  return {
    hasIntent: true,
    labels,
    styles,
    occasions,
    colors,
    keywords,
    vibe_tags: vibeTags,
    outfit_tags: outfitTags,
    aesthetic_tags: aestheticTags,
    search_terms: [...new Set(searchTerms)],
    response_hint: entries.find((entry) => entry.response_hint)?.response_hint || "",
    trendingOnly: entries.some((entry) => entry.trendingOnly),
    matches: scored.map(({ entry, score }) => ({ label: entry.name, score, aliases: entry.aliases })),
  };
};

export const getVisualStyleTags = (product = {}) => {
  const intelligence = getProductIntelligence(product);
  return [
    ...new Set(
      [
        ...normalizeList(product.vibe_tags),
        ...normalizeList(product.outfit_tags),
        ...normalizeList(product.aesthetic_tags),
        ...normalizeList(product.visual_style_tags),
        ...normalizeList(product.tags),
        ...normalizeList(intelligence.vibe_tags),
        ...normalizeList(intelligence.outfit_tags),
        ...normalizeList(intelligence.aesthetic_tags),
        ...intelligence.styles,
        ...intelligence.occasions,
        ...intelligence.target_customer,
        ...(intelligence.is_trending ? ["trending"] : []),
      ]
        .map((tag) => normalizeIntelligenceText(tag))
        .filter(Boolean)
    ),
  ];
};

const productMatchesMemory = (product = {}, memory = {}) => {
  const preferences = memory?.preferences || {};
  const preferred = [
    preferences.favorite_style,
    ...(Array.isArray(preferences.preferred_styles) ? preferences.preferred_styles : []),
    preferences.favorite_color,
    ...(Array.isArray(preferences.preferred_colors) ? preferences.preferred_colors : []),
    ...(Array.isArray(preferences.favorite_models) ? preferences.favorite_models : []),
    ...(Array.isArray(preferences.preferred_brands) ? preferences.preferred_brands : []),
    memory?.shopping_intent,
    memory?.preferred_category,
  ].map(normalizeIntelligenceText).filter(Boolean);
  if (!preferred.length) return 0;
  const productText = normalizeIntelligenceText([
    product.name,
    product.sku,
    ...getVisualStyleTags(product),
    ...getProductIntelligence(product).aliases,
  ].filter(Boolean).join(" "));
  return preferred.filter((item) => productText.includes(item)).length;
};

export const rankProductsForStyle = ({ products = [], intent = {}, memory = null } = {}) => {
  const wanted = new Set([
    ...(intent.styles || []),
    ...(intent.occasions || []),
    ...(intent.colors || []),
    ...(intent.keywords || []),
    ...(intent.vibe_tags || []),
    ...(intent.outfit_tags || []),
    ...(intent.aesthetic_tags || []),
    ...(intent.labels || []),
  ].map(normalizeIntelligenceText).filter(Boolean));

  return [...products].sort((left, right) => {
    const score = (product) => {
      const intel = getProductIntelligence(product);
      const productTags = getVisualStyleTags(product);
      const styleMatch = productTags.filter((tag) => wanted.has(tag)).length * 1_000;
      const fuzzyStyleMatch = productTags.reduce((sum, tag) => {
        if (wanted.has(tag)) return sum;
        return sum + [...wanted].reduce((best, target) => Math.max(best, fuzzyTokenOverlap(tag, target)), 0) * 240;
      }, 0);
      const stock = Number(product.total_stock || product.stock || 0) > 0 ? 600 : 0;
      const trend = intel.is_trending ? 350 : 0;
      const memoryScore = productMatchesMemory(product, memory) * 260;
      const priority = Number(intel.priority_score || product.priority_score || 0) * 4;
      const trendFilter = intent.trendingOnly && !intel.is_trending ? -1_000 : 0;
      return styleMatch + fuzzyStyleMatch + stock + trend + memoryScore + priority + trendFilter;
    };
    return score(right) - score(left);
  });
};

export const getProductsForStyleIntent = (intent = {}, products = [], memory = null) => {
  if (Array.isArray(products) && products.length) return rankProductsForStyle({ products, intent, memory });
  const wanted = new Set([
    ...(intent.styles || []),
    ...(intent.occasions || []),
    ...(intent.vibe_tags || []),
    ...(intent.outfit_tags || []),
    ...(intent.aesthetic_tags || []),
  ].map(normalizeIntelligenceText));
  return getIndex().entries
    .filter((entry) => getVisualStyleTags(entry).some((tag) => wanted.has(tag)))
    .sort((left, right) => Number(right.priority_score || 0) - Number(left.priority_score || 0));
};

export const getRandomPersonalityLine = (product = {}) =>
  randomFrom(getProductIntelligence(product).personality_lines, randomFrom(RESPONSE_VARIATIONS.recommendations));

export const getRandomSellingPoint = (product = {}) =>
  randomFrom(getProductIntelligence(product).selling_points, randomFrom(RESPONSE_VARIATIONS.sellingPoints));

export const getResponseVariation = (type = "recommendations") =>
  randomFrom(RESPONSE_VARIATIONS[type], RESPONSE_VARIATIONS.recommendations[0]);

export const detectShoppingIntelligenceIntent = (text = "") => {
  const normalized = normalizeIntelligenceText(text);
  const styleIntent = detectStyleIntent(text);
  const detected = [];
  for (const [intent, config] of Object.entries(INTENT_MAP)) {
    if (config.terms.some((term) => normalized.includes(normalizeIntelligenceText(term)))) {
      detected.push({ intent, ...config });
    }
  }

  const styles = [...new Set([...detected.flatMap((item) => item.styles), ...styleIntent.styles])];
  const occasions = [...new Set([...detected.flatMap((item) => item.occasions), ...styleIntent.occasions])];
  return {
    intents: detected.map((item) => item.intent),
    styles,
    occasions,
    colors: styleIntent.colors,
    keywords: styleIntent.keywords,
    vibe_tags: styleIntent.vibe_tags,
    outfit_tags: styleIntent.outfit_tags,
    aesthetic_tags: styleIntent.aesthetic_tags,
    style_labels: styleIntent.labels,
    style_response_hint: styleIntent.response_hint,
    trendingOnly: detected.some((item) => item.trendingOnly) || styleIntent.trendingOnly,
    hasIntent: detected.length > 0 || styleIntent.hasIntent,
  };
};

export const buildIntelligenceSearchTerms = (text = "") => {
  const aliasMatches = findByAlias(text);
  const shoppingIntent = detectShoppingIntelligenceIntent(text);
  return [
    ...aliasMatches.flatMap((entry) => [entry.canonical_name, ...entry.aliases]),
    ...shoppingIntent.styles,
    ...shoppingIntent.occasions,
    ...(shoppingIntent.colors || []),
    ...(shoppingIntent.keywords || []),
    ...(shoppingIntent.vibe_tags || []),
    ...(shoppingIntent.outfit_tags || []),
    ...(shoppingIntent.aesthetic_tags || []),
  ].filter(Boolean);
};

export const enrichProductWithIntelligence = (product = {}) => {
  const intelligence = getProductIntelligence(product);
  return {
    ...product,
    intelligence,
    priority_score: intelligence.priority_score,
    is_trending: intelligence.is_trending,
  };
};

export const rankProductsBySalesIntelligence = ({ products = [], shoppingIntent = {} } = {}) => {
  const styles = new Set((shoppingIntent.styles || []).map(normalizeIntelligenceText));
  const occasions = new Set((shoppingIntent.occasions || []).map(normalizeIntelligenceText));
  const visualTags = new Set([
    ...(shoppingIntent.colors || []),
    ...(shoppingIntent.keywords || []),
    ...(shoppingIntent.vibe_tags || []),
    ...(shoppingIntent.outfit_tags || []),
    ...(shoppingIntent.aesthetic_tags || []),
  ].map(normalizeIntelligenceText));
  const trendingOnly = Boolean(shoppingIntent.trendingOnly);

  return [...products].sort((left, right) => {
    const leftIntel = getProductIntelligence(left);
    const rightIntel = getProductIntelligence(right);
    const score = (product, intel) => {
      const stock = Number(product.total_stock || product.stock || 0) > 0 ? 10_000 : 0;
      const trend = intel.is_trending ? 1_000 : 0;
      const priority = Number(intel.priority_score || 0) * 10;
      const styleMatch = intel.styles.filter((item) => styles.has(normalizeIntelligenceText(item))).length * 450;
      const occasionMatch = intel.occasions.filter((item) => occasions.has(normalizeIntelligenceText(item))).length * 420;
      const visualMatch = getVisualStyleTags(product).filter((item) => visualTags.has(item)).length * 360;
      const trendFilter = trendingOnly && !intel.is_trending ? -3_000 : 0;
      return stock + trend + priority + styleMatch + occasionMatch + visualMatch + trendFilter;
    };
    return score(right, rightIntel) - score(left, leftIntel);
  });
};

// Extension point for personalization, preference memory, visual similarity, and trend analytics.
export const buildProductIntelligenceProfile = (product = {}) => {
  const intelligence = getProductIntelligence(product);
  const inventory = product.inventory_profile || buildInventoryProfile(product);
  return {
    canonical_name: intelligence.canonical_name,
    aliases: intelligence.aliases,
    styles: intelligence.styles,
    occasions: intelligence.occasions,
    gender_fit: intelligence.gender_fit,
    target_customer: intelligence.target_customer,
    vibe_tags: getVisualStyleTags(product),
    outfit_tags: intelligence.outfit_tags,
    aesthetic_tags: intelligence.aesthetic_tags,
    priority_score: intelligence.priority_score,
    is_trending: intelligence.is_trending,
    inventory_state: inventory.inventory_state,
    inventory_sales_score: product.inventory_sales_score || 0,
    requested_size: inventory.requested_size,
    requested_size_stock: inventory.requested_size_stock,
    requested_size_available: inventory.requested_size_available,
  };
};
