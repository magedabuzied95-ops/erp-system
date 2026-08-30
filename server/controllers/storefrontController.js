import crypto from "node:crypto";
import path from "node:path";
import { access, readFile, unlink } from "node:fs/promises";
import sharp from "sharp";
import db from "../database/db.js";
import { adjustVariantStock } from "../services/inventoryService.js";
import { createSystemNotification } from "../services/notificationsService.js";
import { sendManagerInvoiceCreatedPush } from "../services/managerPortalPushService.js";
import {
  attachGroupedColorImages,
  attachVariantImages,
  dedupeImages,
  ensureProductVariantImagesSchema,
  loadProductVariantImages,
} from "../services/productVariantImagesService.js";
import { getShippingProvider, normalizeShippingProviderKey, shippingProviderCatalog, shippingProviders } from "../services/shippingProviders/index.js";
import { ensureLoyaltySchema, getCustomerLoyaltySummary, resolveOrCreateCustomerAccount } from "../services/loyaltyService.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { fetchProductClassificationGroupByKey, getClassificationFilterAliases } from "../services/productClassificationsService.js";
import { generateProductOgImage, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, buildAbsolutePublicUrl } from "../services/productOgImageService.js";
import { generateAiProductData } from "../services/aiProductDataService.js";
import { understandProductImageForSearch } from "../services/openaiSupportService.js";
import { searchAiVisualProductsPro } from "../services/aiVisualSearchProService.js";
import { isMirrorProduct, mirrorProductTitle, slugifyEdition } from "../utils/mirrorProduct.js";
import { buildCacheKey, getOrSetCache, getOrSetCacheSWR, invalidateCachePattern } from "../services/cacheService.js";
import { createPerfTrace } from "../utils/storefrontPerf.js";
import { getWebsiteSettings } from "../services/liveActivityService.js";
import {
  ensureWhatsappOrderConfirmationSchema,
  sendOrderConfirmation,
  sendInvoiceWhatsapp,
  sendPaymentReviewNotification,
} from "../services/whatsappOrderConfirmationService.js";
import { ensureWhatsappShippingSchema, sendShipmentCreated } from "../services/whatsappShippingService.js";
import { getSetting } from "../services/settingsService.js";
import { normalizeSaleModeSettings } from "../services/saleModeService.js";
import { issueFirstOrderCoupons, redeemCoupon, validateCoupon } from "../services/couponsService.js";
import { resolveStorefrontProductLink } from "../services/storefrontProductUrlService.js";
import { resolveCurrentSellingPrice } from "../services/currentSellingPriceResolver.js";
// ONE definition of "this product is a curated offer", shared with POS and the AI resolver.
import { isForcedOfferSale } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { resolveStorefrontShippingQuote } from "../services/storefrontShippingService.js";
import {
  createStorefrontCustomerReviewData,
  isValidCustomerReviewEmail,
} from "../services/storefrontCustomerReviewsService.js";
import { loadStorefrontMerchantPolicyData } from "../services/storefrontMerchantPolicyService.js";
import {
  attachPublicOrderNumber,
  displayPublicOrderNumber,
} from "../utils/publicOrderNumber.js";
import {
  assignSequentialInvoiceNumber,
  buildTemporaryInvoiceNumber,
} from "../utils/invoiceNumber.js";
import { buildOrderItemInsertQuery, enrichOrderItemsInsertError } from "../utils/orderItemInsert.js";
import { normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus } from "../../shared/orderStatus.js";
import { createPaymentIntention, isPaymobOnlineReady, paymobOnlineConfig } from "../services/paymobOnlineService.js";
import { ensurePaymentTransactionsSchema } from "../services/paymobPosService.js";
import { enqueueOrderCreatedEmails } from "../services/transactionalEmail/orderEmailService.js";

export const DEFAULT_TENANT_ID = 1;
const LOW_STOCK_LIMIT = 2;
// Checkout values that mean "pay now through Paymob" rather than "transfer the
// money yourself and upload a screenshot". They all collapse to the stored
// method "card"; the webhook rewrites it to apple_pay when Paymob reports the
// wallet, so reporting can tell the instruments apart.
const GATEWAY_PAYMENT_METHODS = new Set(["card", "apple_pay", "paymob"]);
// The storefront's "آخر مقاسات" chip counts a card as a last piece up to 3 units.
const STOREFRONT_LAST_PIECE_MAX_STOCK = 3;
const isEnabledSetting = (value) => value === true || value === 1 || ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const getStorefrontOrderSettings = async () => {
  const [
    allowCod,
    allowStorePickup,
    defaultWebsiteStatus,
    autoConfirmWebsiteOrders,
    defaultShippingProvider,
  ] = await Promise.all([
    getSetting("orders.allow_cod", true),
    getSetting("orders.allow_store_pickup", true),
    getSetting("orders.default_website_order_status", "pending"),
    getSetting("orders.auto_confirm_website_orders", false),
    getSetting("orders.shipping_provider", "in_store_delivery"),
  ]);
  return {
    allowCod: isEnabledSetting(allowCod),
    allowStorePickup: isEnabledSetting(allowStorePickup),
    defaultWebsiteStatus: normalizeOrderLifecycleStatus(defaultWebsiteStatus, "pending"),
    autoConfirmWebsiteOrders: isEnabledSetting(autoConfirmWebsiteOrders),
    defaultShippingProvider: normalizeShippingProviderKey(defaultShippingProvider),
  };
};
const withPaymentProofAliases = (order = {}) => {
  const proofUrl = String(order.shipping_payment_screenshot || "").trim();
  return {
    ...order,
    payment_proof_url: proofUrl,
    shipping_proof_url: proofUrl,
    proof_image_url: proofUrl,
    payment_screenshot_url: proofUrl,
  };
};
const VISUAL_SEARCH_MAX_BYTES = Number(process.env.STOREFRONT_VISUAL_SEARCH_MAX_BYTES || 8 * 1024 * 1024);
const VISUAL_SEARCH_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VISUAL_HASH_SIZE = 8;
const VISUAL_REMOTE_CANDIDATE_LIMIT = Number(process.env.STOREFRONT_VISUAL_REMOTE_CANDIDATE_LIMIT || 140);
const VISUAL_REMOTE_IMAGE_TIMEOUT_MS = Number(process.env.STOREFRONT_VISUAL_REMOTE_IMAGE_TIMEOUT_MS || 450);
const VISUAL_REMOTE_IMAGE_MAX_BYTES = Number(process.env.STOREFRONT_VISUAL_REMOTE_IMAGE_MAX_BYTES || 3 * 1024 * 1024);
const VISUAL_IMAGE_MATCH_CONCURRENCY = Number(process.env.STOREFRONT_VISUAL_IMAGE_MATCH_CONCURRENCY || 16);
const VISUAL_SIGNATURE_CACHE_LIMIT = Number(process.env.STOREFRONT_VISUAL_SIGNATURE_CACHE_LIMIT || 1200);
let storefrontSchemaReadyPromise = null;
let storefrontSchemaReady = false;
const storefrontTableColumnsCache = new Map();
const ERP_PERF_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").toLowerCase());
const STOREFRONT_PRICING_DEFAULTS = {
  enable_fake_compare_price: true,
  fake_compare_percent: 20,
  fake_compare_rounding_mode: "none",
};
const PRODUCT_AUDIENCES = ["men", "women", "kids"];
const STOREFRONT_SORT_ALIASES = new Map([
  ["new", "newest"],
  ["newest", "newest"],
  ["latest", "newest"],
  ["price_asc", "price_asc"],
  ["price-asc", "price_asc"],
  ["price_low", "price_asc"],
  ["price-low", "price_asc"],
  ["price_low_high", "price_asc"],
  ["price_desc", "price_desc"],
  ["price-desc", "price_desc"],
  ["price_high", "price_desc"],
  ["price-high", "price_desc"],
  ["price_high_low", "price_desc"],
  ["best_sellers", "best_sellers"],
  ["best-sellers", "best_sellers"],
  ["bestsellers", "best_sellers"],
  ["best", "best_sellers"],
  ["discount", "discount"],
  ["sale", "discount"],
]);
const PRODUCT_AUDIENCE_ALIASES = new Map([
  ["men", "men"],
  ["man", "men"],
  ["male", "men"],
  ["mens", "men"],
  ["رجال", "men"],
  ["رجالي", "men"],
  ["women", "women"],
  ["woman", "women"],
  ["female", "women"],
  ["ladies", "women"],
  ["lady", "women"],
  ["نساء", "women"],
  ["نسائي", "women"],
  ["حريمي", "women"],
  ["kids", "kids"],
  ["kid", "kids"],
  ["children", "kids"],
  ["child", "kids"],
  ["boys", "kids"],
  ["girls", "kids"],
  ["اطفال", "kids"],
  ["أطفال", "kids"],
  ["طفل", "kids"],
]);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstQueryValue = (value) => {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  if (value && typeof value === "object") return "";
  return value;
};

const queryText = (value = "") => String(firstQueryValue(value) ?? "").trim();

// A facet the customer can pick more than once (`?size=16-inch&size=18-inch`, or a
// comma list from an older bundle). Express hands repeated keys over as an array,
// so the single-value reader above would silently keep only the first one.
const queryTextList = (...values) => {
  const collected = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === undefined || value === null || typeof value === "object") return;
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => collected.push(item));
  };
  values.forEach(visit);
  return [...new Set(collected)];
};

const queryFlagOn = (value) => {
  const normalized = queryText(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const queryPositiveNumber = (value) => {
  const parsed = Number.parseFloat(queryText(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const queryPositiveInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(queryText(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const storefrontVisibilityConditionSql = "COALESCE(p.is_storefront_visible, TRUE) = TRUE";

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeStorefrontSort = (value = "") => STOREFRONT_SORT_ALIASES.get(queryText(value).toLowerCase()) || "";

const normalizeStorefrontScope = (value = "") => {
  const scope = queryText(value).toLowerCase();
  return ["", "product", "products", "catalog", "storefront"].includes(scope) ? scope || "product" : "product";
};

const normalizeStorefrontGroupingMode = (value = "") => {
  const mode = queryText(value).toLowerCase().replace(/-/g, "_");
  return ["", "color_cards", "colors", "default", "none"].includes(mode) ? mode || "color_cards" : "color_cards";
};

const storefrontRandomSeed = (req) =>
  firstText(
    queryText(req.query.random_seed),
    queryText(req.query.randomSeed),
    queryText(req.query.seed),
    req.headers?.["x-storefront-random-seed"],
    req.headers?.["x-random-seed"],
    crypto.randomBytes(12).toString("hex")
  );

const seededRandom = (seed = "") => {
  let state = crypto.createHash("sha256").update(String(seed || "storefront")).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const storefrontCardId = (product = {}) =>
  `${product.card_id || product.id || ""}:${product.selected_variant_id || product.display_variant_id || ""}`;

const storefrontProductGroupId = (product = {}) =>
  String(product.parent_product_id || product.id || product.card_id || storefrontCardId(product));

const deterministicShuffle = (cards = [], seed = "") => {
  const rows = Array.isArray(cards) ? [...cards] : [];
  const random = seededRandom(seed || crypto.randomBytes(12).toString("hex"));
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [rows[index], rows[swapIndex]] = [rows[swapIndex], rows[index]];
  }
  return rows;
};

const smartGroupedStorefrontShuffle = (cards = [], seed = "") => {
  const groupsByProduct = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const groupId = storefrontProductGroupId(card);
    if (!groupsByProduct.has(groupId)) {
      groupsByProduct.set(groupId, { id: groupId, cards: [] });
    }
    groupsByProduct.get(groupId).cards.push(card);
  }

  const groups = deterministicShuffle(Array.from(groupsByProduct.values()), `${seed}:product-groups`)
    .map((group) => ({
      ...group,
      cards: deterministicShuffle(group.cards, `${seed}:colors:${group.id}`),
    }));
  const random = seededRandom(`${seed}:interleave`);
  const output = [];

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group.cards.length) continue;

    output.push(group.cards.shift());
    while (group.cards.length) {
      const gap = 1 + Math.floor(random() * 3);
      let inserted = 0;
      for (let lookAhead = 1; lookAhead < groups.length && inserted < gap; lookAhead += 1) {
        const other = groups[(index + lookAhead) % groups.length];
        if (!other || other.id === group.id || other.cards.length !== 1) continue;
        output.push(other.cards.shift());
        inserted += 1;
      }
      output.push(group.cards.shift());
    }
  }

  for (const group of groups) {
    while (group.cards.length) output.push(group.cards.shift());
  }

  return output;
};

const cardSortPrice = (product = {}) =>
  toNumber(resolveCustomerFacingDisplayPrice(product, product.variant || {}).selected_display_price || product.final_price || product.selling_price || product.price || product.sale_price || product.regular_price);

const cardDiscount = (product = {}) => {
  const price = cardSortPrice(product);
  const compare = toNumber(product.compare_at_price || product.old_price || product.original_price || product.regular_price);
  const amount = compare > price && price > 0 ? compare - price : 0;
  return {
    amount,
    percent: compare > 0 ? amount / compare : 0,
  };
};

const compareIds = (a = {}, b = {}) => String(a.card_id || a.id || "").localeCompare(String(b.card_id || b.id || ""), "en", { numeric: true });

const sortStorefrontCards = (cards = [], sort = "", seed = "") => {
  const rows = Array.isArray(cards) ? [...cards] : [];
  if (sort === "newest") {
    return rows.sort((a, b) =>
      new Date(b.created_at || b.updated_at || 0).getTime() - new Date(a.created_at || a.updated_at || 0).getTime() ||
      toNumber(b.parent_product_id || b.id) - toNumber(a.parent_product_id || a.id) ||
      compareIds(a, b)
    );
  }
  if (sort === "price_asc") return rows.sort((a, b) => cardSortPrice(a) - cardSortPrice(b) || compareIds(a, b));
  if (sort === "price_desc") return rows.sort((a, b) => cardSortPrice(b) - cardSortPrice(a) || compareIds(a, b));
  if (sort === "best_sellers") {
    return rows.sort((a, b) =>
      toNumber(b.sold_count) - toNumber(a.sold_count) ||
      toNumber(b.total_stock) - toNumber(a.total_stock) ||
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime() ||
      compareIds(a, b)
    );
  }
  if (sort === "discount") {
    return rows.sort((a, b) => {
      const discountA = cardDiscount(a);
      const discountB = cardDiscount(b);
      return discountB.percent - discountA.percent || discountB.amount - discountA.amount || compareIds(a, b);
    });
  }
  return smartGroupedStorefrontShuffle(rows, seed);
};

const keepOfferCardsAfterRegularCards = (cards = [], offerStoryOnly = false) => {
  const rows = Array.isArray(cards) ? cards : [];
  if (offerStoryOnly) return rows;
  const regular = [];
  const offers = [];
  for (const card of rows) {
    const isOffer = card?.is_offer_story === true || String(card?.is_offer_story || "").toLowerCase() === "true";
    (isOffer ? offers : regular).push(card);
  }
  return [...regular, ...offers];
};

const normalizeStorefrontPricingSettings = (settings = {}) => {
  const percent = Math.max(0, Math.min(500, toNumber(settings.fake_compare_percent, STOREFRONT_PRICING_DEFAULTS.fake_compare_percent)));
  const roundingMode = new Set(["none", "nearest_10", "nearest_50", "nearest_100"]).has(settings.fake_compare_rounding_mode)
    ? settings.fake_compare_rounding_mode
    : STOREFRONT_PRICING_DEFAULTS.fake_compare_rounding_mode;
  return {
    enable_fake_compare_price: settings.enable_fake_compare_price !== false,
    fake_compare_percent: percent,
    fake_compare_rounding_mode: roundingMode,
    ...normalizeSaleModeSettings(settings),
  };
};

const loadStorefrontPricingSettings = async (tenantId) =>
  normalizeStorefrontPricingSettings(await getWebsiteSettings({ tenantId }));

const roundComparePrice = (value, mode = "none") => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const step = mode === "nearest_10" ? 10 : mode === "nearest_50" ? 50 : mode === "nearest_100" ? 100 : 0;
  return roundMoney(step > 0 ? Math.round(amount / step) * step : amount);
};

const saleModeEnabled = (settings = {}) =>
  settings.sale_mode_enabled === true || settings.global_sale_enabled === true || settings.sale_prices_enabled === true;

// `forcedOffer` = the product sits in the curated Offers section. That membership activates its sale price on
// its own, without the global Sale Mode toggle — the same rule POS and resolveEffectiveCustomerPrice apply, so
// the shelf price, the cart and the AI quote cannot disagree. `sale < selling` still guards every path.
const resolveStorefrontActivePrice = ({ originalPrice, sellingPrice, salePrice, pricingSettings = STOREFRONT_PRICING_DEFAULTS, forcedOffer = false }) => {
  const original = roundMoney(originalPrice);
  const selling = roundMoney(sellingPrice);
  const sale = roundMoney(salePrice);
  const enabled = saleModeEnabled(pricingSettings) || forcedOffer === true;
  // Some catalog imports store the only customer-facing price in sale_price.
  // Never turn that valid price into zero merely because global sale mode is off.
  const basePrice = selling > 0 ? selling : sale > 0 ? sale : original;
  const activeSale = enabled && sale > 0 && selling > 0 && sale < selling;
  const activePrice = activeSale ? sale : basePrice;
  const compareAtPrice = original > activePrice && activePrice > 0 ? original : 0;
  return {
    activePrice,
    compareAtPrice,
    saleActive: activeSale && sale < selling,
    saleModeOn: enabled,
  };
};

const resolveCustomerFacingDisplayPrice = (product = {}, variant = {}, pricingSettings = null) => {
  const sale = roundMoney(variant.sale_price ?? product.sale_price ?? 0);
  const selling = roundMoney(variant.selling_price ?? variant.price ?? product.selling_price ?? product.price ?? product.regular_price ?? 0);
  const explicitSaleMode = pricingSettings && typeof pricingSettings === "object"
    ? saleModeEnabled(pricingSettings)
    : saleModeEnabled({
        sale_mode_enabled: variant.sale_mode_enabled ?? product.sale_mode_enabled,
        global_sale_enabled: variant.global_sale_enabled ?? product.global_sale_enabled,
        sale_prices_enabled: variant.sale_prices_enabled ?? product.sale_prices_enabled,
      });
  // A curated offer activates its own sale price, global toggle or not. See resolveStorefrontActivePrice.
  // Checked on each record separately, never on a merged scope: the flag lives on the product and storefront
  // variant rows omit it, so a spread would let an absent/false variant key mask a real product-level offer.
  const forcedOffer = isForcedOfferSale(product) || isForcedOfferSale(variant);
  const saleApplied = (explicitSaleMode || forcedOffer) && sale > 0 && selling > 0 && sale < selling;
  const selected_display_price = saleApplied ? sale : selling > 0 ? selling : sale;
  const selected_price_source = saleApplied || (selling <= 0 && sale > 0) ? "sale_price" : "selling_price";
  const wholesale_price = roundMoney(variant.wholesale_price ?? product.wholesale_price ?? variant.purchase_price ?? product.purchase_price ?? variant.average_cost ?? product.average_cost ?? variant.last_purchase_price ?? product.last_purchase_price ?? 0);
  const cost_price = roundMoney(variant.cost_price ?? product.cost_price ?? 0);
  return { selected_display_price, selected_price_source, selling_price: selling, sale_price: sale, wholesale_price, cost_price };
};

const storefrontComparePriceFor = (regularPrice, product = {}, pricingSettings = STOREFRONT_PRICING_DEFAULTS) => {
  const regular = roundMoney(regularPrice);
  if (regular <= 0) return 0;
  const customEnabled = product.use_custom_compare_price === true || String(product.use_custom_compare_price || "").toLowerCase() === "true";
  const customCompare = roundMoney(product.custom_compare_price);
  if (customEnabled && customCompare > regular) return customCompare;
  if (!pricingSettings.enable_fake_compare_price) return 0;
  const generated = regular * (1 + toNumber(pricingSettings.fake_compare_percent, 20) / 100);
  const compare = roundComparePrice(generated, pricingSettings.fake_compare_rounding_mode);
  return compare > regular ? compare : 0;
};

const toText = (value = "") => String(value || "").trim();
const normalizeAudienceText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeAudienceValue = (value) => {
  const normalized = normalizeAudienceText(value);
  if (!normalized) return "";
  const compact = normalized.replace(/\s+/g, "");
  return PRODUCT_AUDIENCE_ALIASES.get(normalized) || PRODUCT_AUDIENCE_ALIASES.get(compact) || (PRODUCT_AUDIENCES.includes(normalized) ? normalized : "");
};
const flattenAudienceInput = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenAudienceInput);
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    // Only a JSON array can change the outcome here. JSON.parse of anything else
    // either throws or returns a non-array, and both of those already fall through
    // to the separator split below. Skipping the attempt for inputs that cannot be
    // a JSON array removes a thrown exception per token without altering any result.
    if (text.charCodeAt(0) === 91 /* "[" */) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return flattenAudienceInput(parsed);
      } catch {
        // Accept comma-separated strings below.
      }
    }
    return text.split(/[,\n|]+/);
  }
  return [value];
};
const normalizeProductAudiences = (...sources) => {
  const seen = new Set();
  for (const source of sources) {
    for (const value of flattenAudienceInput(source)) {
      const audience = normalizeAudienceValue(value);
      if (audience) seen.add(audience);
    }
  }
  return PRODUCT_AUDIENCES.filter((audience) => seen.has(audience));
};
const normalizeClassificationToken = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_\u0600-\u06ff]+/g, "");

const activeStorefrontClassificationSets = async () => {
  const entries = [];
  for (const key of ["product_type", "grade"]) {
    const group = await fetchProductClassificationGroupByKey(key);
    const aliases = new Set();
    (group?.options || []).forEach((option) => {
      [option.value, option.label_ar, option.label_en, option.name_ar, option.name_en, option.english_name]
        .map(normalizeClassificationToken)
        .filter(Boolean)
        .forEach((alias) => aliases.add(alias));
    });
    entries.push([key, aliases]);
  }
  return Object.fromEntries(entries);
};

const scrubInactiveClassifications = async (products = []) => {
  const sets = await activeStorefrontClassificationSets();
  return products.map((product = {}) => {
    const next = { ...product, badge: "" };
    if (!sets.product_type?.has(normalizeClassificationToken(next.product_type))) {
      next.product_type = "";
      next.productType = "";
    }
    if (!sets.grade?.has(normalizeClassificationToken(next.grade))) next.grade = "";
    return next;
  });
};

const getActiveClassificationFilterAliases = async (groupKey, value) => {
  const raw = toText(value);
  if (!raw) return [];
  const group = await fetchProductClassificationGroupByKey(groupKey);
  const rawToken = normalizeClassificationToken(raw);
  const option = (group?.options || []).find((item) =>
    [item.value, item.label_ar, item.label_en, item.name_ar, item.name_en, item.english_name]
      .map(normalizeClassificationToken)
      .filter(Boolean)
      .includes(rawToken)
  );
  if (!option) return ["__no_active_classification_match__"];
  return [option.value, option.label_ar, option.label_en, option.name_ar, option.name_en, option.english_name]
    .map((item) => toText(item).toLowerCase())
    .filter(Boolean);
};
const slugifyProductName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
const decodeIdentifier = (value = "") => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
};
const productIdentifierCandidates = (value = "") => {
  const raw = String(value || "").trim();
  const decoded = decodeIdentifier(raw).trim();
  const candidates = [raw, decoded];
  for (const candidate of [raw, decoded]) {
    const cardProductId = candidate.match(/^(\d+):/);
    if (cardProductId?.[1]) candidates.push(cardProductId[1]);
  }
  if (decoded.includes("-")) {
    candidates.push(decoded.replace(/\s*-\s*/g, "-").replace(/-+/g, "-").trim());
  }
  return [...new Set(candidates.filter(Boolean))];
};
const productLookupFields = ["slug", "canonical_slug", "id", "sku", "product_code", "barcode", "qr_token", "variant.sku", "variant.barcode", "variant.edition_slug"];
const productLookupFilters = [
  "LOWER(slug) = LOWER(identifier)",
  "LOWER(canonical_slug) = LOWER(identifier)",
  "generated slug from product name",
  "generated slug from brand + product name",
  "id = numeric identifier",
  "LOWER(sku) = LOWER(identifier)",
  "LOWER(product_code) = LOWER(identifier)",
  "LOWER(barcode) = LOWER(identifier)",
  "LOWER(qr_token) = LOWER(identifier)",
  "variant sku/barcode/edition_slug",
];
const productGeneratedSlugSql = (fieldSql = "p.name") =>
  `LOWER(TRIM(BOTH '-' FROM REGEXP_REPLACE(REGEXP_REPLACE(LOWER(COALESCE(${fieldSql}, '')), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g')))`;
const publicToken = () => crypto.randomBytes(18).toString("hex");
const sortedQueryString = (query = {}) => {
  const params = new URLSearchParams();
  Object.keys(query || {}).sort().forEach((key) => {
    const value = query[key];
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  return params.toString();
};

// Cache windows for the public catalogue reads.
//
// FRESH is the old TTL: inside it nothing is rebuilt. STALE is the new part --
// past FRESH the cached answer is still served INSTANTLY while the rebuild runs
// behind the response, so no shopper ever waits for the 4-6s cold build that used
// to land on whoever happened to arrive first after an expiry.
//
// STALE is deliberately far longer than FRESH. It is not a correctness budget --
// a product save calls invalidateStorefrontTenantCache and drops the entry
// outright -- it is how long a quiet catalogue may coast on its last good answer
// instead of making a visitor pay to rebuild it.
const STOREFRONT_CACHE_FRESH_SECONDS = Math.max(5, Number(process.env.STOREFRONT_CACHE_FRESH_SECONDS || 120));
const STOREFRONT_CACHE_STALE_SECONDS = Math.max(
  STOREFRONT_CACHE_FRESH_SECONDS,
  Number(process.env.STOREFRONT_CACHE_STALE_SECONDS || 1800),
);
const storefrontCacheWindows = () => ({
  freshSeconds: STOREFRONT_CACHE_FRESH_SECONDS,
  staleSeconds: STOREFRONT_CACHE_STALE_SECONDS,
});

const storefrontCacheKey = (tenantId, scope, query = {}) =>
  buildCacheKey("storefront", `tenant:${tenantId || "public"}`, scope, sortedQueryString(query));
const invalidateStorefrontTenantCache = (tenantId) =>
  invalidateCachePattern(buildCacheKey("storefront", `tenant:${tenantId || "public"}`, "*")).catch((error) => {
    console.warn("[cache] storefront invalidation skipped", error?.message || error);
  });

const getProductLowStockSnapshot = async (clientOrPool, { productId, tenantId }) => {
  if (!productId) return null;
  const result = await clientOrPool.query(
    `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      CASE
        WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)
        ELSE GREATEST(COALESCE(p.stock, 0), 0)
      END::int AS total_stock,
      COALESCE(
        NULLIF(p.image_url, ''),
        NULLIF(p.image, ''),
        NULLIF(p.photo_url, ''),
        NULLIF(p.thumbnail_url, ''),
        NULLIF((ARRAY_AGG(v.image_url ORDER BY v.id) FILTER (WHERE v.image_url IS NOT NULL AND v.image_url <> ''))[1], ''),
        ''
      ) AS image_url
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
      AND v.is_active IS DISTINCT FROM FALSE
      AND v.deleted_at IS NULL
    WHERE p.id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
    GROUP BY p.id, p.name, p.stock, p.image_url, p.image, p.photo_url, p.thumbnail_url
    LIMIT 1
    `,
    [productId, tenantId]
  );
  return result.rows[0] || null;
};

const lowStockMessage = (productName, totalStock) =>
  Number(totalStock) === 1
    ? `متبقي قطعة واحدة فقط من ${productName}`
    : `متبقي قطعتين فقط من ${productName}`;

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  const text = toText(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
const checkoutValidationError = (message, field, details = {}, status = 400) => {
  const error = new Error(message);
  error.status = status;
  error.field = field;
  error.details = details;
  error.expose = true;
  return error;
};
const isValidShippingProofFile = (file) => {
  if (!file) return false;
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  return allowedTypes.has(file.mimetype) && Number(file.size || 0) >= 5 * 1024;
};

const removeUploadedFile = async (filePath) => {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
};

const tenantFromRequest = (req) => {
  const tenantId = Number(req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : DEFAULT_TENANT_ID;
};

const positiveId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// A POS online order is a website order in every way that matters downstream — same status,
// same WhatsApp confirmation, same shipping path — but it was raised by a named cashier at a
// named branch, and the seller earns commission on it. Those four facts have nowhere else to
// come from, so they are lifted off the authenticated session here.
const buildPosStaffAttribution = (req, body = {}) => {
  const user = req?.user || {};
  const cashierId = positiveId(user.id);
  const sellerUserId = positiveId(body.seller_user_id ?? body.sellerUserId);
  const salesEmployeeId = positiveId(body.sales_employee_id ?? body.salesEmployeeId ?? body.seller_id ?? body.sellerId);
  return {
    origin_surface: "pos",
    branch_id: positiveId(body.branch_id ?? body.branchId) || positiveId(user.branch_id),
    cashier_user_id: cashierId,
    cashier_id: cashierId,
    cashier_name: toText(user.name || user.full_name || user.username),
    created_by: cashierId,
    seller_user_id: sellerUserId,
    seller_name: toText(body.seller_name ?? body.sellerName),
    sales_employee_id: salesEmployeeId,
    salesperson_id: salesEmployeeId,
    assigned_seller_id: salesEmployeeId,
    seller_employee_id: salesEmployeeId,
  };
};

const tableColumns = async (clientOrPool, tableName) => {
  if (storefrontTableColumnsCache.has(tableName)) return storefrontTableColumnsCache.get(tableName);
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  storefrontTableColumnsCache.set(tableName, columns);
  return columns;
};

const attachDbContext = (error, context = {}) => {
  error.checkoutDbContext = { ...(error.checkoutDbContext || {}), ...context };
  return error;
};

const queryWithContext = async (client, query, params = [], context = {}) => {
  try {
    return await client.query(query, params);
  } catch (error) {
    throw attachDbContext(error, { ...context, query });
  }
};

const insertReturning = async (client, tableName, values, columns, context = {}) => {
  const entries = Object.entries(values).filter(([column]) => columns.has(column));
  if (!entries.length) throw new Error(`No compatible columns found for ${tableName}`);
  const columnSql = entries.map(([column]) => column).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const params = entries.map(([, value]) => value);
  const query = `INSERT INTO ${tableName} (${columnSql}) VALUES (${placeholders}) RETURNING *`;
  const result = await queryWithContext(client, query, params, { table: tableName, operation: "insert", ...context });
  return result.rows[0];
};

const logCheckoutStep = (step, details = {}) => {
  if (process.env.NODE_ENV === "production") return;
  console.log("[storefront-order-confirm] step:", step, details);
};

const ensureStorefrontSchemaNow = async (clientOrPool = db) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS slug TEXT DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS canonical_slug TEXT DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS qr_token TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS product_code TEXT DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sale_reason VARCHAR(40) DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS use_custom_compare_price BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS custom_compare_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'selling_price'
      ) THEN
        UPDATE products SET regular_price = selling_price WHERE COALESCE(regular_price, 0) = 0 AND COALESCE(selling_price, 0) > 0;
      END IF;
    END $$;
  `);
  await clientOrPool.query(`UPDATE products SET regular_price = price WHERE COALESCE(regular_price, 0) = 0 AND COALESCE(price, 0) > 0`);
  await clientOrPool.query(`UPDATE products SET selling_price = price WHERE COALESCE(selling_price, 0) = 0 AND COALESCE(price, 0) > 0`);
  await clientOrPool.query(`UPDATE products SET price = regular_price WHERE COALESCE(price, 0) = 0 AND COALESCE(regular_price, 0) > 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_name TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS edition_slug TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS article_code TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS audience VARCHAR(30)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_storefront_visible BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS color_sort_order INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_product_audience ON product_variants (product_id, audience, is_active) WHERE deleted_at IS NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS sale_start_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS sale_end_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`UPDATE product_variants SET regular_price = price WHERE COALESCE(regular_price, 0) = 0 AND COALESCE(price, 0) > 0`);
  await clientOrPool.query(`UPDATE product_variants SET selling_price = price WHERE COALESCE(selling_price, 0) = 0 AND COALESCE(price, 0) > 0`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS product_audiences (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      audience VARCHAR(30) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, audience),
      CHECK (audience IN ('men', 'women', 'kids'))
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_product_id ON product_audiences (product_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_product_audiences_audience ON product_audiences (audience, product_id)`);
  await clientOrPool.query(`
    INSERT INTO product_audiences (product_id, audience)
    SELECT p.id,
      CASE
        WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('men', 'man', 'male', 'mens', 'رجال', 'رجالي') THEN 'men'
        WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('women', 'woman', 'female', 'ladies', 'lady', 'نساء', 'نسائي', 'حريمي') THEN 'women'
        WHEN LOWER(TRIM(COALESCE(p.gender, ''))) IN ('kids', 'kid', 'children', 'child', 'boys', 'girls', 'اطفال', 'أطفال', 'طفل') THEN 'kids'
        ELSE NULL
      END
    FROM products p
    WHERE COALESCE(TRIM(p.gender), '') <> ''
      AND LOWER(TRIM(COALESCE(p.gender, ''))) IN ('men', 'man', 'male', 'mens', 'رجال', 'رجالي', 'women', 'woman', 'female', 'ladies', 'lady', 'نساء', 'نسائي', 'حريمي', 'kids', 'kid', 'children', 'child', 'boys', 'girls', 'اطفال', 'أطفال', 'طفل')
      AND NOT EXISTS (SELECT 1 FROM product_audiences pa WHERE pa.product_id = p.id)
    ON CONFLICT (product_id, audience) DO NOTHING
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS website_notifications ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customer_wishlist ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS recently_viewed_products ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS inventory_movements ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_tier VARCHAR(50) NOT NULL DEFAULT 'Bronze'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS loyalty_updated_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS registration_source VARCHAR(80) NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS first_visit_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS storefront_last_seen_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_storefront_customer BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT false`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS cod_enabled BOOLEAN DEFAULT false`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS completed_orders INTEGER DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS preferred_sizes JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS storefront_customer_carts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      customer_id BIGINT NULL,
      customer_phone VARCHAR(80) NOT NULL,
      cart JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80) NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS cart JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS storefront_customer_carts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_storefront_customer_carts_tenant_phone ON storefront_customer_carts (tenant_id, customer_phone)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_storefront_customer_carts_updated_at ON storefront_customer_carts (updated_at DESC)`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_storefront_customer_carts_tenant_phone_unique ON storefront_customer_carts (tenant_id, customer_phone)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'pos'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) NOT NULL DEFAULT 'walk_in'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_address TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_area VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS governorate_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS city_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS area_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS district_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS zone_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS landmark TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS order_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_method VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_screenshot TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_reference TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS transfer_proof_status VARCHAR(50)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_payment_verified_by INTEGER NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS customer_trust_counted_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cod_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS public_order_number VARCHAR(40)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS display_order_number VARCHAR(40)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(80) NOT NULL DEFAULT 'manual'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_id VARCHAR(80) NOT NULL DEFAULT 'in_store_delivery'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_city_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_zone_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_district_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_address_line TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS street_address TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS building_number VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS floor_number VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS apartment_number VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_status VARCHAR(80) NOT NULL DEFAULT 'pending'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_tracking_number VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_delivery_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_last_synced_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_status VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_url TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS last_shipping_sync_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS expected_delivery_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_cancelled_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_payment_review_sent_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_invoice_sent_at TIMESTAMP NULL`);
  // An online order can also be raised at the till (POS online-invoice mode). It keeps
  // source=website so the WhatsApp confirmation gate still fires, which leaves reporting no
  // way to tell a real web order from one a cashier typed in without a separate marker.
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS origin_surface VARCHAR(30)`);
  await ensureWhatsappShippingSchema(clientOrPool);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS product_image TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS variant_image TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS size VARCHAR(100)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS color VARCHAR(100)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customer_wishlist (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      phone VARCHAR(80),
      product_id BIGINT NOT NULL,
      notify_price_drop BOOLEAN NOT NULL DEFAULT TRUE,
      notify_back_in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, phone, product_id)
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS recently_viewed_products (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      session_id TEXT,
      phone VARCHAR(80),
      product_id BIGINT NOT NULL,
      viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS website_notifications (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      customer_id BIGINT NULL,
      phone VARCHAR(80),
      type VARCHAR(80) NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_source_created ON orders (source, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_phone_created ON orders (customer_phone, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_public_order_number ON orders (public_order_number)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_display_order_number ON orders (display_order_number)`);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_active_tenant_id
    ON products (tenant_id, id DESC)
    WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_filters
    ON products (tenant_id, gender, product_type, grade, id DESC)
    WHERE COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_stock
    ON product_variants (product_id, stock, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_product_stock
    ON product_variants (tenant_id, product_id, stock, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_article_code_lower
    ON product_variants (LOWER(TRIM(article_code)))
    WHERE article_code IS NOT NULL AND TRIM(article_code) <> ''
  `);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_storefront_products_qr_token
    ON products (qr_token)
    WHERE qr_token IS NOT NULL AND qr_token <> ''
  `);
  await clientOrPool.query(`
    UPDATE products
    SET qr_token = 'SHOP-PROD-' || id
    WHERE qr_token IS NULL OR TRIM(qr_token) = ''
  `);
  await clientOrPool.query(`
    UPDATE products
    SET canonical_slug = COALESCE(
      NULLIF(TRIM(canonical_slug), ''),
      NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(name, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
      'product-' || id
    )
    WHERE canonical_slug IS NULL OR TRIM(canonical_slug) = ''
  `);
  await clientOrPool.query(`
    UPDATE products
    SET slug = COALESCE(
      NULLIF(TRIM(slug), ''),
      NULLIF(TRIM(canonical_slug), ''),
      NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(name, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
      'product-' || id
    )
    WHERE slug IS NULL OR TRIM(slug) = ''
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_slug_lower
    ON products (LOWER(TRIM(slug)))
    WHERE slug IS NOT NULL AND TRIM(slug) <> ''
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_storefront_canonical_slug_lower
    ON products (LOWER(TRIM(canonical_slug)))
    WHERE canonical_slug IS NOT NULL AND TRIM(canonical_slug) <> ''
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_wishlist_tenant_phone_created
    ON customer_wishlist (tenant_id, phone, created_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_phone_viewed
    ON recently_viewed_products (tenant_id, phone, viewed_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_session_viewed
    ON recently_viewed_products (tenant_id, session_id, viewed_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_recently_viewed_tenant_product_lookup
    ON recently_viewed_products (tenant_id, product_id, phone, session_id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_website_notifications_tenant_phone_created
    ON website_notifications (tenant_id, phone, created_at DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
    ON orders (tenant_id, created_at DESC, id DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_created
    ON orders (tenant_id, channel, created_at DESC, id DESC)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id
    ON order_items (order_id, id)
  `);
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order_id
    ON order_items (tenant_id, order_id, id)
  `);
};

export const ensureStorefrontSchema = async (clientOrPool = db) => {
  if (storefrontSchemaReady) return;
  if (clientOrPool !== db) {
    return ensureStorefrontSchemaNow(clientOrPool);
  }
  if (!storefrontSchemaReadyPromise) {
    storefrontSchemaReadyPromise = (async () => {
      await ensureStorefrontSchemaNow(db);
      await warmStorefrontMetadataCache(db);
    })()
      .then(() => {
        storefrontSchemaReady = true;
      })
      .catch((error) => {
        storefrontSchemaReadyPromise = null;
        throw error;
      });
  }
  return storefrontSchemaReadyPromise;
};

export const warmStorefrontMetadataCache = async (clientOrPool = db) => {
  await Promise.all([
    tableColumns(clientOrPool, "products"),
    tableColumns(clientOrPool, "product_variants"),
    tableColumns(clientOrPool, "product_variant_images"),
    tableColumns(clientOrPool, "purchases"),
    tableColumns(clientOrPool, "purchase_items"),
    tableColumns(clientOrPool, "customers"),
    tableColumns(clientOrPool, "orders"),
    tableColumns(clientOrPool, "order_items"),
    tableColumns(clientOrPool, "website_notifications"),
  ]);
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const firstText = (...values) => values.map((value) => toText(value)).find(Boolean) || "";

const slugifyBrandName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "";

const STOREFRONT_KNOWN_BRAND_PREFIXES = [
  "Air Jordan",
  "The North Face",
  "New Balance",
  "Skechers",
  "Adidas",
  "Nike",
  "Jordan",
  "Reebok",
  "Converse",
  "Vans",
  "Puma",
  "DC",
];

const normalizeBrandFacetText = (value = "") =>
  queryText(value)
    .normalize("NFKD")
    .replace(/(?:\u0640|\u200c|\u200d|\u200e|\u200f)/g, "")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();

const deriveKnownBrandLabel = (value = "") => {
  const normalized = normalizeBrandFacetText(value);
  if (!normalized) return "";
  return STOREFRONT_KNOWN_BRAND_PREFIXES.find((brand) => {
    const normalizedBrand = normalizeBrandFacetText(brand);
    if (normalized === normalizedBrand) return true;
    if (normalized.startsWith(`${normalizedBrand} `)) return true;
    return normalizedBrand === "dc" && (normalized === "dc shoes" || normalized.startsWith("dc "));
  }) || "";
};

const storefrontBrandMatchSql = (fieldSql = "p.name", param = "$4") => {
  const cases = STOREFRONT_KNOWN_BRAND_PREFIXES.map((brand) => {
    const normalized = normalizeBrandFacetText(brand).replace(/'/g, "''");
    return `WHEN LOWER(TRIM(COALESCE(${fieldSql}, ''))) = '${normalized}' OR LOWER(TRIM(COALESCE(${fieldSql}, ''))) LIKE '${normalized} %' THEN '${normalized}'`;
  }).join(" ");
  return `CASE ${cases} ELSE '' END = LOWER(TRIM(${param}))`;
};

const normalizeProduct = (row = {}, pricingSettings = STOREFRONT_PRICING_DEFAULTS) => {
  const galleryImages = parseJsonArray(row.gallery_images).filter(Boolean);
  const productImage = firstText(row.public_image_url, row.image_url, row.image, row.photo_url, row.thumbnail_url, galleryImages[0]);
  const productCompareFields = {
    use_custom_compare_price: row.use_custom_compare_price,
    custom_compare_price: row.custom_compare_price,
  };
  const customOriginalPrice = productCompareFields.use_custom_compare_price === true || String(productCompareFields.use_custom_compare_price || "").toLowerCase() === "true"
    ? roundMoney(productCompareFields.custom_compare_price)
    : 0;
  // A manually entered storefront compare price is an explicit presentation
  // choice, so it must win over the regular/base price aliases.
  const rowOriginalPrice = roundMoney(customOriginalPrice || row.original_price || row.base_price || row.list_price || row.compare_at_price || row.regular_price);
  // Offer membership is a product-level fact; every variant of a curated offer prices as an offer.
  const rowForcedOffer = isForcedOfferSale(row);
  const rowPublicPrice = resolveCustomerFacingDisplayPrice(row, {}, pricingSettings);
  const rowResolvedSellingPrice = resolveCurrentSellingPrice({ product: row }).value;
  const rowSellingPrice = roundMoney(rowResolvedSellingPrice || rowPublicPrice.selling_price || row.selling_price || row.price || row.regular_price);
  const rowSalePrice = roundMoney(rowPublicPrice.sale_price || row.sale_price || row.offer_price);
  const variants = parseJsonArray(row.variants).map((variant) => {
    const variantPublicPrice = resolveCustomerFacingDisplayPrice(row, variant, pricingSettings);
    const variantResolvedSellingPrice = resolveCurrentSellingPrice({ product: row, variant }).value;
    const variantSellingPrice = roundMoney(variantResolvedSellingPrice || variantPublicPrice.selling_price || variant.selling_price || variant.price || rowSellingPrice);
    const variantOriginalCandidates = [
      variant.original_price,
      variant.base_price,
      variant.list_price,
      variant.regular_price,
      rowOriginalPrice,
      variant.compare_at_price,
    ].map(roundMoney).filter((value) => value > 0);
    const variantOriginalPrice = variantOriginalCandidates.find((value) => value > variantSellingPrice) || rowOriginalPrice || variantOriginalCandidates[0] || 0;
    const variantSalePrice = roundMoney(variantPublicPrice.sale_price || variant.sale_price || rowSalePrice);
    const resolvedPrice = resolveStorefrontActivePrice({
      originalPrice: variantOriginalPrice,
      sellingPrice: variantSellingPrice,
      salePrice: variantSalePrice,
      pricingSettings,
      forcedOffer: rowForcedOffer || isForcedOfferSale(variant),
    });
    const currentPrice = resolvedPrice.activePrice;
    const variantCompareAtPrice = resolvedPrice.compareAtPrice;
    // Derivation helpers hoisted out of the object literal below. Every expression is
    // pure and independent, so the emitted object is byte-for-byte identical, including
    // key order.
    const variantEditionName = firstText(variant.edition_name);
    const variantEditionSlug = firstText(variant.edition_slug, slugifyEdition(variant.edition_name));
    const variantImageUrl = firstText(variant.image_url, productImage);
    const variantPurchaseSalePrice = roundMoney(variant.purchase_sale_price);
    const variantPurchaseInvoiceSalePrice = roundMoney(variant.purchase_invoice_sale_price ?? variant.purchase_sale_price);
    const variantPurchaseInvoiceSellingPrice = roundMoney(variant.purchase_invoice_selling_price);
    const variantLastPieceSalePrice = roundMoney(variant.last_piece_sale_price ?? variant.purchase_sale_price);
    const variantStock = Math.max(0, toNumber(variant.stock));
    const normalizedVariant = {
      ...variant,
      id: variant.id,
      edition_name: variantEditionName,
      edition_slug: variantEditionSlug,
      image_url: variantImageUrl,
      original_price: variantOriginalPrice,
      base_price: variantOriginalPrice,
      list_price: variantOriginalPrice,
      compare_base_price: variantOriginalPrice,
      custom_compare_price: variantOriginalPrice,
      selling_price: variantSellingPrice,
      current_selling_price: variantSellingPrice,
      regular_price: variantOriginalPrice,
      price: currentPrice || variantSellingPrice,
      sale_price: variantSalePrice,
      purchase_sale_price: variantPurchaseSalePrice,
      purchase_invoice_sale_price: variantPurchaseInvoiceSalePrice,
      purchase_invoice_selling_price: variantPurchaseInvoiceSellingPrice,
      last_piece_sale_price: variantLastPieceSalePrice,
      final_price: currentPrice || variantSellingPrice,
      sale_price_enabled: resolvedPrice.saleActive,
      sale_prices_enabled: resolvedPrice.saleModeOn,
      global_sale_enabled: resolvedPrice.saleModeOn,
      sale_mode_enabled: resolvedPrice.saleModeOn,
      sale_source: resolvedPrice.saleActive ? "product" : "regular",
      sale_badge: resolvedPrice.saleActive ? (pricingSettings.sale_mode_label || variant.sale_reason || row.sale_reason || "Sale") : "",
      sale_mode_applied: resolvedPrice.saleActive,
      compare_at_price: variantCompareAtPrice,
      old_price: variantCompareAtPrice,
      stock: variantStock,
    };
    return normalizedVariant;
  });
  const totalStock = variants.length
    ? Math.max(variants.reduce((sum, variant) => sum + toNumber(variant.stock), 0), toNumber(row.variant_total_stock))
    : Math.max(0, toNumber(row.stock), toNumber(row.variant_total_stock));
  const variantPriceOptions = variants
    .filter((variant) => variant.price > 0 || variant.final_price > 0)
    .sort((a, b) => (b.stock > 0) - (a.stock > 0) || (a.final_price || a.price) - (b.final_price || b.price));
  const bestVariantPrice = variantPriceOptions[0];
  const originalPrice = rowOriginalPrice || bestVariantPrice?.original_price || 0;
  const sellingPrice = rowSellingPrice || bestVariantPrice?.selling_price || bestVariantPrice?.price || 0;
  const productResolvedPrice = resolveStorefrontActivePrice({ originalPrice, sellingPrice, salePrice: rowSalePrice, pricingSettings, forcedOffer: rowForcedOffer });
  const currentPrice = bestVariantPrice?.final_price || productResolvedPrice.activePrice || sellingPrice;
  const selectedDisplayPrice = currentPrice;
  const saleModeActive = productResolvedPrice.saleActive || Boolean(bestVariantPrice?.sale_mode_applied);
  const compareAtPrice = bestVariantPrice?.compare_at_price || productResolvedPrice.compareAtPrice;
  const discount = compareAtPrice > currentPrice && currentPrice > 0;
  const resolvedBrand = firstText(
    row.brand_name,
    row.brand,
    row.product_brand,
    row.brandName,
    row.manufacturer_brand,
    deriveKnownBrandLabel([row.name, row.title, row.product_name, row.productName, row.label, row.display_name].filter(Boolean).join(" "))
  );

  const product = {
    id: row.id,
    slug: firstText(row.slug, row.canonical_slug, slugifyProductName(row.name), `${row.id}`),
    name: row.name || "",
    sku: row.sku || "",
    barcode: row.barcode || "",
    category: row.category_name || "",
    category_id: row.category_id || null,
    gender: row.gender || "",
    audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
    product_audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
    product_type: row.product_type || "",
    productType: row.product_type || "",
    grade: row.grade || "",
    brand: resolvedBrand,
    brand_name: resolvedBrand,
    brandName: resolvedBrand,
    product_brand: row.product_brand || resolvedBrand,
    manufacturer_brand: row.manufacturer_brand || "",
    manufacturer: row.manufacturer || row.manufacturer_name || "",
    manufacturer_name: row.manufacturer_name || row.manufacturer || "",
    image_url: firstText(productImage, variants.find((variant) => variant.image_url)?.image_url),
    gallery_images: [...new Set([productImage, ...galleryImages, ...variants.map((variant) => variant.image_url)].filter(Boolean))],
    description: row.description || "",
    description_ar: row.description_ar || "",
    description_en: row.description_en || "",
    meta_title: row.meta_title || "",
    seo_description: row.seo_description || row.description_en || row.description_ar || row.description || "",
    seo_keywords: row.seo_keywords || "",
    canonical_slug: row.canonical_slug || "",
    qr_token: row.qr_token || (row.id ? `SHOP-PROD-${row.id}` : ""),
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    regular_price: originalPrice,
    original_price: originalPrice,
    base_price: originalPrice,
    list_price: originalPrice,
    compare_base_price: originalPrice,
    custom_compare_price: originalPrice,
    selling_price: sellingPrice,
    current_selling_price: sellingPrice,
    price: selectedDisplayPrice,
    sale_price: rowSalePrice,
    offer_price: rowSalePrice,
    final_price: selectedDisplayPrice,
    sale_price_enabled: saleModeActive,
    sale_prices_enabled: productResolvedPrice.saleModeOn,
    global_sale_enabled: productResolvedPrice.saleModeOn,
    sale_mode_enabled: productResolvedPrice.saleModeOn,
    sale_source: saleModeActive ? "product" : "regular",
    sale_mode_applied: saleModeActive,
    sale_badge: saleModeActive ? (pricingSettings.sale_mode_label || row.sale_reason || "Sale") : "",
    is_offer_story:
      row.is_offer_story === true ||
      String(row.is_offer_story || "").toLowerCase() === "true" ||
      row.isOfferStory === true ||
      String(row.isOfferStory || "").toLowerCase() === "true",
    is_storefront_visible:
      row.is_storefront_visible === true ||
      String(row.is_storefront_visible ?? "").toLowerCase() === "true" ||
      row.isStorefrontVisible === true ||
      String(row.isStorefrontVisible ?? "").toLowerCase() === "true" ||
      row.is_storefront_visible === undefined ||
      row.is_storefront_visible === null ||
      row.is_storefront_visible === "",
    sale_reason: row.sale_reason || "",
    sale_start_at: row.sale_start_at || null,
    sale_end_at: row.sale_end_at || null,
    compare_at_price: discount ? compareAtPrice : 0,
    old_price: discount ? compareAtPrice : 0,
    use_custom_compare_price: productCompareFields.use_custom_compare_price === true || String(productCompareFields.use_custom_compare_price || "").toLowerCase() === "true",
    custom_compare_price: roundMoney(productCompareFields.custom_compare_price),
    total_stock: totalStock,
    current_stock: totalStock,
    available_stock: totalStock,
    in_stock: totalStock > 0,
    stock_label: totalStock > 0 ? "IN STOCK" : "OUT OF STOCK",
    stock_status: totalStock > 0 ? "IN STOCK" : "OUT OF STOCK",
    sold_count: toNumber(row.sold_count),
    badge: discount ? "عرض" : totalStock <= 1 ? "آخر قطعة" : totalStock <= LOW_STOCK_LIMIT ? "سريع النفاذ" : "جديد",
    sizes: [...new Set(variants.filter((v) => v.stock > 0 && v.size).map((v) => v.size))],
    colors: [...new Set(variants.filter((v) => v.stock > 0 && v.color).map((v) => v.color))],
    variants,
    low_stock: totalStock > 0 && totalStock <= LOW_STOCK_LIMIT,
  };
  return {
    ...product,
    is_mirror: isMirrorProduct(product),
    seo_title: mirrorProductTitle(product, variants[0]),
  };
};

const productSeoTitle = (product = {}) => firstText(product.meta_title, product.seo_title, product.name, "Product");
const productSeoDescription = (product = {}) => firstText(product.seo_description, product.description_en, product.description_ar, product.description, product.name);

const attachSocialMetadata = async (product = {}, req = null) => {
  const [ogImage, merchantPolicies] = await Promise.all([
    generateProductOgImage({ product, req }),
    loadStorefrontMerchantPolicyData({
      productPrice: product.final_price || product.current_selling_price || product.selling_price || product.price || 0,
    }),
  ]);
  const pageSlug = product.slug || product.canonical_slug || slugifyProductName(product.name) || product.id;
  return {
    ...product,
    og_image_url: ogImage.url,
    og_image_width: OG_IMAGE_WIDTH,
    og_image_height: OG_IMAGE_HEIGHT,
    og_image_cache_key: ogImage.cacheKey,
    merchant_policies: merchantPolicies,
    social_meta: {
      title: productSeoTitle(product),
      description: productSeoDescription(product),
      image: ogImage.url,
      image_width: OG_IMAGE_WIDTH,
      image_height: OG_IMAGE_HEIGHT,
      twitter_card: "summary_large_image",
      url: buildAbsolutePublicUrl(req, `/share/product/${pageSlug}`),
    },
  };
};

const deriveColorGroupsFromVariants = (variants = []) => {
  const seen = new Map();
  const orderedVariants = [...(Array.isArray(variants) ? variants : [])].sort((left, right) =>
    Number(left?.color_sort_order ?? left?.colorSortOrder ?? 0) - Number(right?.color_sort_order ?? right?.colorSortOrder ?? 0) ||
    Number(left?.id ?? left?.variant_id ?? 0) - Number(right?.id ?? right?.variant_id ?? 0)
  );
  for (const variant of orderedVariants) {
    const color = String(variant?.color || variant?.color_name || "").trim();
    const colorGroupKey = String(variant?.color_group_key || variant?.colorGroupKey || "").trim();
    const key = colorGroupKey.toLowerCase() || color.toLowerCase() || "default";
    if (!seen.has(key)) {
      seen.set(key, {
        color_group_key: colorGroupKey,
        color,
        color_name: color,
        color_value: color,
        color_sort_order: Math.max(0, Number(variant?.color_sort_order ?? variant?.colorSortOrder ?? 0) || 0),
        image_url: variant?.image_url || "",
      });
    }
  }
  return Array.from(seen.values());
};

// Storefront catalog query builder.
//
// The candidate row set - the exact (product_id, variant_id) pairs that reach the
// aggregate - is defined ONCE, in the `candidate_rows` CTE, and reused by both the
// purchase-price resolver and the projection. Callers pass their extra predicate as
// `where` and their GROUP BY / ORDER BY / LIMIT as `trailing`, so the candidate
// predicate has a single source of truth and is never duplicated or string-mutated.
//
// `last_color_purchase_price` keeps its name and its two consuming expressions
// byte-identical to the previous correlated LATERAL. Its semantics are unchanged and
// were proven equivalent against all 8407 production variants: variant-id OR
// normalized color with no precedence between them, ordered by
// pu.created_at DESC NULLS LAST then pi.id DESC, the same tenant/null-tenant rules,
// the same excluded purchase statuses and the same price-positivity rules.
const catalogVariantJoinSql = `
    AND pv.is_active IS DISTINCT FROM FALSE
    AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
    AND pv.deleted_at IS NULL`;

const catalogSelectListSql = `  SELECT
    p.*,
    c.name AS category_name,
    b.name AS brand_name,
    m.name AS manufacturer_name,
    COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS public_image_url,
    COALESCE((SELECT jsonb_agg(pa.audience ORDER BY pa.audience) FROM product_audiences pa WHERE pa.product_id = p.id), '[]'::jsonb) AS audiences,
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0), 0))
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND ($1::bigint IS NULL OR COALESCE(oi.tenant_id, o.tenant_id) = $1::bigint)
        AND COALESCE(NULLIF(LOWER(TRIM(o.status)), ''), 'delivered') NOT IN ('cancelled', 'canceled', 'void', 'returned')
    ), 0)::int AS sold_count,
    COALESCE(SUM(CASE WHEN pv.id IS NOT NULL THEN GREATEST(COALESCE(pv.stock, 0), 0) ELSE 0 END), 0) AS variant_total_stock,
    COALESCE(BOOL_OR(pv.sale_price > 0 AND pv.sale_price < COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), pv.regular_price)) FILTER (WHERE pv.id IS NOT NULL), FALSE) AS has_variant_discount,
    COALESCE(
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'id', pv.id,
          'product_id', pv.product_id,
          'size', pv.size,
          'color', pv.color,
          'color_group_key', pv.color_group_key,
          'color_sort_order', pv.color_sort_order,
          'is_storefront_visible', pv.is_storefront_visible,
          'audience', pv.audience,
          'audiences', string_to_array(LOWER(REPLACE(COALESCE(pv.audience, ''), ' ', '')), ','),
          'sku', pv.sku,
          'barcode', pv.barcode,
          'edition_name', pv.edition_name,
          'edition_slug', pv.edition_slug,
          'image_url', COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pv.photo_url, ''), NULLIF(pv.thumbnail_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), ''),
          'purchase_selling_price', COALESCE(last_color_purchase_price.purchase_selling_price, pv.purchase_selling_price),
          'manual_selling_price', pv.manual_selling_price,
          'manual_price_override_active', pv.manual_price_override_active,
          'price', COALESCE(NULLIF(pv.selling_price, 0), pv.price),
          'selling_price', COALESCE(NULLIF(pv.selling_price, 0), pv.price),
          'regular_price', COALESCE(NULLIF(pv.regular_price, 0), pv.price),
          'original_price', COALESCE(NULLIF(pv.regular_price, 0), NULLIF(p.regular_price, 0), pv.price),
          'base_price', COALESCE(NULLIF(pv.regular_price, 0), NULLIF(p.regular_price, 0), pv.price),
          'list_price', COALESCE(NULLIF(pv.regular_price, 0), NULLIF(p.regular_price, 0), pv.price),
          'compare_base_price', COALESCE(NULLIF(p.custom_compare_price, 0), NULLIF(pv.regular_price, 0), NULLIF(p.regular_price, 0), pv.price),
          'custom_compare_price', COALESCE(NULLIF(p.custom_compare_price, 0), NULLIF(pv.regular_price, 0), NULLIF(p.regular_price, 0), pv.price),
          'sale_price', COALESCE(last_color_purchase_price.purchase_sale_price, pv.sale_price),
          'sale_price_enabled', pv.sale_price_enabled,
          'sale_start_at', pv.sale_start_at,
          'sale_end_at', pv.sale_end_at,
          'cost_price', pv.cost_price,
          'stock', pv.stock
        )
      ) FILTER (WHERE pv.id IS NOT NULL),
      '[]'::jsonb
    ) AS variants`;

// The same projection without two avoidable costs. Selected by
// STOREFRONT_FAST_CATALOG_SQL; default OFF so it can be proven in production and
// switched back without a redeploy.
//
//  1. jsonb_agg(DISTINCT jsonb_build_object(...35 keys...)) makes Postgres sort
//     every variant by its whole serialised jsonb value in order to deduplicate.
//     The DISTINCT is redundant: candidate_rows yields one row per
//     (product, variant) -- its other joins (categories, brands, manufacturers)
//     are many-to-one on primary keys, the outer query joins product_variants on
//     its primary key, and last_color_purchase_price is DISTINCT ON its key. So
//     nothing can duplicate a variant. Ordering by two scalars instead is cheaper
//     AND more deterministic than ordering by jsonb text.
//
//  2. sold_count is a correlated subquery, re-scanning order_items JOIN orders
//     once per product row -- ~1000 scans per cold build. The fast form reads the
//     same numbers from one grouped pass (candidate_sold, injected by
//     buildCatalogQuery) and takes MAX over the group. candidate_sold holds
//     exactly one row per product, so MAX is that row's value, and using an
//     aggregate means no caller-supplied GROUP BY has to change.
//
// Derived by transforming the string above rather than maintaining a second copy,
// so the two cannot drift. Each step asserts, so an edit that breaks an anchor
// fails at boot instead of silently serving the slow shape.
const fastCatalogSelectListSql = (() => {
  const replaceOnce = (text, find, replacement, label) => {
    const count = text.split(find).length - 1;
    if (count !== 1) {
      throw new Error(`fastCatalogSelectListSql: "${label}" matched ${count} times, expected 1`);
    }
    return text.replace(find, replacement);
  };

  const soldCountSubquery = `COALESCE((
      SELECT SUM(GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0), 0))
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND ($1::bigint IS NULL OR COALESCE(oi.tenant_id, o.tenant_id) = $1::bigint)
        AND COALESCE(NULLIF(LOWER(TRIM(o.status)), ''), 'delivered') NOT IN ('cancelled', 'canceled', 'void', 'returned')
    ), 0)::int AS sold_count,`;

  let sql = catalogSelectListSql;
  sql = replaceOnce(sql, soldCountSubquery, "COALESCE(MAX(candidate_sold.sold_count), 0)::int AS sold_count,", "sold_count");
  sql = replaceOnce(sql, "DISTINCT jsonb_build_object(", "jsonb_build_object(", "jsonb_agg DISTINCT");
  sql = replaceOnce(
    sql,
    `      ) FILTER (WHERE pv.id IS NOT NULL),
      '[]'::jsonb
    ) AS variants`,
    `      ORDER BY pv.color_sort_order NULLS LAST, pv.id) FILTER (WHERE pv.id IS NOT NULL),
      '[]'::jsonb
    ) AS variants`,
    "jsonb_agg ordering",
  );
  return sql;
})();

const buildCatalogQuery = ({ where = "", trailing = "", productVisibility = true, fast = false } = {}) => `
  WITH candidate_rows AS MATERIALIZED (
    SELECT p.id AS product_id, pv.id AS variant_id
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id${catalogVariantJoinSql}
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
    AND p.is_active IS DISTINCT FROM FALSE
    AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
${productVisibility ? `    AND ${storefrontVisibilityConditionSql}\n` : ""}${where}
  ),
  candidate_purchase_items AS MATERIALIZED (
    SELECT
      pi.id AS pi_id,
      pi.product_id AS product_id,
      pi.variant_id AS pi_variant_id,
      pi.tenant_id AS pi_tenant_id,
      pu.tenant_id AS pu_tenant_id,
      pu.created_at AS pu_created_at,
      COALESCE(LOWER(TRIM(pi.metadata->>'color')), '') AS match_color,
      COALESCE(NULLIF(pi.selling_price, 0), NULLIF(pi.regular_price, 0)) AS purchase_selling_price,
      NULLIF(pi.sale_price, 0) AS purchase_sale_price
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE COALESCE(NULLIF(LOWER(TRIM(pu.status)), ''), 'received') NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')
      AND (
        COALESCE(NULLIF(pi.selling_price, 0), NULLIF(pi.regular_price, 0)) > 0
        OR NULLIF(pi.sale_price, 0) > 0
      )
      AND EXISTS (SELECT 1 FROM candidate_rows cr_pi WHERE cr_pi.product_id = pi.product_id)
  ),
  candidate_purchase_matches AS (
    SELECT
      cr_variant.variant_id AS variant_pk,
      cpi.pu_created_at,
      cpi.pi_id,
      cpi.purchase_selling_price,
      cpi.purchase_sale_price
    FROM candidate_purchase_items cpi
    JOIN candidate_rows cr_variant
      ON cr_variant.variant_id = cpi.pi_variant_id
     AND cr_variant.product_id = cpi.product_id
    JOIN products p_variant ON p_variant.id = cr_variant.product_id
    WHERE (cpi.pi_tenant_id = p_variant.tenant_id OR cpi.pi_tenant_id IS NULL)
      AND (cpi.pu_tenant_id = p_variant.tenant_id OR cpi.pu_tenant_id IS NULL)
    UNION ALL
    SELECT
      cr_color.variant_id AS variant_pk,
      cpi.pu_created_at,
      cpi.pi_id,
      cpi.purchase_selling_price,
      cpi.purchase_sale_price
    FROM candidate_purchase_items cpi
    JOIN candidate_rows cr_color ON cr_color.product_id = cpi.product_id
    JOIN product_variants pv_color
      ON pv_color.id = cr_color.variant_id
     AND cpi.match_color <> ''
     AND cpi.match_color = LOWER(TRIM(pv_color.color))
    JOIN products p_color ON p_color.id = cr_color.product_id
    WHERE (cpi.pi_tenant_id = p_color.tenant_id OR cpi.pi_tenant_id IS NULL)
      AND (cpi.pu_tenant_id = p_color.tenant_id OR cpi.pu_tenant_id IS NULL)
  ),
  last_color_purchase_price AS (
    SELECT DISTINCT ON (variant_pk)
      variant_pk,
      pu_created_at,
      pi_id,
      purchase_selling_price,
      purchase_sale_price
    FROM candidate_purchase_matches
    ORDER BY variant_pk, pu_created_at DESC NULLS LAST, pi_id DESC
  )${fast ? `,
  -- One grouped pass over order_items for every candidate product, replacing the
  -- per-product correlated subquery in the default projection. Restricted to the
  -- same product set the correlated form could ever be evaluated for, so a product
  -- with no matching order rows is absent here and COALESCE(MAX(...), 0) yields the
  -- same 0 the correlated COALESCE(..., 0) yielded.
  candidate_sold AS (
    SELECT
      oi.product_id AS product_id,
      SUM(GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0), 0)) AS sold_count
    FROM order_items oi
    LEFT JOIN orders o ON o.id = oi.order_id
    WHERE EXISTS (SELECT 1 FROM candidate_rows cr_sold WHERE cr_sold.product_id = oi.product_id)
      AND ($1::bigint IS NULL OR COALESCE(oi.tenant_id, o.tenant_id) = $1::bigint)
      AND COALESCE(NULLIF(LOWER(TRIM(o.status)), ''), 'delivered') NOT IN ('cancelled', 'canceled', 'void', 'returned')
    GROUP BY oi.product_id
  )` : ""}
${fast ? fastCatalogSelectListSql : catalogSelectListSql}
  FROM candidate_rows cr
  JOIN products p ON p.id = cr.product_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
  LEFT JOIN product_variants pv ON pv.id = cr.variant_id
  LEFT JOIN last_color_purchase_price ON last_color_purchase_price.variant_pk = pv.id${fast ? `
  LEFT JOIN candidate_sold ON candidate_sold.product_id = p.id` : ""}
${trailing}
`;

const lookupAny = (fieldSql, identifierParam) => `EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE LOWER(TRIM(COALESCE(${fieldSql}, ''))) = LOWER(TRIM(lookup.value)))`;
const lookupFirst = (fieldSql, identifierParam) => `LOWER(TRIM(COALESCE(${fieldSql}, ''))) = LOWER(TRIM((${identifierParam}::text[])[1]))`;
const productIdentifierClause = (identifierParam = "$2") => `
  AND (
    ${lookupAny("p.slug", identifierParam)}
    OR ${lookupAny("p.canonical_slug", identifierParam)}
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE ${productGeneratedSlugSql("p.name")} = LOWER(TRIM(lookup.value)))
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE ${productGeneratedSlugSql("CONCAT_WS(' ', b.name, p.name)")} = LOWER(TRIM(lookup.value)))
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE TRIM(lookup.value) ~ '^[0-9]+$' AND TRIM(lookup.value)::bigint = p.id)
    OR ${lookupAny("p.sku", identifierParam)}
    OR ${lookupAny("p.product_code", identifierParam)}
    OR ${lookupAny("p.barcode", identifierParam)}
    OR ${lookupAny("p.qr_token", identifierParam)}
    OR EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE substring(TRIM(lookup.value) from '^SHOP-PROD-([0-9]+)') IS NOT NULL AND substring(TRIM(lookup.value) from '^SHOP-PROD-([0-9]+)')::bigint = p.id)
    OR EXISTS (
      SELECT 1
      FROM product_variants pv_lookup
      WHERE pv_lookup.product_id = p.id
        AND pv_lookup.is_active IS DISTINCT FROM FALSE
        AND COALESCE(pv_lookup.is_storefront_visible, TRUE) = TRUE
        AND pv_lookup.deleted_at IS NULL
        AND (
          ${lookupAny("pv_lookup.sku", identifierParam)}
          OR ${lookupAny("pv_lookup.barcode", identifierParam)}
          OR ${lookupAny("pv_lookup.edition_slug", identifierParam)}
        )
    )
  )
`;

const productIdentifierOrder = (identifierParam = "$2") => `
  ORDER BY
    CASE
      WHEN ${lookupFirst("p.slug", identifierParam)} THEN 0
      WHEN ${lookupAny("p.slug", identifierParam)} THEN 1
      WHEN ${lookupFirst("p.canonical_slug", identifierParam)} THEN 2
      WHEN ${lookupAny("p.canonical_slug", identifierParam)} THEN 3
      WHEN EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE ${productGeneratedSlugSql("p.name")} = LOWER(TRIM(lookup.value))) THEN 4
      WHEN EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE ${productGeneratedSlugSql("CONCAT_WS(' ', b.name, p.name)")} = LOWER(TRIM(lookup.value))) THEN 5
      WHEN EXISTS (SELECT 1 FROM unnest(${identifierParam}::text[]) AS lookup(value) WHERE TRIM(lookup.value) ~ '^[0-9]+$' AND TRIM(lookup.value)::bigint = p.id) THEN 6
      WHEN ${lookupAny("p.sku", identifierParam)} THEN 7
      WHEN ${lookupAny("p.product_code", identifierParam)} THEN 8
      WHEN ${lookupAny("p.barcode", identifierParam)} THEN 9
      WHEN ${lookupAny("p.qr_token", identifierParam)} THEN 10
      ELSE 99
    END,
    p.id ASC
`;

const findStorefrontProductId = async (tenantId, identifiers) => {
  const result = await db.query(
    `
      SELECT p.id
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
        AND p.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
        AND ${storefrontVisibilityConditionSql}
        ${productIdentifierClause("$2")}
      ${productIdentifierOrder("$2")}
      LIMIT 1
    `,
    [tenantId, identifiers]
  );
  return result.rows[0]?.id || null;
};

const loadStorefrontProductRowById = async (tenantId, productId) => {
  if (!productId) return null;
  const result = await db.query(
    buildCatalogQuery({ where: "AND p.id = $2", trailing: "GROUP BY p.id, c.name, b.name, m.name LIMIT 1" }),
    [tenantId, productId]
  );
  return result.rows[0] || null;
};

const productAudienceFilterSql = (param = "$5") => `
  (
    COALESCE(array_length(${param}::text[], 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM product_variants pv_audience
      WHERE pv_audience.product_id = p.id
        AND pv_audience.is_active IS DISTINCT FROM FALSE
        AND COALESCE(pv_audience.is_storefront_visible, TRUE) = TRUE
        AND pv_audience.deleted_at IS NULL
        AND string_to_array(LOWER(REPLACE(COALESCE(pv_audience.audience, ''), ' ', '')), ',') && ${param}::text[]
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM product_variants pv_audience_any
        WHERE pv_audience_any.product_id = p.id
          AND COALESCE(TRIM(pv_audience_any.audience), '') <> ''
          AND pv_audience_any.is_active IS DISTINCT FROM FALSE
          AND COALESCE(pv_audience_any.is_storefront_visible, TRUE) = TRUE
          AND pv_audience_any.deleted_at IS NULL
      )
      AND EXISTS (
      SELECT 1
      FROM product_audiences pa_filter
      WHERE pa_filter.product_id = p.id
        AND pa_filter.audience = ANY(${param}::text[])
      )
    )
    OR (
      NOT EXISTS (SELECT 1 FROM product_variants pv_audience_any WHERE pv_audience_any.product_id = p.id AND COALESCE(pv_audience_any.is_storefront_visible, TRUE) = TRUE AND COALESCE(TRIM(pv_audience_any.audience), '') <> '')
      AND
      NOT EXISTS (SELECT 1 FROM product_audiences pa_any WHERE pa_any.product_id = p.id)
      AND LOWER(TRIM(COALESCE(p.gender, ''))) = ANY(${param}::text[])
    )
  )
`;

const productAudienceSearchSql = `
  EXISTS (
    SELECT 1
    FROM product_audiences pa_search
    WHERE pa_search.product_id = p.id
      AND pa_search.audience LIKE '%' || $2 || '%'
  )
`;

const storefrontProductsWhereSql = `
      AND ($2 = '' OR LOWER(CONCAT_WS(' ', p.name, p.sku, p.barcode, p.gender, p.product_type, c.name, b.name, pv.size, pv.color, pv.sku, pv.article_code, pv.edition_name, pv.edition_slug)) LIKE '%' || $2 || '%' OR ${productAudienceSearchSql})
      AND ($3 = '' OR LOWER(CONCAT_WS(' ', c.name, p.gender, p.product_type)) LIKE '%' || $3 || '%' OR EXISTS (SELECT 1 FROM product_audiences pa_category WHERE pa_category.product_id = p.id AND pa_category.audience LIKE '%' || $3 || '%'))
      AND (
        $4 = ''
        OR (TRIM($4) ~ '^[0-9]+$' AND b.id = $4::bigint)
        OR LOWER(TRIM(COALESCE(b.slug, ''))) = LOWER(TRIM($4))
        OR LOWER(TRIM(COALESCE(b.name, ''))) = LOWER(TRIM($4))
        OR LOWER(TRIM(COALESCE(m.name, ''))) = LOWER(TRIM($4))
        OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM($4))
        OR ${storefrontBrandMatchSql("p.name", "$4")}
      )
      AND (
        $5::boolean = FALSE
        OR (
          p.sale_price > 0
          AND p.sale_price < COALESCE(NULLIF(p.regular_price, 0), p.price)
          AND (p.sale_start_at IS NULL OR p.sale_start_at <= NOW())
          AND (p.sale_end_at IS NULL OR p.sale_end_at >= NOW())
        )
        OR (
          pv.sale_price > 0
          AND pv.sale_price < COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), pv.regular_price)
          AND (pv.sale_start_at IS NULL OR pv.sale_start_at <= NOW())
          AND (pv.sale_end_at IS NULL OR pv.sale_end_at >= NOW())
        )
      )
      AND ($6::boolean = FALSE OR COALESCE(p.is_offer_story, FALSE) = TRUE)
      AND ${productAudienceFilterSql("$7")}
      AND (COALESCE(array_length($8::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.product_type, ''))) = ANY($8::text[]))
      AND (COALESCE(array_length($9::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.grade, ''))) = ANY($9::text[]))
      AND (
        COALESCE(array_length($12::text[], 1), 0) = 0
        OR LOWER(TRIM(COALESCE(p.grade, ''))) = ANY($12::text[])
        OR LOWER(TRIM(COALESCE(p.product_type, ''))) = ANY($12::text[])
      )
      AND (COALESCE(array_length($15::text[], 1), 0) = 0 OR LOWER(TRIM(COALESCE(p.bag_type, ''))) = ANY($15::text[]))
      AND (COALESCE(array_length($10::text[], 1), 0) = 0 OR EXISTS (
        SELECT 1
        FROM product_variants pv_size
        WHERE pv_size.product_id = p.id
          AND pv_size.is_active IS DISTINCT FROM FALSE
          AND COALESCE(pv_size.is_storefront_visible, TRUE) = TRUE
          AND pv_size.deleted_at IS NULL
          AND LOWER(TRIM(COALESCE(pv_size.size, ''))) = ANY($10::text[])
          AND (COALESCE(array_length($7::text[], 1), 0) = 0 OR COALESCE(TRIM(pv_size.audience), '') = '' OR string_to_array(LOWER(REPLACE(pv_size.audience, ' ', '')), ',') && $7::text[])
          AND ($11::boolean = FALSE OR COALESCE(pv_size.stock, 0) > 0)
      ))
      AND ($11::boolean = FALSE OR COALESCE(p.stock, 0) > 0 OR EXISTS (
        SELECT 1
        FROM product_variants pv_stock
        WHERE pv_stock.product_id = p.id
          AND pv_stock.is_active IS DISTINCT FROM FALSE
          AND COALESCE(pv_stock.is_storefront_visible, TRUE) = TRUE
          AND pv_stock.deleted_at IS NULL
          AND COALESCE(pv_stock.stock, 0) > 0
    ))`;

const storefrontProductsTrailingSql = `    GROUP BY p.id, c.name, b.name, m.name
    ORDER BY
      CASE
        WHEN $6::boolean = TRUE THEN 0
        WHEN COALESCE(array_length($10::text[], 1), 0) > 0 THEN 0
        WHEN COALESCE(p.is_offer_story, FALSE) = TRUE THEN 1
        ELSE 0
      END ASC,
      p.id DESC
    LIMIT $13 OFFSET $14`;

export const storefrontProductsSql = buildCatalogQuery({
  where: storefrontProductsWhereSql,
  trailing: storefrontProductsTrailingSql,
});

// Same query, cheaper shape. Both are built at module load so the flag is a pure
// pointer swap at request time -- flipping STOREFRONT_FAST_CATALOG_SQL back needs
// only a restart, never a redeploy, and the slow form stays byte-identical to what
// production has always run.
export const storefrontProductsSqlFast = buildCatalogQuery({
  where: storefrontProductsWhereSql,
  trailing: storefrontProductsTrailingSql,
  fast: true,
});

const STOREFRONT_FAST_CATALOG_SQL = ["1", "true", "yes", "on"].includes(
  String(process.env.STOREFRONT_FAST_CATALOG_SQL || "").trim().toLowerCase(),
);

// The fast shape cannot be parse-checked before it runs, so it self-heals instead
// of trusting the flag. If Postgres rejects it STRUCTURALLY -- syntax, unknown
// relation/column/function, wrong argument types -- that is a defect in the derived
// SQL, never a property of the data, so the flag is dropped for the life of the
// process and the request is retried on the shape production has always run. The
// visitor gets a correct answer; the operator gets one loud line.
//
// Deliberately narrow: any other error (timeout, deadlock, connection loss) is a
// real failure and must propagate rather than be masked as a fallback.
const FAST_CATALOG_SQL_STRUCTURAL_CODES = new Set([
  "42601", // syntax_error
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "42P10", // invalid_column_reference
  "42804", // datatype_mismatch
  "42P18", // indeterminate_datatype
  "42809", // wrong_object_type
  "42702", // ambiguous_column
]);
let fastCatalogSqlDisabled = false;

export const fastCatalogSqlActive = () => STOREFRONT_FAST_CATALOG_SQL && !fastCatalogSqlDisabled;

// Relaxed-visibility fallback. Built from the same builder with the product-level
// storefront-visibility predicate omitted, instead of string-replacing it out of an
// already-assembled query. The variant-level visibility condition in the
// product_variants join is unaffected, exactly as before.
const storefrontProductsSqlWithoutVisibility = buildCatalogQuery({
  where: storefrontProductsWhereSql,
  trailing: storefrontProductsTrailingSql,
  productVisibility: false,
});

export const queryProductsWithSql = async (sql, tenantId, q, category, filters, saleOnly, limit, offset) => {
  const arrayParam = (value) => Array.isArray(value)
    ? value
    : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const lowerArrayParam = (value) => arrayParam(value).map((item) => item.toLowerCase());
  const params = [
    tenantId,
    q,
    category,
    filters.brand || "",
    saleOnly,
    Boolean(filters.offerStory),
    arrayParam(filters.gender),
    arrayParam(filters.productType),
    arrayParam(filters.grade),
    lowerArrayParam(filters.sizes ?? filters.size),
    Boolean(filters.inStock),
    arrayParam(filters.quality),
    limit,
    offset,
    lowerArrayParam(filters.bagType),
  ];
  try {
    const result = await db.query(sql, params);
    const selectedAudiences = Array.isArray(filters.gender) ? filters.gender : [];
    if (selectedAudiences.length > 0) {
      // Per-invocation memo, discarded when this call returns: no module-level cache
      // and nothing retained between requests. The key encodes BOTH arguments that
      // reach normalizeProductAudiences, so it is complete for any caller regardless
      // of how the supplied SQL projects `audiences`. Production carries only 15
      // distinct audience representations across every storefront-visible variant.
      const audienceMemo = new Map();
      const normalizeVariantAudiences = (variant) => {
        const rawList = variant?.audiences;
        const rawText = String(variant?.audience || "");
        const key = `${Array.isArray(rawList) ? rawList.join("\u0000") : String(rawList ?? "")}\u0001${rawText}`;
        let normalized = audienceMemo.get(key);
        if (normalized === undefined) {
          normalized = normalizeProductAudiences(rawList, rawText.split(","));
          audienceMemo.set(key, normalized);
        }
        return normalized;
      };
      result.rows = result.rows.map((row) => {
        const variants = Array.isArray(row.variants) ? row.variants : [];
        const scopedVariants = variants.filter((variant) => {
          const variantAudiences = normalizeVariantAudiences(variant);
          return variantAudiences.length === 0 || variantAudiences.some((audience) => selectedAudiences.includes(audience));
        });
        const matchedImage = scopedVariants.find((variant) => String(variant?.image_url || "").trim())?.image_url || "";
        return {
          ...row,
          variants: scopedVariants,
          ...(matchedImage ? { public_image_url: matchedImage } : {}),
        };
      });
    }
    return result;
  } catch (error) {
    error.sql = sql;
    error.params = params;
    throw error;
  }
};

export const queryProducts = async (tenantId, q, category, filters, saleOnly, limit, offset) => {
  if (!fastCatalogSqlActive()) {
    return queryProductsWithSql(storefrontProductsSql, tenantId, q, category, filters, saleOnly, limit, offset);
  }
  try {
    return await queryProductsWithSql(storefrontProductsSqlFast, tenantId, q, category, filters, saleOnly, limit, offset);
  } catch (error) {
    if (!FAST_CATALOG_SQL_STRUCTURAL_CODES.has(String(error?.code || ""))) throw error;
    fastCatalogSqlDisabled = true;
    console.error("[storefront] fast catalog SQL rejected by Postgres - falling back for the life of this process", {
      code: error?.code || "",
      message: error?.message || String(error),
      position: error?.position || "",
    });
    return queryProductsWithSql(storefrontProductsSql, tenantId, q, category, filters, saleOnly, limit, offset);
  }
};

export const queryProductsWithoutVisibility = async (tenantId, q, category, filters, saleOnly, limit, offset) =>
  queryProductsWithSql(storefrontProductsSqlWithoutVisibility, tenantId, q, category, filters, saleOnly, limit, offset);

const queryProductsByIds = async (tenantId, productIds = [], pricingSettings = STOREFRONT_PRICING_DEFAULTS, executor = db) => {
  const ids = productIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];
  let result = await executor.query(
    buildCatalogQuery({ where: "AND p.id = ANY($2::bigint[])", trailing: "GROUP BY p.id, c.name, b.name, m.name" }),
    [tenantId, ids]
  );
  if (!result.rows.length && tenantId !== null) {
    result = await executor.query(
      buildCatalogQuery({ where: "AND p.id = ANY($2::bigint[])", trailing: "GROUP BY p.id, c.name, b.name, m.name" }),
      [null, ids]
    );
  }
  const order = new Map(ids.map((id, index) => [String(id), index]));
  return result.rows
    .map((row) => normalizeProduct(row, pricingSettings))
    .sort((a, b) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999));
};

const normalizeVisualTerm = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniqueTerms = (values = []) => {
  const terms = [];
  const seen = new Set();
  for (const value of values.flatMap((item) => Array.isArray(item) ? item : String(item || "").split(/[,،|]/))) {
    const term = normalizeVisualTerm(value);
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms.slice(0, 18);
};

const visualSearchColumns = async () => {
  const columns = await tableColumns(db, "products");
  const optional = [
    "name_ar",
    "name_en",
    "description_ar",
    "description_en",
    "seo_keywords",
    "meta_keywords",
    "tags",
    "meta_title",
    "meta_title_ar",
    "meta_title_en",
    "seo_description",
    "seo_description_ar",
    "seo_description_en",
  ].filter((column) => columns.has(column));
  return [
    "p.name",
    "p.sku",
    "p.barcode",
    "p.description",
    "p.gender",
    "p.product_type",
    "p.grade",
    "c.name",
    "b.name",
    "pv.size",
    "pv.color",
    "pv.sku",
    "pv.barcode",
    "pv.edition_name",
    "pv.edition_slug",
    ...optional.map((column) => `p.${column}`),
  ];
};

const queryVisualKeywordProductIds = async (tenantId, terms = [], limit = 8) => {
  const keywords = uniqueTerms(terms);
  if (!keywords.length) return [];
  const fields = await visualSearchColumns();
  const searchBlob = `LOWER(CONCAT_WS(' ', ${fields.join(", ")}))`;
  const run = (scopeTenantId) => db.query(
    `
    SELECT p.id, COUNT(DISTINCT term.value)::int AS score
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id
      AND pv.is_active IS DISTINCT FROM FALSE
      AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
      AND pv.deleted_at IS NULL
    AND pv.is_active IS DISTINCT FROM FALSE
    AND pv.deleted_at IS NULL
    JOIN LATERAL unnest($2::text[]) AS term(value)
      ON ${searchBlob} LIKE '%' || term.value || '%'
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
      AND p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
      AND COALESCE(p.is_storefront_visible, TRUE) = TRUE
    GROUP BY p.id
    ORDER BY score DESC, p.id DESC
    LIMIT $3
    `,
    [scopeTenantId, keywords, limit]
  );
  let result = await run(tenantId);
  if (!result.rows.length && tenantId !== null) result = await run(null);
  return result.rows.map((row) => row.id);
};

const imageUploadRoots = () => [
  path.join(process.cwd(), "uploads"),
  path.join(process.cwd(), "server", "uploads"),
  path.join(process.cwd(), "..", "uploads"),
].map((item) => path.resolve(item));

const imageUrlToRelativeUploadPath = (imageUrl = "") => {
  const raw = toText(imageUrl);
  if (!raw || raw.startsWith("data:")) return "";
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    // Relative upload paths are already valid pathnames.
  }
  pathname = decodeURIComponent(pathname).replace(/\\/g, "/");
  if (pathname.startsWith("/uploads/")) return pathname.slice("/uploads/".length);
  if (pathname.startsWith("uploads/")) return pathname.slice("uploads/".length);
  if (pathname.startsWith("/products/")) return pathname.slice(1);
  if (pathname.startsWith("products/")) return pathname;
  return "";
};

const findLocalUploadFile = async (imageUrl = "") => {
  const relative = imageUrlToRelativeUploadPath(imageUrl);
  if (!relative) return "";
  for (const root of imageUploadRoots()) {
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(root)) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next known upload root
    }
  }
  return "";
};

const imageDataUrlToBuffer = (imageUrl = "") => {
  const text = toText(imageUrl);
  const match = text.match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
};

const isRemoteImageUrl = (imageUrl = "") => /^https?:\/\//i.test(toText(imageUrl));

const loadRemoteImageBuffer = async (imageUrl = "") => {
  const text = toText(imageUrl);
  if (!isRemoteImageUrl(text)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISUAL_REMOTE_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(text, {
      signal: controller.signal,
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > VISUAL_REMOTE_IMAGE_MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > VISUAL_REMOTE_IMAGE_MAX_BYTES) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const loadCandidateImageBuffer = async (imageUrl = "", options = {}) => {
  const dataBuffer = imageDataUrlToBuffer(imageUrl);
  if (dataBuffer?.length) return { buffer: dataBuffer, source: "data_url" };
  const filePath = await findLocalUploadFile(imageUrl);
  if (filePath) return { buffer: await readFile(filePath), source: "upload_file" };
  if (options.allowRemote) {
    const remoteBuffer = await loadRemoteImageBuffer(imageUrl);
    if (remoteBuffer?.length) return { buffer: remoteBuffer, source: "remote_url" };
  }
  return { buffer: null, source: "" };
};

const imageSha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const imagePerceptualHash = async (input) => {
  const pixels = await sharp(input)
    .rotate()
    .resize(VISUAL_HASH_SIZE, VISUAL_HASH_SIZE, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const avg = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  return Array.from(pixels, (value) => (value >= avg ? "1" : "0")).join("");
};

const imageDifferenceHash = async (input) => {
  const width = VISUAL_HASH_SIZE + 1;
  const height = VISUAL_HASH_SIZE;
  const pixels = await sharp(input)
    .rotate()
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const bits = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < VISUAL_HASH_SIZE; x += 1) {
      const left = pixels[y * width + x] || 0;
      const right = pixels[y * width + x + 1] || 0;
      bits.push(left > right ? "1" : "0");
    }
  }
  return bits.join("");
};

const imageContentCropBuffer = async (input) => {
  const base = sharp(input).rotate().removeAlpha();
  const metadata = await base.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (width < 16 || height < 16) return null;
  const { data, info } = await base
    .resize(180, 180, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const r = data[index] || 0;
      const g = data[index + 1] || 0;
      const b = data[index + 2] || 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;
      const isFlatLightBackground = r > 232 && g > 232 && b > 232 && chroma < 24;
      const isFlatTransparentStyleBackground = r > 245 && g > 245 && b > 245;
      if (isFlatLightBackground || isFlatTransparentStyleBackground) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const scaleX = width / info.width;
  const scaleY = height / info.height;
  const padX = Math.max(4, Math.round((maxX - minX + 1) * 0.12));
  const padY = Math.max(4, Math.round((maxY - minY + 1) * 0.16));
  const left = Math.max(0, Math.floor((minX - padX) * scaleX));
  const top = Math.max(0, Math.floor((minY - padY) * scaleY));
  const cropWidth = Math.min(width - left, Math.ceil((maxX - minX + 1 + padX * 2) * scaleX));
  const cropHeight = Math.min(height - top, Math.ceil((maxY - minY + 1 + padY * 2) * scaleY));
  if (cropWidth < 10 || cropHeight < 10 || cropWidth * cropHeight > width * height * 0.92) return null;
  return sharp(input)
    .rotate()
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
};

const imagePerceptualHashes = async (input) => {
  const baseHash = await imagePerceptualHash(input);
  const cropped = await imageContentCropBuffer(input).catch(() => null);
  if (!cropped?.length) return { primary: baseHash, all: [baseHash] };
  const cropHash = await imagePerceptualHash(cropped).catch(() => "");
  return { primary: baseHash, all: [...new Set([baseHash, cropHash].filter(Boolean))] };
};

const imageShapeHashes = async (input) => {
  const full = await imageDifferenceHash(input).catch(() => "");
  const cropped = await imageContentCropBuffer(input).catch(() => null);
  const crop = cropped?.length ? await imageDifferenceHash(cropped).catch(() => "") : "";
  return [...new Set([full, crop].filter(Boolean))];
};

const hashDistance = (a = "", b = "") => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance;
};

const rgbToHsl = (r = 0, g = 0, b = 0) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
};

const imageColorSignature = async (input) => {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(56, 56, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Array(12).fill(0);
  let totalWeight = 0;
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index] || 0;
    const g = data[index + 1] || 0;
    const b = data[index + 2] || 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const isWhiteBackground = r > 238 && g > 238 && b > 238 && chroma < 18;
    const isNearBlackShadow = r < 18 && g < 18 && b < 18;
    const weight = isWhiteBackground || isNearBlackShadow ? 0.15 : 1;
    const { h, s } = rgbToHsl(r, g, b);
    const bucket = Math.min(11, Math.max(0, Math.floor(h * 12)));
    buckets[bucket] += weight * (0.4 + s);
    avgR += r * weight;
    avgG += g * weight;
    avgB += b * weight;
    totalWeight += weight;
  }
  if (!totalWeight) return null;
  const histogramTotal = buckets.reduce((sum, value) => sum + value, 0) || 1;
  return {
    avg: [avgR / totalWeight, avgG / totalWeight, avgB / totalWeight],
    histogram: buckets.map((value) => value / histogramTotal),
  };
};

const colorSignatureSimilarity = (a, b) => {
  if (!a || !b) return 0;
  const histogramDistance = a.histogram.reduce((sum, value, index) => sum + Math.abs(value - (b.histogram[index] || 0)), 0) / 2;
  const rgbDistance = Math.sqrt(a.avg.reduce((sum, value, index) => sum + ((value - (b.avg[index] || 0)) ** 2), 0)) / 441.7;
  return Math.max(0, Math.min(1, 1 - (histogramDistance * 0.65 + rgbDistance * 0.35)));
};

const visualModelFamilyKey = (product = {}) => {
  const blob = [
    product.brand,
    product.brand_name,
    product.name,
    product.product_type,
    product.description,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const brand = blob.includes("adidas") ? "adidas"
    : blob.includes("nike") ? "nike"
      : blob.includes("puma") ? "puma"
        : blob.includes("skecher") ? "skechers"
          : blob.includes("new balance") ? "new balance"
            : String(product.brand || product.brand_name || "").toLowerCase().trim();
  const model = /\bsuper\s*star\b|\bsuperstar\b/.test(blob) ? "superstar"
    : /\bsamba\b/.test(blob) ? "samba"
      : /\bcampus\b/.test(blob) ? "campus"
        : /\bair\s*force\b|\baf1\b/.test(blob) ? "air force 1"
          : /\bdunk\b/.test(blob) ? "dunk"
            : /\bjordan\s*4\b|\baj4\b|\bj4\b/.test(blob) ? "jordan 4"
              : /\bjordan\s*1\b|\bair\s*jordan\s*1\b/.test(blob) ? "jordan 1"
                : /\bsb\b/.test(blob) ? "sb"
                  : "";
  return brand && model ? `${brand}:${model}` : "";
};

const visualSignatureCache = new Map();

const trimVisualSignatureCache = () => {
  while (visualSignatureCache.size > VISUAL_SIGNATURE_CACHE_LIMIT) {
    const firstKey = visualSignatureCache.keys().next().value;
    if (!firstKey) break;
    visualSignatureCache.delete(firstKey);
  }
};

const getCandidateVisualSignature = async (imageUrl = "", options = {}) => {
  const key = toText(imageUrl);
  if (!key) return null;
  const cached = visualSignatureCache.get(key);
  if (cached) {
    visualSignatureCache.delete(key);
    visualSignatureCache.set(key, cached);
    return { ...cached, cached: true };
  }

  const loaded = await loadCandidateImageBuffer(key, options);
  if (!loaded.buffer?.length) return null;
  const [hashes, color] = await Promise.all([
    imagePerceptualHashes(loaded.buffer),
    imageColorSignature(loaded.buffer).catch(() => null),
  ]);
  const shapeHashes = await imageShapeHashes(loaded.buffer).catch(() => []);
  const signature = {
    source: loaded.source,
    sha: imageSha256(loaded.buffer),
    hash: hashes.primary,
    hashes: hashes.all,
    shapeHashes,
    color,
  };
  visualSignatureCache.set(key, signature);
  trimVisualSignatureCache();
  return { ...signature, cached: false };
};

const collectProductImageUrls = (product = {}) => [
  product.image_url,
  product.product_image_url,
  product.public_image_url,
  ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
  ...(Array.isArray(product.variants) ? product.variants.flatMap((variant) => [
    variant.image_url,
    variant.primary_image_url,
    variant.variant_image_url,
    variant.color_image_url,
    ...(Array.isArray(variant.images) ? variant.images.map((image) => image?.image_url || image?.url) : []),
  ]) : []),
  ...(Array.isArray(product.colors) ? product.colors.flatMap((color) => [
    color.image_url,
    ...(Array.isArray(color.images) ? color.images.map((image) => image?.image_url || image?.url) : []),
  ]) : []),
].filter(Boolean);

const queryVisualImageCandidates = async (tenantId, limit = 600) => {
  const pricingSettings = await loadStorefrontPricingSettings(tenantId);
  let result = await db.query(
    buildCatalogQuery({ trailing: "GROUP BY p.id, c.name, b.name, m.name ORDER BY p.id DESC LIMIT $2" }),
    [tenantId, limit]
  );
  if (!result.rows.length && tenantId !== null) {
    result = await db.query(
      buildCatalogQuery({ trailing: "GROUP BY p.id, c.name, b.name, m.name ORDER BY p.id DESC LIMIT $2" }),
      [null, limit]
    );
  }
  const products = await hydrateProductsWithImages(result.rows.map((row) => normalizeProduct(row, pricingSettings)));
  const rows = [];
  const seen = new Set();
  for (const product of products) {
    for (const imageUrl of collectProductImageUrls(product)) {
      const key = `${product.id}:${imageUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ product, imageUrl });
    }
  }
  return rows;
};

const findProductsByImageSimilarity = async ({ tenantId, imageBuffer, limit = 8 }) => {
  const uploadedSha = imageSha256(imageBuffer);
  const uploadedHashes = await imagePerceptualHashes(imageBuffer);
  const uploadedHashList = uploadedHashes.all.length ? uploadedHashes.all : [uploadedHashes.primary].filter(Boolean);
  const uploadedShapeHashes = await imageShapeHashes(imageBuffer).catch(() => []);
  const uploadedColor = await imageColorSignature(imageBuffer).catch(() => null);
  const candidates = await queryVisualImageCandidates(tenantId);
  const scored = [];
  const debug = {
    tenant_id: tenantId,
    candidate_product_image_count: candidates.length,
    readable_candidate_image_count: 0,
    data_url_candidate_count: 0,
    upload_file_candidate_count: 0,
    remote_url_candidate_count: 0,
    remote_candidate_limit: VISUAL_REMOTE_CANDIDATE_LIMIT,
    matched_candidate_count: 0,
    color_scored_candidate_count: 0,
  };

  let remoteCandidateAttempts = 0;
  const queuedCandidates = [];
  for (const candidate of candidates) {
    const remote = isRemoteImageUrl(candidate.imageUrl);
    if (remote) {
      if (remoteCandidateAttempts >= VISUAL_REMOTE_CANDIDATE_LIMIT) continue;
      remoteCandidateAttempts += 1;
    }
    queuedCandidates.push({ ...candidate, remote });
  }

  const scoreCandidate = async (candidate) => {
    try {
      const signature = await getCandidateVisualSignature(candidate.imageUrl, { allowRemote: candidate.remote });
      if (!signature?.hash) return null;
      const exact = signature.sha === uploadedSha;
      const candidateHashes = Array.isArray(signature.hashes) && signature.hashes.length ? signature.hashes : [signature.hash];
      const distance = exact ? 0 : Math.min(
        ...uploadedHashList.flatMap((uploadedHash) => candidateHashes.map((candidateHash) => hashDistance(uploadedHash, candidateHash)))
      );
      const candidateShapeHashes = Array.isArray(signature.shapeHashes) ? signature.shapeHashes.filter(Boolean) : [];
      const shapeDistance = exact || !uploadedShapeHashes.length || !candidateShapeHashes.length
        ? distance
        : Math.min(
          ...uploadedShapeHashes.flatMap((uploadedHash) => candidateShapeHashes.map((candidateHash) => hashDistance(uploadedHash, candidateHash)))
        );
      const colorSimilarity = uploadedColor ? colorSignatureSimilarity(uploadedColor, signature.color) : 0;
      const hashScore = exact ? 100 : Math.max(0, 92 - distance * 2.2);
      const shapeScore = exact ? 100 : Math.max(0, 94 - shapeDistance * 2.45);
      const blendedScore = exact
        ? 100
        : Math.max(0, Math.min(96, Math.round(hashScore * 0.38 + shapeScore * 0.42 + colorSimilarity * 100 * 0.2)));
      if (!(exact || distance <= 16 || shapeDistance <= 15 || blendedScore >= 42 || colorSimilarity >= 0.88)) {
        return { signature, matched: false, colorSimilarity };
      }
      return {
        signature,
        matched: true,
        match: {
          productId: candidate.product.id,
          score: blendedScore,
          reason: exact ? "exact_sha256" : shapeDistance <= 15 ? "shape_hash" : distance <= 16 ? "perceptual_hash" : "visual_color_similarity",
          distance,
          shapeDistance,
          colorSimilarity,
          familyKey: visualModelFamilyKey(candidate.product),
        },
      };
    } catch {
      return null;
    }
  };

  const concurrency = Math.max(1, Math.min(16, VISUAL_IMAGE_MATCH_CONCURRENCY || 8));
  for (let index = 0; index < queuedCandidates.length; index += concurrency) {
    const chunk = queuedCandidates.slice(index, index + concurrency);
    const results = await Promise.all(chunk.map(scoreCandidate));
    for (const result of results) {
      if (!result?.signature) continue;
      debug.readable_candidate_image_count += 1;
      if (result.signature.source === "data_url") debug.data_url_candidate_count += 1;
      if (result.signature.source === "upload_file") debug.upload_file_candidate_count += 1;
      if (result.signature.source === "remote_url") debug.remote_url_candidate_count += 1;
      if (result.colorSimilarity > 0) debug.color_scored_candidate_count += 1;
      if (result.matched) {
        debug.matched_candidate_count += 1;
        scored.push(result.match);
      }
    }
  }
  console.log("[storefront-image-search] image candidates", debug);

  const bestByProduct = new Map();
  for (const item of scored) {
    const key = String(item.productId);
    const current = bestByProduct.get(key);
    if (!current || item.score > current.score) bestByProduct.set(key, item);
  }
  const familyCounts = new Map();
  for (const item of bestByProduct.values()) {
    if (!item.familyKey || item.score < 50) continue;
    familyCounts.set(item.familyKey, (familyCounts.get(item.familyKey) || 0) + 1);
  }
  return Array.from(bestByProduct.values())
    .map((item) => {
      const familyCount = item.familyKey ? Number(familyCounts.get(item.familyKey) || 0) : 0;
      const familyBoost = familyCount >= 2 ? Math.min(10, (familyCount - 1) * 4) : 0;
      const knownModelBoost = item.familyKey && item.score >= 55 ? 17 : 0;
      const totalBoost = familyBoost + knownModelBoost;
      return totalBoost
        ? {
          ...item,
          score: Math.min(98, item.score + totalBoost),
          reason: `${item.reason}${familyBoost ? "_family_cluster" : ""}${knownModelBoost ? "_known_model" : ""}`,
        }
        : item;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const visualQueryFromUnderstanding = (understanding = null) => [
  understanding?.detected?.brand_guess,
  understanding?.detected?.model_guess,
  understanding?.detected?.model_family,
  understanding?.detected?.product_type,
  understanding?.detected?.category,
  understanding?.detected?.colors,
  understanding?.detected?.main_colors,
  understanding?.detected?.silhouette,
  understanding?.detected?.sole_shape,
  understanding?.detected?.materials,
  understanding?.detected?.features,
].flat().filter(Boolean).join(" ");

const mergeImageSearchMatches = (...groups) => {
  const bestByProduct = new Map();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const productId = Number(item.productId || item.product_id);
      if (!Number.isFinite(productId) || productId <= 0) continue;
      const rawScore = Number(item.score ?? item.finalScore ?? item.final_score ?? 0);
      const score = rawScore <= 1 ? rawScore * 100 : rawScore;
      const normalized = {
        productId,
        score: Math.max(0, Math.min(100, Math.round(score))),
        reason: item.reason || item.match_reason || item.score_breakdown?.reasonWhyRankedFirst || (item.exact_image_match ? "visual_pro_exact" : "visual_similarity"),
        distance: item.distance,
        colorSimilarity: item.colorSimilarity,
        variantId: item.variantId || item.variant_id || null,
        scoreBreakdown: item.score_breakdown || item.scoreBreakdown || null,
      };
      const current = bestByProduct.get(String(productId));
      if (!current || normalized.score > current.score) bestByProduct.set(String(productId), normalized);
    }
  }
  return Array.from(bestByProduct.values()).sort((left, right) => right.score - left.score);
};

const visualKeywordsFromAi = (aiResult = {}) => {
  const suggestions = aiResult?.suggestions || {};
  return uniqueTerms([
    suggestions.name_en,
    suggestions.name_ar,
    suggestions.seo_keywords,
    suggestions.suggested_product_type,
    suggestions.suggested_category,
    suggestions.gender,
    suggestions.target_audience,
    suggestions.brand_resemblance,
    suggestions.detected_model,
    suggestions.classification,
    suggestions.silhouette,
    suggestions.fashion_category,
    suggestions.grade,
    suggestions.dominant_colors,
  ]);
};

const withTimeout = (promise, timeoutMs, label = "operation") => {
  const ms = Math.max(1000, Number(timeoutMs || 0));
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    }),
  ]);
};

const hydrateProductsWithImages = async (products = [], options = {}) => {
  const rows = Array.isArray(products) ? products : [];
  const compact = Boolean(options.compact);
  const productIds = rows.map((product) => Number(product.id)).filter((value) => Number.isFinite(value) && value > 0);
  if (!productIds.length) {
    return rows;
  }

  const imageBundleMap = await loadProductVariantImages(db, productIds).catch(() => new Map());

  return rows.map((product) => {
    const imageBundle = imageBundleMap.get(String(product.id)) || null;
    const variants = attachVariantImages(
      [...(Array.isArray(product.variants) ? product.variants : [])].sort((left, right) =>
        Number(left?.color_sort_order ?? left?.colorSortOrder ?? 0) - Number(right?.color_sort_order ?? right?.colorSortOrder ?? 0) ||
        Number(left?.id ?? left?.variant_id ?? 0) - Number(right?.id ?? right?.variant_id ?? 0)
      ),
      imageBundle
    );
    if (compact) {
      const colorImages = attachGroupedColorImages(deriveColorGroupsFromVariants(variants), imageBundle);
      const compactVariants = variants.map((variant) => {
        const imageUrl = variant.primary_image_url || variant.image_url || variant.variant_image_url || variant.color_image_url || product.image_url || product.product_image_url || "";
        return {
          id: variant.id,
          product_id: variant.product_id,
          size: variant.size,
          color: variant.color,
          color_group_key: variant.color_group_key || variant.colorGroupKey || "",
          color_sort_order: variant.color_sort_order ?? variant.colorSortOrder ?? 0,
          sku: variant.sku,
          barcode: variant.barcode,
          edition_name: variant.edition_name,
          edition_slug: variant.edition_slug,
          image_url: imageUrl,
          price: variant.price,
          regular_price: variant.regular_price,
          base_price: variant.base_price,
          list_price: variant.list_price,
          compare_base_price: variant.compare_base_price,
          custom_compare_price: variant.custom_compare_price,
          sale_price: variant.sale_price,
          purchase_sale_price: variant.purchase_sale_price,
          purchase_invoice_sale_price: variant.purchase_invoice_sale_price,
          purchase_invoice_selling_price: variant.purchase_invoice_selling_price,
          last_piece_sale_price: variant.last_piece_sale_price,
          sale_price_enabled: variant.sale_price_enabled,
          sale_prices_enabled: variant.sale_prices_enabled,
          global_sale_enabled: variant.global_sale_enabled,
          sale_mode_enabled: variant.sale_mode_enabled,
          selling_price: variant.selling_price,
          final_price: variant.final_price,
          sale_source: variant.sale_source,
          sale_mode_applied: variant.sale_mode_applied,
          offer_price: variant.offer_price,
          discount_price: variant.discount_price,
          compare_at_price: variant.compare_at_price,
          old_price: variant.old_price,
          original_price: variant.original_price,
          stock: variant.stock,
          last_piece_category: variant.last_piece_category,
          images: Array.isArray(variant.images) ? variant.images : [],
          gallery_images: Array.isArray(variant.images) ? variant.images : [],
          image_urls: Array.isArray(variant.images) ? variant.images : [],
          product_images: Array.isArray(variant.images) ? variant.images : [],
          additional_images: Array.isArray(variant.images) ? variant.images.slice(1) : [],
          color_images: Array.isArray(variant.images) ? variant.images : [],
        };
      });
      const primaryVariant = compactVariants.find((variant) => variant.image_url) || null;
      const primaryImage = primaryVariant?.image_url || product.image_url || product.product_image_url || "";
      return {
        ...product,
        variants: compactVariants,
        colors: colorImages,
        color_images: colorImages,
        image_url: primaryImage,
        product_image_url: primaryImage,
      };
    }
    const colorImages = attachGroupedColorImages(deriveColorGroupsFromVariants(variants), imageBundle);
    const primaryVariant = variants.find((variant) => Array.isArray(variant.images) && variant.images.some((image) => image.is_primary)) || variants.find((variant) => variant.image_url) || null;
    const primaryImage = primaryVariant?.primary_image_url || primaryVariant?.image_url || product.image_url || product.product_image_url || product.gallery_images?.[0] || "";
    return {
      ...product,
      variants,
      colors: colorImages,
      color_images: colorImages,
      image_url: primaryImage || product.image_url || product.product_image_url || "",
      product_image_url: primaryImage || product.product_image_url || product.image_url || "",
    };
  });
};

// The card hover fades to a second photo, so a card needs exactly two. The lean
// list projection used to carry only the primary, which disabled the swap on
// every listing and rail — the client sees no second image and closes the
// feature itself. Two short strings per row keeps the projection lean.
const CARD_IMAGE_LIMIT = 2;
const cardImageValue = (image) => {
  if (typeof image === "string") return image.trim();
  if (image && typeof image === "object") {
    return toText(image.url || image.image_url || image.secure_url || image.src || image.path || "");
  }
  return "";
};
const firstCardImages = (...collections) => {
  const picked = [];
  for (const collection of collections) {
    for (const image of Array.isArray(collection) ? collection : [collection]) {
      const value = cardImageValue(image);
      if (value && !picked.includes(value)) picked.push(value);
      if (picked.length >= CARD_IMAGE_LIMIT) return picked;
    }
  }
  return picked;
};

const slimVariantForList = (variant = {}) => ({
  id: variant.id || variant.variant_id || null,
  variant_id: variant.variant_id || variant.id || null,
  product_id: variant.product_id || null,
  size: variant.size || "",
  color: variant.color || "",
  // The card's colour identity is the durable key, so the lean list projection has
  // to carry it or the client falls back to matching colours by name again.
  color_group_key: variant.color_group_key || variant.colorGroupKey || "",
  sku: variant.sku || "",
  barcode: variant.barcode || "",
  image_url: variant.image_url || variant.primary_image_url || variant.variant_image_url || "",
  // Colour cards scope the swap to their own colour, so the second photo has to
  // ride the variant rather than the product-wide gallery.
  images: firstCardImages(
    variant.images,
    variant.color_images,
    variant.gallery_images,
    variant.additional_images,
    variant.image_url,
    variant.primary_image_url
  ),
  stock: toNumber(variant.stock),
  price: roundMoney(variant.price),
  regular_price: roundMoney(variant.regular_price),
  selling_price: roundMoney(variant.selling_price || variant.price),
  final_price: roundMoney(variant.final_price || variant.selling_price || variant.price),
  sale_price: roundMoney(variant.sale_price),
  sale_price_enabled: Boolean(variant.sale_price_enabled),
  sale_mode_applied: Boolean(variant.sale_mode_applied),
  compare_at_price: roundMoney(variant.compare_at_price || variant.old_price || variant.original_price),
});

const slimProductForList = (product = {}) => ({
  card_id: product.card_id || product.id,
  storefront_card_type: product.storefront_card_type || "product",
  parent_product_id: product.parent_product_id || product.id,
  display_variant_id: product.display_variant_id || product.matched_variant_id || null,
  selected_variant_id: product.selected_variant_id || product.display_variant_id || product.matched_variant_id || null,
  display_color: product.display_color || "",
  display_color_key: product.display_color_key || "",
  color: product.color || product.display_color || "",
  color_key: product.color_key || product.display_color_key || "",
  id: product.id,
  slug: product.slug,
  name: product.name,
  category: product.category,
  gender: product.gender,
  audiences: product.audiences,
  product_audiences: product.product_audiences,
  product_type: product.product_type,
  productType: product.productType,
  grade: product.grade,
  brand: product.brand,
  brand_name: product.brand_name || product.brand || "",
  brandName: product.brandName || product.brand || "",
  product_brand: product.product_brand || product.brand || "",
  manufacturer_brand: product.manufacturer_brand || "",
  manufacturer: product.manufacturer || product.manufacturer_name || "",
  manufacturer_name: product.manufacturer_name || product.manufacturer || "",
  image_url: product.image_url,
  product_image_url: product.product_image_url || product.image_url || "",
  gallery_images: firstCardImages(
    product.gallery_images,
    product.images,
    product.image_urls,
    product.product_images,
    product.image_url,
    product.product_image_url
  ),
  created_at: product.created_at,
  price: product.price,
  regular_price: product.regular_price,
  base_price: product.base_price,
  list_price: product.list_price,
  compare_base_price: product.compare_base_price,
  custom_compare_price: product.custom_compare_price,
  use_custom_compare_price: product.use_custom_compare_price,
  sale_price: product.sale_price,
  selling_price: product.selling_price,
  final_price: product.final_price,
  offer_price: product.offer_price,
  discount_price: product.discount_price,
  sale_price_enabled: product.sale_price_enabled,
  sale_prices_enabled: product.sale_prices_enabled,
  global_sale_enabled: product.global_sale_enabled,
  sale_mode_enabled: product.sale_mode_enabled,
  sale_source: product.sale_source,
  sale_badge: product.sale_badge,
  sale_mode_applied: product.sale_mode_applied,
  is_offer_story: product.is_offer_story === true || String(product.is_offer_story || "").toLowerCase() === "true" || product.isOfferStory === true || String(product.isOfferStory || "").toLowerCase() === "true",
  is_storefront_visible:
    product.is_storefront_visible === true ||
    String(product.is_storefront_visible ?? "").toLowerCase() === "true" ||
    product.isStorefrontVisible === true ||
    String(product.isStorefrontVisible ?? "").toLowerCase() === "true" ||
    product.is_storefront_visible === undefined ||
    product.is_storefront_visible === null ||
    product.is_storefront_visible === "",
  compare_at_price: product.compare_at_price,
  old_price: product.old_price,
  original_price: product.original_price,
  total_stock: product.total_stock,
  current_stock: product.current_stock ?? product.total_stock,
  available_stock: product.available_stock ?? product.total_stock,
  in_stock: product.in_stock ?? Number(product.total_stock || 0) > 0,
  stock_label: product.stock_label || (Number(product.total_stock || 0) > 0 ? "IN STOCK" : "OUT OF STOCK"),
  stock_status: product.stock_status || (Number(product.total_stock || 0) > 0 ? "IN STOCK" : "OUT OF STOCK"),
  sold_count: product.sold_count,
  badge: "",
  sizes: product.sizes,
  colors: product.colors,
  variants: Array.isArray(product.variants) ? product.variants.map(slimVariantForList) : [],
  low_stock: product.low_stock,
  is_mirror: product.is_mirror,
  seo_title: product.seo_title,
});

const productHomeImage = (product = {}) =>
  firstText(
    product.image_url,
    product.product_image_url,
    product.thumbnail_url,
    product.photo_url,
    product.image,
    Array.isArray(product.gallery_images) ? product.gallery_images[0] : "",
    Array.isArray(product.variants) ? product.variants.find((variant) => firstText(variant.image_url, variant.primary_image_url))?.image_url : ""
  );

const productHomePrice = (product = {}) =>
  roundMoney(product.final_price || product.selling_price || product.regular_price || product.price || product.sale_price);

const productHomeLink = async (tenantId, product = {}) => {
  try {
    const link = await resolveStorefrontProductLink({ tenantId, product });
    return link?.url || link?.path || `/shop/product/${product.slug || product.id}`;
  } catch {
    return `/shop/product/${product.slug || product.id}`;
  }
};

const productHomeCard = async (tenantId, product = {}) => ({
  id: product.id,
  card_id: product.card_id || product.id,
  slug: product.slug,
  name: product.name || "",
  image_url: productHomeImage(product),
  price: productHomePrice(product),
  selling_price: roundMoney(product.selling_price || product.price),
  regular_price: roundMoney(product.regular_price || product.original_price),
  sale_price: roundMoney(product.sale_price),
  sale_price_enabled: Boolean(product.sale_price_enabled || product.sale_mode_applied),
  total_stock: toNumber(product.total_stock),
  category: product.category || "",
  gender: product.gender || "",
  audiences: product.audiences || product.product_audiences || [],
  product_type: product.product_type || product.productType || "",
  grade: product.grade || "",
  grade_name: product.grade_name || product.gradeName || "",
  grade_slug: product.grade_slug || product.gradeSlug || "",
  is_mirror: product.is_mirror === true || String(product.is_mirror || "").toLowerCase() === "true",
  link: await productHomeLink(tenantId, product),
});

export const isHomeMirrorProduct = (product = {}) => {
  if (product.is_mirror === true || String(product.is_mirror || "").toLowerCase() === "true") return true;
  const aliases = new Set(["mirror", "mirror_original", "mirror original", "original_mirror", "original mirror"]);
  return [product.grade, product.grade_slug, product.grade_name]
    .map((value) => toText(value).toLowerCase().replace(/[-\s]+/g, "_"))
    .some((value) => aliases.has(value) || aliases.has(value.replace(/_/g, " ")));
};

const STOREFRONT_HOME_MIRROR_FILTER_SLUG = "mirror_original";

const isHomeSaleProduct = (product = {}) => {
  const salePrice = roundMoney(product.sale_price);
  const sellingPrice = roundMoney(product.selling_price || product.price || product.regular_price);
  return salePrice > 0 && sellingPrice > 0 && salePrice < sellingPrice && Boolean(product.sale_price_enabled || product.sale_mode_applied);
};

const homeNewestScore = (product = {}) => {
  const time = Date.parse(product.created_at || product.updated_at || "");
  return Number.isFinite(time) ? time : 0;
};

const uniqueHomeProducts = (products = []) => {
  const seen = new Set();
  return products.filter((product) => {
    const key = String(product.parent_product_id || product.id || product.card_id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const markHomeProductUsage = (usage, products = []) => {
  for (const product of products) {
    const identity = String(product.parent_product_id || product.id || product.card_id || "");
    if (!identity) continue;
    usage.set(identity, (usage.get(identity) || 0) + 1);
  }
};

const capHomeProductUsage = (usage, products = [], limit = 8, maxUses = 2) =>
  uniqueHomeProducts(products)
    .filter((product) => {
      const identity = String(product.parent_product_id || product.id || product.card_id || "");
      return identity && (usage.get(identity) || 0) < maxUses;
    })
    .slice(0, limit);

const homeSection = async ({ tenantId, key, title, products, limit = 8 }) => {
  const cards = uniqueHomeProducts(products || [])
    .filter((product) => product?.id && productHomeImage(product))
    .slice(0, limit);
  return {
    key,
    title,
    products: await Promise.all(cards.map((product) => productHomeCard(tenantId, product))),
  };
};

export const buildStorefrontHomeFromProducts = async ({ tenantId = DEFAULT_TENANT_ID, settings = {} } = {}) => {
  await ensureStorefrontSchema();
  await ensureProductVariantImagesSchema();
  const pricingSettings = normalizeStorefrontPricingSettings(settings || await getWebsiteSettings({ tenantId }));
  const filters = { gender: [], productType: [], grade: [], quality: [], size: "", inStock: true };
  const mirrorFilters = { ...filters, quality: storefrontQualityAliases(STOREFRONT_HOME_MIRROR_FILTER_SLUG) };
  let [result, mirrorResult] = await Promise.all([
    queryProducts(tenantId, "", "", filters, false, 80, 0),
    queryProducts(tenantId, "", "", mirrorFilters, false, 12, 0),
  ]);
  let usedTenantFallback = false;
  if (!result.rows.length && tenantId !== null) {
    result = await queryProducts(null, "", "", filters, false, 80, 0);
    usedTenantFallback = result.rows.length > 0;
  }
  if (!mirrorResult.rows.length && tenantId !== null) {
    mirrorResult = await queryProducts(null, "", "", mirrorFilters, false, 12, 0);
    usedTenantFallback = usedTenantFallback || mirrorResult.rows.length > 0;
  }
  const [hydrated, hydratedMirror] = await Promise.all([
    hydrateProductsWithImages(result.rows.map((row) => normalizeProduct(row, pricingSettings)), { compact: true }).then(scrubInactiveClassifications),
    hydrateProductsWithImages(mirrorResult.rows.map((row) => normalizeProduct(row, pricingSettings)), { compact: true }).then(scrubInactiveClassifications),
  ]);
  const products = uniqueHomeProducts(expandProductsToColorCards(hydrated))
    .filter((product) => toNumber(product.total_stock) > 0 && productHomeImage(product))
    .sort((a, b) => homeNewestScore(b) - homeNewestScore(a) || toNumber(b.total_stock) - toNumber(a.total_stock));

  if (!products.length) {
    return {
      hero: null,
      mirror_products: [],
      featured_collections: [],
      source: "empty",
      product_count: 0,
      used_tenant_fallback: usedTenantFallback,
      mirror_filter_slug: STOREFRONT_HOME_MIRROR_FILTER_SLUG,
    };
  }

  const latest = products;
  const mirrorProducts = uniqueHomeProducts(expandProductsToColorCards(hydratedMirror))
    .filter((product) => isHomeMirrorProduct(product) && toNumber(product.total_stock) > 0 && productHomeImage(product))
    .slice(0, 12);
  const featured = [...products].sort((a, b) => toNumber(b.total_stock) - toNumber(a.total_stock) || homeNewestScore(b) - homeNewestScore(a));
  const sale = products.filter(isHomeSaleProduct);
  const heroProduct = mirrorProducts[0] || null;
  const hero = heroProduct ? await productHomeCard(tenantId, heroProduct) : null;
  const mirrorCards = await Promise.all(mirrorProducts.map((product) => productHomeCard(tenantId, product)));
  const usage = new Map();
  markHomeProductUsage(usage, heroProduct ? [heroProduct] : []);
  const saleProducts = capHomeProductUsage(usage, sale, 8, 1);
  markHomeProductUsage(usage, saleProducts);
  const latestProducts = capHomeProductUsage(usage, latest, 8, 1);
  markHomeProductUsage(usage, latestProducts);
  const featuredProducts = capHomeProductUsage(usage, featured, 8, 1);
  const sectionSpecs = [
    { key: "featured_products", title: "Featured products", products: featuredProducts },
    { key: "new_arrivals", title: "New arrivals", products: latestProducts },
    { key: "sale", title: "Sale", products: saleProducts },
  ];
  const sections = [];
  for (const spec of sectionSpecs) {
    const sectionProducts = spec.products;
    if (!sectionProducts.length) continue;
    sections.push(await homeSection({ tenantId, key: spec.key, title: spec.title, products: sectionProducts }));
  }

  return {
    hero,
    mirror_products: mirrorCards,
    featured_collections: sections.filter((section) => section.products.length),
    source: "products",
    product_count: products.length,
    used_tenant_fallback: usedTenantFallback,
    mirror_filter_slug: STOREFRONT_HOME_MIRROR_FILTER_SLUG,
  };
};

const variantColorNameForCard = (variant = {}) => firstText(variant.color, variant.color_name, variant.colour, variant.name, "Default");

// One product routinely holds several colours sharing a visible name - four
// different Navy shoes, two different Greys. The durable colour key decides which
// card a variant belongs to, so each of them gets its own card; the name slug is
// only for rows saved before colour keys existed.
const variantColorKeyForCard = (variant = {}) => {
  const durable = toText(variant.color_group_key || variant.colorGroupKey).toLowerCase();
  if (durable) return durable;
  const value = variantColorNameForCard(variant);
  return toText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || `variant-${variant.id || "default"}`;
};

const variantCardImage = (variant = {}, product = {}) =>
  firstText(
    variant.primary_image_url,
    variant.variant_image_url,
    variant.color_image_url,
    variant.image_url,
    variant.image,
    product.product_image_url,
    product.image_url,
    Array.isArray(product.gallery_images) ? product.gallery_images[0] : ""
  );

const preferredVariantForColorCard = (variants = [], product = {}) =>
  variants.find((variant) => toNumber(variant.stock) > 0 && variantCardImage(variant, product)) ||
  variants.find((variant) => toNumber(variant.stock) > 0) ||
  variants.find((variant) => variantCardImage(variant, product)) ||
  variants[0] ||
  null;

const productColorDisplayName = (name = "", color = "") => {
  const base = firstText(name);
  const colorText = firstText(color);
  if (!base || !colorText || colorText.toLowerCase() === "default") return base;
  return `${base} - ${colorText}`;
};

export const expandProductsToColorCards = (products = []) => {
  const cards = [];
  for (const product of Array.isArray(products) ? products : []) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (!variants.length) {
      cards.push(product);
      continue;
    }

    const groups = new Map();
    for (const variant of variants) {
      const key = variantColorKeyForCard(variant);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          color: variantColorNameForCard(variant),
          variants: [],
        });
      }
      groups.get(key).variants.push(variant);
    }

    for (const group of groups.values()) {
      const selectedVariant = preferredVariantForColorCard(group.variants, product);
      if (!selectedVariant) continue;
      const productColorImages = Array.isArray(product.color_images) ? product.color_images : Array.isArray(product.colors) ? product.colors : [];
      const colorRecordKey = (color = {}) => toText(color?.color_group_key || color?.colorGroupKey).toLowerCase();
      const matchedColorRecord =
        productColorImages.find((color) => colorRecordKey(color) && colorRecordKey(color) === group.key) ||
        // A keyless legacy record can only be found by name, and only if no keyed
        // record already owns this group - otherwise a same-named colour's photos
        // would leak onto this card.
        productColorImages.find((color) => !colorRecordKey(color) &&
          variantColorKeyForCard({ color: color?.color || color?.color_name || "" }) === group.key) ||
        null;
      const groupImages = dedupeImages([
        ...(Array.isArray(matchedColorRecord?.images) ? matchedColorRecord.images : []),
        ...(Array.isArray(selectedVariant?.images) ? selectedVariant.images : []),
        ...(Array.isArray(group.variants) ? group.variants.flatMap((variant) => Array.isArray(variant.images) ? variant.images : []) : []),
        ...(Array.isArray(group.variants) ? group.variants.flatMap((variant) => Array.isArray(variant.color_images) ? variant.color_images : []) : []),
      ]);
      const groupPrimaryImage = groupImages.find((image) => image?.is_primary) || groupImages[0] || null;
      const groupStock = group.variants.reduce((sum, variant) => sum + Math.max(0, toNumber(variant.stock)), 0);
      if (groupStock <= 0) continue;
      const groupSizes = [...new Set(group.variants.filter((variant) => toNumber(variant.stock) > 0 && variant.size).map((variant) => variant.size))];
      const groupImage = groupPrimaryImage?.image_url || groupPrimaryImage?.preview || variantCardImage(selectedVariant, product);
      const sellingPrice = roundMoney(selectedVariant.selling_price || product.selling_price || selectedVariant.price || product.price);
      const salePrice = roundMoney(selectedVariant.sale_price ?? product.sale_price);
      const saleModeOn = selectedVariant.sale_mode_enabled === true ||
        selectedVariant.global_sale_enabled === true ||
        selectedVariant.sale_prices_enabled === true ||
        product.sale_mode_enabled === true ||
        product.global_sale_enabled === true ||
        product.sale_prices_enabled === true ||
        // Read the offer flag directly rather than trusting the derived sale_mode_enabled to have survived
        // normalizeProduct: a curated offer prices as a sale on its own. Same rule as POS and the AI resolver.
        isForcedOfferSale(product) ||
        isForcedOfferSale(selectedVariant);
      const saleApplied = saleModeOn && salePrice > 0 && (sellingPrice <= 0 || salePrice < sellingPrice);
      const finalPrice = saleApplied ? salePrice : sellingPrice;
      const comparePrice = roundMoney(selectedVariant.compare_at_price || product.compare_at_price);
      cards.push({
        ...product,
        card_id: `${product.id}:${group.key}`,
        storefront_card_type: "color_variant",
        parent_product_id: product.id,
        display_variant_id: selectedVariant.id || null,
        selected_variant_id: selectedVariant.id || null,
        display_color: group.color,
        display_color_key: group.key,
        color: group.color,
        color_key: group.key,
        name: productColorDisplayName(product.name, group.color),
        image_url: groupImage,
        product_image_url: groupImage,
        image_urls: groupImages,
        images: groupImages,
        gallery_images: groupImages,
        product_images: groupImages,
        additional_images: groupImages.slice(1),
        color_images: groupImages,
        variants: group.variants,
        total_stock: groupStock,
        low_stock: groupStock > 0 && groupStock <= LOW_STOCK_LIMIT,
        sizes: groupSizes,
        colors: group.color && group.color !== "Default" ? [group.color] : [],
        selected_card_image_url: groupImage,
        selling_price: sellingPrice,
        price: sellingPrice,
        final_price: finalPrice,
        sale_price: salePrice,
        original_price: selectedVariant.original_price || product.original_price,
        base_price: selectedVariant.base_price || product.base_price,
        list_price: selectedVariant.list_price || product.list_price,
        compare_base_price: selectedVariant.compare_base_price || product.compare_base_price,
        custom_compare_price: selectedVariant.custom_compare_price || product.custom_compare_price,
        use_custom_compare_price: selectedVariant.use_custom_compare_price ?? product.use_custom_compare_price,
        regular_price: selectedVariant.regular_price || product.regular_price,
        compare_at_price: comparePrice,
        old_price: comparePrice,
        sale_price_enabled: saleApplied,
        sale_prices_enabled: saleModeOn,
        global_sale_enabled: saleModeOn,
        sale_mode_enabled: saleModeOn,
        sale_source: saleApplied ? "product" : "regular",
        sale_badge: saleApplied ? (selectedVariant.sale_badge || product.sale_badge) : "",
        sale_mode_applied: saleApplied,
      });
      if (ERP_PERF_DEBUG) console.log("[storefront-color-card]", {
        parent_product_id: product.id,
        product_name: product.name,
        color: group.color,
        variant_count: group.variants.length,
        selected_variant_id: selectedVariant.id || null,
        card_id: `${product.id}:${group.key}`,
      });
    }
  }
  return cards;
};

// Mirrors the storefront's label normalization so a colour chip built from the
// card labels matches the card it came from.
const storefrontColorFilterKey = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/ـ/g, "")
    .replace(/‌/g, "")
    .replace(/‍/g, "")
    .replace(/‎/g, "")
    .replace(/‏/g, "")
    .replace(/\p{M}+/gu, "")
    .replace(/['’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const storefrontCardColorKeys = (product = {}) => {
  const values = [product.display_color, product.color];
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    values.push(variant?.color, variant?.color_name);
  }
  return [...new Set(values.map(storefrontColorFilterKey).filter(Boolean))];
};

export const storefrontCardHasAvailableSize = (product = {}, size = "") => {
  const targetSizes = queryTextList(size).map((item) => item.toLowerCase());
  if (!targetSizes.length) return true;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length) {
    return variants.some((variant) =>
      targetSizes.includes(queryText(variant?.size ?? variant?.size_value).toLowerCase()) &&
      toNumber(variant?.stock ?? variant?.quantity) > 0
    );
  }
  return targetSizes.includes(queryText(product?.size ?? product?.size_value).toLowerCase()) &&
    toNumber(product?.total_stock ?? product?.stock) > 0;
};

const normalizeStorefrontProductsQuery = (query = {}) => {
  const rawSearch = queryText(query.q).toLowerCase();
  const audienceSearch = normalizeAudienceValue(rawSearch);
  const rawGender = queryText(query.gender || query.audience || query.target_audience);
  return {
    q: audienceSearch ? "" : rawSearch,
    category: queryText(query.category).toLowerCase(),
    brand: queryText(query.brand || query.brandId || query.brand_id),
    gender: rawGender,
    productType: queryText(query.product_type || query.productType),
    grade: queryText(query.grade),
    quality: queryText(query.quality),
    // Every facet the listing page can stack must be filtered here, before the
    // page is cut: filtering a 24-card page afterwards is what left pages short.
    sizes: queryTextList(query.size, query.sizes),
    size: queryText(query.size),
    colors: queryTextList(query.color, query.colors),
    bagType: queryTextList(query.bag_type, query.bagType),
    minPrice: queryPositiveNumber(query.min_price ?? query.minPrice),
    maxPrice: queryPositiveNumber(query.max_price ?? query.maxPrice),
    lastSizes: queryFlagOn(query.last_sizes || query.lastSizes),
    largeSizes: queryFlagOn(query.large_sizes || query.largeSizes),
    inStock: queryFlagOn(query.inStock || query.in_stock || query.stock),
    saleOnly: queryFlagOn(query.sale),
    offerStory: queryFlagOn(query.offer_story || query.offerStory),
    sort: normalizeStorefrontSort(query.sort || query.order),
    scope: normalizeStorefrontScope(query.scope || query.last_piece_scope || query._last_piece_scope),
    groupingMode: normalizeStorefrontGroupingMode(query.grouping || query.grouping_mode || query.groupingMode || query._color_cards),
    limit: queryPositiveInt(query.limit, 24, { min: 1, max: 80 }),
    offset: queryPositiveInt(query.offset, 0, { min: 0, max: 100000 }),
    audienceSearch,
  };
};

export const resolveEffectiveStorefrontInStock = ({ inStock = false, offerStory = false, size = "" } = {}) =>
  Boolean(inStock || (offerStory && queryText(size)));

export const storefrontQualityAliases = (quality = "") => {
  const normalized = queryText(quality).toLowerCase().replace(/[-\s]+/g, "_");
  if (["mirror", "mirror_original", "original_mirror"].includes(normalized)) {
    return ["mirror", "mirror_original", "mirror original", "original_mirror", "original mirror"];
  }
  if (["egyptian", "egypt", "local", "locally_made", "made_in_egypt"].includes(normalized)) {
    return ["egyptian", "egypt", "local", "locally_made", "locally made", "made_in_egypt", "made in egypt"];
  }
  if (["vietnamese_import", "vietnamese", "vietnam", "import", "imported", "imported_vietnamese", "vietnam_import"].includes(normalized)) {
    return ["vietnamese_import", "vietnamese import", "vietnamese", "vietnam", "import", "imported", "imported_vietnamese", "vietnam_import"];
  }
  if (!normalized || ["all", "الكل", "كل"].includes(normalized)) return [];
  if (normalized === "mirror" || normalized === "ميرور") {
    return ["mirror", "ميرور", "mirror original", "original mirror"];
  }
  if (normalized === "egyptian" || normalized === "مصري") {
    return ["egyptian", "egypt", "مصري"];
  }
  if (["vietnamese_import", "vietnamese", "vietnam", "import", "مستورد", "فيتنامي", "مستورد_فيتنامي"].includes(normalized)) {
    return ["vietnamese_import", "vietnamese import", "vietnamese", "vietnam", "import", "مستورد", "فيتنامي", "مستورد فيتنامي"];
  }
  return [normalized.replace(/_/g, " "), normalized];
};

export const listProducts = async (req, res) => {
  const startedAt = Date.now();
  const perf = createPerfTrace("products");
  const cacheDiag = perf.enabled ? {} : undefined;
  try {
    console.log("[storefront-products-hit]", req.originalUrl || req.url || "", req.query || {});
    // The server-side entry is dropped the moment a product is saved, but a
    // browser or CDN copy outlives that invalidation — hiding a product or a
    // colour looked like it did nothing for up to max-age + the stale window.
    // 15s + 30s keeps the burst protection while bounding that lie to ~45s.
    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    await perf.step("ensure_storefront_schema", () => ensureStorefrontSchema());
    await perf.step("ensure_variant_images_schema", () => ensureProductVariantImagesSchema());
    const tenantId = tenantFromRequest(req);
    const pricingSettings = await perf.step("pricing_settings", () => loadStorefrontPricingSettings(tenantId));
    const payload = await getOrSetCacheSWR(storefrontCacheKey(tenantId, "products", req.query || {}), storefrontCacheWindows(), async () => {
      const normalizedQuery = perf.sync("normalize_query", () => normalizeStorefrontProductsQuery(req.query || {}));
      const { q, category, brand, saleOnly, offerStory, sort, limit, offset, scope, groupingMode, size, sizes, colors, bagType, minPrice, maxPrice, lastSizes, inStock, audienceSearch, largeSizes } = normalizedQuery;
      const genderAliases = await perf.step("alias_gender", () => getClassificationFilterAliases("gender", normalizedQuery.gender));
      const productType = await perf.step("alias_product_type", () => getActiveClassificationFilterAliases("product_type", normalizedQuery.productType));
      const grade = await perf.step("alias_grade", () => getActiveClassificationFilterAliases("grade", normalizedQuery.grade));
      const quality = perf.sync("alias_quality", () => storefrontQualityAliases(normalizedQuery.quality));
      const genderSource = normalizedQuery.gender || audienceSearch;
      const gender = normalizeProductAudiences(genderAliases, genderSource);
      const effectiveSaleOnly = saleOnly && saleModeEnabled(pricingSettings) && !pricingSettings.enable_fake_compare_price;
      const effectiveOfferStoryOnly = Boolean(offerStory);
      // Older deployed storefront bundles preserve offer_story + size but can
      // omit inStock while following a shared AI Inbox link. An offer filtered
      // by size must only include a variant that is actually available.
      const effectiveInStockOnly = resolveEffectiveStorefrontInStock({ inStock, offerStory: effectiveOfferStoryOnly, size });
      const randomSeed = sort ? "" : storefrontRandomSeed(req);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[storefront/products-debug]", {
          receivedQuery: req.query || {},
          normalizedQuery: {
            q,
            category,
            brand,
            gender: normalizedQuery.gender || "",
            audienceSearch: audienceSearch || "",
            productType: normalizedQuery.productType || "",
            grade: normalizedQuery.grade || "",
            quality: normalizedQuery.quality || "",
            size: normalizedQuery.size || "",
          },
          computedSearchTerm: q,
          computedGenderFilter: gender,
          finalWhereFilters: { q, category, brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, saleOnly: effectiveSaleOnly, offerStory: effectiveOfferStoryOnly },
        });
      }
      if (ERP_PERF_DEBUG) console.log("[storefront-random-seed]", {
        tenantId,
        seed: randomSeed || "",
        sort: sort || "",
        source: randomSeed
          ? (req.query.random_seed || req.query.randomSeed || req.query.seed || req.headers?.["x-storefront-random-seed"] || req.headers?.["x-random-seed"] ? "client" : "backend")
          : "disabled",
      });
      const page = Math.floor(offset / limit) + 1;
      const shouldOrderAfterExpansion = Boolean(sort || randomSeed);
      const candidateLimit = shouldOrderAfterExpansion
        ? Math.min(Math.max(limit + offset + 500, 1000), 5000)
        : limit;
      const queryOffset = shouldOrderAfterExpansion ? 0 : offset;
      if (process.env.NODE_ENV !== "production" && effectiveOfferStoryOnly) {
        const debugLimit = Math.max(candidateLimit, 1000);
        const [beforeOfferStory, afterOfferStoryBeforeVisibility, afterVisibility] = await Promise.all([
          queryProductsWithoutVisibility(tenantId, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: false }, effectiveSaleOnly, debugLimit, 0),
          queryProductsWithoutVisibility(tenantId, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: true }, effectiveSaleOnly, debugLimit, 0),
          queryProducts(tenantId, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: true }, effectiveSaleOnly, debugLimit, 0),
        ]);
        const dbCheck = await db.query(
          `
          SELECT
            p.id,
            p.name,
            p.is_offer_story,
            p.is_storefront_visible,
            p.is_active,
            p.stock
          FROM products p
          WHERE COALESCE(p.is_offer_story, FALSE) = TRUE
          ORDER BY p.id DESC
          LIMIT 20
          `
        );
        const visibleIds = new Set(afterVisibility.rows.map((row) => String(row.id)));
        const excludedDueToVisibility = afterOfferStoryBeforeVisibility.rows
          .filter((row) => !visibleIds.has(String(row.id)))
          .map((row) => ({
            id: row.id,
            name: row.name,
            is_storefront_visible: row.is_storefront_visible,
          }));
        console.debug("[storefront-products-debug-offer-story]", {
          requestQuery: req.query || {},
          total_before_offer_story_filter: beforeOfferStory.rows.length,
          total_after_offer_story_filter: afterOfferStoryBeforeVisibility.rows.length,
          total_after_is_storefront_visible_filter: afterVisibility.rows.length,
          offer_story_db_check: dbCheck.rows,
          excluded_due_to_is_storefront_visible: excludedDueToVisibility,
        });
      }
      let result = await perf.step("sql_main", () => queryProducts(tenantId, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: effectiveOfferStoryOnly }, effectiveSaleOnly, candidateLimit, queryOffset));
      let usedTenantFallback = false;
      if (!result.rows.length && tenantId !== null) {
        const fallback = await perf.step("sql_tenant_fallback", () => queryProducts(null, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: effectiveOfferStoryOnly }, effectiveSaleOnly, candidateLimit, queryOffset));
        if (fallback.rows.length) {
          result = fallback;
          usedTenantFallback = true;
        }
      }
      if (effectiveOfferStoryOnly && !result.rows.length) {
        const isDbOfferStory = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";
        const isDbStorefrontVisible = (value) => value === true || value === 1 || value === undefined || value === null || String(value || "").trim() === "" || String(value || "").toLowerCase() === "true";
        let relaxedResult = await perf.step("sql_relaxed", () => queryProducts(tenantId, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: false }, effectiveSaleOnly, candidateLimit, queryOffset));
        if (!relaxedResult.rows.length && tenantId !== null) {
          relaxedResult = await perf.step("sql_relaxed_null", () => queryProducts(null, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: false }, effectiveSaleOnly, candidateLimit, queryOffset));
        }
        const relaxedRows = relaxedResult.rows.filter((row) => isDbOfferStory(row.is_offer_story) && isDbStorefrontVisible(row.is_storefront_visible));
        if (relaxedRows.length) {
          result = { ...relaxedResult, rows: relaxedRows };
          usedTenantFallback = true;
          console.warn("[storefront-offer-story-fallback]", {
            tenantId,
            requestQuery: req.query || {},
            relaxed_rows: relaxedResult.rows.length,
            filtered_rows: relaxedRows.length,
          });
        }
      }
      let products = perf.sync("normalize_products", () => result.rows.map((row) => normalizeProduct(row, pricingSettings)));
      if (!products.some((product) => product.total_stock > 0) && tenantId !== null) {
        const fallback = await perf.step("sql_order_fallback", () => queryProducts(null, q, category, { brand, gender, productType, grade, quality, sizes, bagType, size, inStock: effectiveInStockOnly, offerStory: effectiveOfferStoryOnly }, effectiveSaleOnly, candidateLimit, queryOffset));
        const fallbackProducts = fallback.rows.map((row) => normalizeProduct(row, pricingSettings));
        if (fallbackProducts.some((product) => product.total_stock > 0)) {
          products = fallbackProducts;
          usedTenantFallback = true;
        }
      }
      const rawProductCount = products.length;
      const imagedProducts = await perf.step("hydrate_images", () => hydrateProductsWithImages(products, { compact: true }));
      const hydratedProducts = await perf.step("scrub_classifications", () => scrubInactiveClassifications(imagedProducts));
      const expandedProducts = perf.sync("color_expansion", () => (groupingMode === "none" ? hydratedProducts : expandProductsToColorCards(hydratedProducts)));
      // A colour card only earns its place when that colour itself has the size in
      // stock - the SQL predicate above can only vouch for the product.
      const sizeAvailableProducts = sizes.length
        ? expandedProducts.filter((product) => storefrontCardHasAvailableSize(product, sizes))
        : expandedProducts;
      // Colour, price and last-piece are card-level facets: the SQL above filters
      // products, so they can only be resolved once a product has been expanded
      // into its colour cards - but still before the page is cut.
      const facetFilteredProducts = perf.sync("card_facets", () => {
        const wantedColors = colors.map((color) => storefrontColorFilterKey(color)).filter(Boolean);
        if (!wantedColors.length && !minPrice && !maxPrice && !lastSizes) return sizeAvailableProducts;
        return sizeAvailableProducts.filter((product) => {
          if (wantedColors.length && !storefrontCardColorKeys(product).some((key) => wantedColors.includes(key))) return false;
          if (minPrice || maxPrice) {
            const price = toNumber(product.final_price ?? product.price ?? product.selling_price);
            if (minPrice && price < minPrice) return false;
            if (maxPrice && price > maxPrice) return false;
          }
          if (lastSizes) {
            const stock = toNumber(product.total_stock ?? product.stock);
            if (!(stock > 0 && stock <= STOREFRONT_LAST_PIECE_MAX_STOCK)) return false;
          }
          return true;
        });
      });
      if (randomSeed) {
        console.log("[storefront-shuffle-before]", expandedProducts.map((product) => storefrontCardId(product)));
      }
      const sortedExpandedProducts = perf.sync("sort_cards", () => (shouldOrderAfterExpansion ? sortStorefrontCards(facetFilteredProducts, sort, randomSeed) : facetFilteredProducts));
      const orderedExpandedProducts = perf.sync("offer_ordering", () => keepOfferCardsAfterRegularCards(sortedExpandedProducts, effectiveOfferStoryOnly || sizes.length > 0));
      const categoryProducts = largeSizes
        ? orderedExpandedProducts.filter((product) => (Array.isArray(product.variants) ? product.variants : []).some((variant) => {
            const variantSize = Number(variant.size ?? variant.size_value);
            return Number.isFinite(variantSize) && variantSize >= 47 && variantSize <= 50 && Number(variant.stock ?? variant.quantity ?? 0) > 0;
          }))
        : orderedExpandedProducts;
      if (randomSeed) {
        console.log("[storefront-shuffle-after]", orderedExpandedProducts.map((product) => storefrontCardId(product)));
      }
      let pagedProducts = perf.sync("pagination", () => categoryProducts.slice(offset, offset + limit));
      let usedOrderingFallback = false;
      if (!pagedProducts.length && categoryProducts.length) {
        const fallbackOffset = Math.min(offset, Math.max(0, categoryProducts.length - limit));
        pagedProducts = categoryProducts.slice(fallbackOffset, fallbackOffset + limit);
        usedOrderingFallback = true;
      }
      const total = categoryProducts.length;
      const hasMore = offset + pagedProducts.length < total;
      if (ERP_PERF_DEBUG) console.log("[storefront-color-expand-count]", {
        total_raw_products: rawProductCount,
        total_expanded_cards: expandedProducts.length,
        expansion_delta: expandedProducts.length - rawProductCount,
        returned_cards: pagedProducts.length,
        sort: sort || "random",
        random_seed: randomSeed || "",
        limit,
        offset,
        page,
        has_more: hasMore,
        used_ordering_fallback: usedOrderingFallback,
      });
      products = pagedProducts.map(slimProductForList);
      if (ERP_PERF_DEBUG) {
        console.log("[storefront] products", { tenantId, usedTenantFallback, q, category, brand, saleOnly, sort: sort || "random", scope, groupingMode, filters: { gender, brand, productType, grade }, count: products.length, total, hasMore, usedOrderingFallback });
      }
      return {
        success: true,
        products,
        items: products,
        total,
        total_count: total,
        count: products.length,
        hasMore,
        has_more: hasMore,
        page,
        limit,
        offset,
        sort: sort || "",
        scope,
        grouping_mode: groupingMode,
        random_seed: randomSeed || undefined,
      };
    }, cacheDiag);
    if (ERP_PERF_DEBUG) console.log("[erp-perf] storefront.products", { total_ms: Date.now() - startedAt, rows: payload.products?.length || 0, limit: payload.limit });
    res.json(payload);
  } catch (error) {
    console.error("[storefront/products] failed", {
      query: req.query || {},
      message: error?.message || String(error),
      stack: error?.stack || "",
      code: error?.code || "",
      detail: error?.detail || "",
      position: error?.position || "",
      sql: error?.sql || "",
      params: error?.params || [],
    });
    res.status(500).json({ success: false, message: "Failed to load products" });
  } finally {
    if (perf.enabled) {
      perf.set("cache_lookup", cacheDiag?.cache_lookup_ms ?? 0);
      perf.set("cache_write", cacheDiag?.cache_write_ms ?? 0);
      perf.end({ cache: cacheDiag?.cache ?? "unknown" });
    }
  }
};

// The listing sidebar used to build its own chips out of the 24 cards the API
// had already paged down to, so every count described the page instead of the
// section: /women showed "Black(2)" against 133 real cards, page 2 offered a
// completely different size list, and picking a colour collapsed the colour
// group to the one colour left on the page. Facets have to be counted over the
// whole section, so they are computed here - once per section, not per page.
//
// Scope is deliberately only what the route itself pins (the search term and the
// SEO category's own filters). The sidebar picks are left out on purpose: a
// facet counted with its own group applied can only ever return the value
// already selected, which is the trap that emptied the group.
const STOREFRONT_FACET_CANDIDATE_LIMIT = 5000;

const storefrontFacetScopeQuery = (query = {}) => {
  const normalized = normalizeStorefrontProductsQuery(query);
  return {
    q: normalized.q,
    audienceSearch: normalized.audienceSearch,
    gender: normalized.gender,
    productType: normalized.productType,
    offerStory: normalized.offerStory,
    saleOnly: normalized.saleOnly,
    largeSizes: normalized.largeSizes,
    inStock: normalized.inStock,
  };
};

const storefrontFacetCacheQuery = (scope = {}) => ({
  q: scope.q || "",
  audience_search: scope.audienceSearch || "",
  gender: scope.gender || "",
  product_type: scope.productType || "",
  offer_story: scope.offerStory ? 1 : 0,
  sale: scope.saleOnly ? 1 : 0,
  large_sizes: scope.largeSizes ? 1 : 0,
  in_stock: scope.inStock ? 1 : 0,
});

// One bucket per distinct value, keyed on the normalized form the API filters on
// so the chip that gets clicked and the row the SQL matches are the same thing.
const createStorefrontFacetBucket = () => {
  const buckets = new Map();
  return {
    add(value, key = "") {
      const label = toText(value);
      const bucketKey = toText(key) || storefrontColorFilterKey(label);
      if (!label || !bucketKey) return;
      const current = buckets.get(bucketKey);
      if (current) {
        current.count += 1;
        return;
      }
      buckets.set(bucketKey, { value: bucketKey, label, count: 1 });
    },
    toArray() {
      return [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar", { numeric: true }));
    },
  };
};

const storefrontCardBrandLabel = (card = {}) =>
  toText(card.brand) || toText(card.brand_name) || toText(card.product_brand) || toText(card.manufacturer_brand) || toText(card.manufacturer);

const storefrontCardSizeLabels = (card = {}) => {
  const sizes = Array.isArray(card.sizes) ? card.sizes : [];
  if (sizes.length) return [...new Set(sizes.map(toText).filter(Boolean))];
  const variants = Array.isArray(card.variants) ? card.variants : [];
  return [...new Set(variants.filter((variant) => toNumber(variant?.stock) > 0).map((variant) => toText(variant?.size)).filter(Boolean))];
};

export const buildStorefrontProductFacets = (cards = []) => {
  const audiences = new Map([["men", 0], ["women", 0], ["kids", 0]]);
  const colors = createStorefrontFacetBucket();
  const sizes = createStorefrontFacetBucket();
  const brands = createStorefrontFacetBucket();
  const grades = createStorefrontFacetBucket();
  const productTypes = createStorefrontFacetBucket();
  const categories = createStorefrontFacetBucket();
  let minPrice = null;
  let maxPrice = null;

  for (const card of Array.isArray(cards) ? cards : []) {
    for (const audience of normalizeProductAudiences(card.audiences, card.product_audiences, card.gender)) {
      if (audiences.has(audience)) audiences.set(audience, audiences.get(audience) + 1);
    }
    // A card is one colour, so it contributes to exactly one colour bucket -
    // counting every key a card carries would double-count multi-name colours.
    const [colorKey] = storefrontCardColorKeys(card);
    if (colorKey) colors.add(toText(card.display_color) || toText(card.color) || colorKey, colorKey);
    for (const size of storefrontCardSizeLabels(card)) sizes.add(size, storefrontColorFilterKey(size));
    const brand = storefrontCardBrandLabel(card);
    if (brand) brands.add(brand, storefrontColorFilterKey(brand));
    const grade = toText(card.grade);
    if (grade) grades.add(grade, storefrontColorFilterKey(grade));
    const productType = toText(card.product_type || card.productType);
    if (productType) productTypes.add(productType, storefrontColorFilterKey(productType));
    const category = toText(card.category);
    if (category) categories.add(category, storefrontColorFilterKey(category));
    const price = toNumber(card.final_price ?? card.price ?? card.selling_price);
    if (price > 0) {
      minPrice = minPrice === null ? price : Math.min(minPrice, price);
      maxPrice = maxPrice === null ? price : Math.max(maxPrice, price);
    }
  }

  return {
    total: Array.isArray(cards) ? cards.length : 0,
    audiences: [...audiences.entries()].map(([value, count]) => ({ value, label: value, count })),
    colors: colors.toArray(),
    sizes: sizes.toArray(),
    brands: brands.toArray(),
    grades: grades.toArray(),
    product_types: productTypes.toArray(),
    categories: categories.toArray(),
    price: { min: minPrice === null ? 0 : minPrice, max: maxPrice === null ? 0 : maxPrice },
  };
};

export const listProductFacets = async (req, res) => {
  const startedAt = Date.now();
  try {
    // Same window as the listing payload it decorates, and the same
    // storefront:tenant:* namespace, so a product save drops both together.
    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    const scope = storefrontFacetScopeQuery(req.query || {});
    const payload = await getOrSetCacheSWR(
      storefrontCacheKey(tenantId, "product-facets", storefrontFacetCacheQuery(scope)),
      storefrontCacheWindows(),
      async () => {
        const genderAliases = await getClassificationFilterAliases("gender", scope.gender);
        const gender = normalizeProductAudiences(genderAliases, scope.gender || scope.audienceSearch);
        const effectiveInStock = resolveEffectiveStorefrontInStock({ inStock: scope.inStock, offerStory: scope.offerStory, size: "" });
        const filters = {
          brand: "",
          gender,
          productType: scope.productType,
          grade: [],
          quality: [],
          sizes: [],
          bagType: [],
          size: "",
          inStock: effectiveInStock,
          offerStory: scope.offerStory,
        };
        let result = await queryProducts(tenantId, scope.q, "", filters, scope.saleOnly, STOREFRONT_FACET_CANDIDATE_LIMIT, 0);
        if (!result.rows.length && tenantId !== null) {
          const fallback = await queryProducts(null, scope.q, "", filters, scope.saleOnly, STOREFRONT_FACET_CANDIDATE_LIMIT, 0);
          if (fallback.rows.length) result = fallback;
        }
        const products = result.rows.map((row) => normalizeProduct(row, pricingSettings));
        // Images are the one hydration step a facet never reads, and it is the
        // expensive one - the chips only need colour, size, brand, grade, type
        // and price. Classification scrubbing stays: a retired classification
        // must not come back as a chip that matches nothing.
        const scrubbed = await scrubInactiveClassifications(products);
        const expanded = expandProductsToColorCards(scrubbed);
        const cards = scope.largeSizes
          ? expanded.filter((product) => (Array.isArray(product.variants) ? product.variants : []).some((variant) => {
              const variantSize = Number(variant.size ?? variant.size_value);
              return Number.isFinite(variantSize) && variantSize >= 47 && variantSize <= 50 && toNumber(variant.stock ?? variant.quantity) > 0;
            }))
          : expanded;
        return { success: true, facets: buildStorefrontProductFacets(cards) };
      }
    );
    if (ERP_PERF_DEBUG) console.log("[erp-perf] storefront.product-facets", { total_ms: Date.now() - startedAt, total: payload?.facets?.total ?? 0 });
    res.json(payload);
  } catch (error) {
    console.error("[storefront/products/facets] failed", {
      query: req.query || {},
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    res.status(500).json({ success: false, message: "Failed to load product facets" });
  }
};

export const visualSearchProducts = async (req, res) => {
  const file = req.file;
  const tenantId = tenantFromRequest(req);
  const emptyReason = { code: "", details: "" };
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();

    if (!file?.buffer?.length) {
      emptyReason.code = "missing_file";
      console.warn("[storefront-image-search] empty result reason", { tenantId, ...emptyReason });
      return res.status(400).json({ success: false, message: "يرجى رفع صورة للبحث" });
    }
    if (!VISUAL_SEARCH_ALLOWED_TYPES.has(file.mimetype)) {
      emptyReason.code = "unsupported_image_type";
      emptyReason.details = file.mimetype || "";
      console.warn("[storefront-image-search] empty result reason", { tenantId, ...emptyReason });
      return res.status(400).json({ success: false, message: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP" });
    }
    if (Number(file.size || file.buffer.length) > VISUAL_SEARCH_MAX_BYTES) {
      emptyReason.code = "image_too_large";
      emptyReason.details = `${file.size || file.buffer.length}`;
      console.warn("[storefront-image-search] empty result reason", { tenantId, ...emptyReason });
      return res.status(413).json({ success: false, message: "حجم الصورة كبير. ارفع صورة أصغر" });
    }

    console.log("[storefront-image-search] uploaded image received", {
      req_file_exists: Boolean(req.file),
      tenant_id: tenantId,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size || file.buffer.length,
    });

    let understanding = null;
    try {
      understanding = await understandProductImageForSearch({
        imageBuffer: file.buffer,
        mimeType: file.mimetype,
        requestId: req.id || `storefront:${Date.now()}`,
      });
    } catch (error) {
      console.warn("[storefront-image-search] vision understanding failed", {
        tenantId,
        message: error?.message || "vision failed",
      });
    }
    const visualQuery = [
      understanding?.detected?.brand_guess,
      understanding?.detected?.model_guess,
      understanding?.detected?.model_family,
      understanding?.detected?.product_type,
      understanding?.detected?.category,
      understanding?.detected?.colors,
      understanding?.detected?.main_colors,
      understanding?.detected?.silhouette,
      understanding?.detected?.sole_shape,
      understanding?.detected?.materials,
      understanding?.detected?.features,
    ].flat().filter(Boolean).join(" ");
    let proSearch = { candidates: [], attributes: null, topMatches: [], reasonWhyFirstRanked: "" };
    try {
      proSearch = await searchAiVisualProductsPro({
        tenantId,
        detected: understanding?.detected || {},
        visualQuery,
        uploadedImageBuffer: file.buffer,
        limit: 8,
      });
    } catch (error) {
      console.warn("[storefront-image-search] pro visual search failed; using local fallback", {
        tenantId,
        message: error?.message || "pro visual search failed",
      });
    }
    let candidates = Array.isArray(proSearch.candidates) ? proSearch.candidates : [];
    let matchedIds = candidates.map((item) => item.product_id).filter(Boolean);
    let keywords = [];
    let aiSource = "visual_search_pro";

    if (!matchedIds.length) {
      const localMatches = await findProductsByImageSimilarity({ tenantId, imageBuffer: file.buffer, limit: 8 }).catch((error) => {
        console.warn("[storefront-image-search] local visual fallback failed", {
          tenantId,
          message: error?.message || "local image similarity failed",
        });
        return [];
      });
      if (localMatches.length) {
        aiSource = "local_visual_similarity";
        matchedIds = localMatches.map((item) => item.productId).filter(Boolean);
        candidates = localMatches.map((item) => ({
          product_id: item.productId,
          finalScore: Number(item.score || 0) / 100,
          score: Number(item.score || 0) / 100,
          score_breakdown: {
            finalScore: Number(item.score || 0) / 100,
            reasonWhyRankedFirst: item.reason || "local visual similarity",
            distance: item.distance,
            colorSimilarity: item.colorSimilarity,
          },
        }));
      }
    }

    if (!matchedIds.length) {
      let aiResult = null;
      try {
        const imageBase64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
        aiResult = await generateAiProductData({
          image_base64: imageBase64,
          current: { source: "storefront_visual_search", filename: file.originalname || "" },
        });
      } catch (error) {
        console.warn("[storefront-image-search] keyword AI fallback failed", {
          tenantId,
          message: error?.message || "keyword AI fallback failed",
        });
      }
      aiSource = aiResult?.source || "keyword_fallback";
      keywords = visualKeywordsFromAi(aiResult);
      console.log("[storefront-image-search] detected keywords/labels", { tenantId, source: aiSource, keywords });
      matchedIds = await queryVisualKeywordProductIds(tenantId, keywords, 8).catch((error) => {
        console.warn("[storefront-image-search] keyword product lookup failed", {
          tenantId,
          message: error?.message || "keyword lookup failed",
        });
        return [];
      });
      candidates = matchedIds.map((productId, index) => ({
        product_id: productId,
        finalScore: Math.max(0.1, 0.45 - index * 0.04),
        score_breakdown: { finalScore: Math.max(0.1, 0.45 - index * 0.04), reasonWhyRankedFirst: "keyword fallback" },
      }));
    } else {
      keywords = [
        proSearch.attributes?.brand,
        proSearch.attributes?.model,
        proSearch.attributes?.productType,
        ...(Array.isArray(proSearch.attributes?.mainColors) ? proSearch.attributes.mainColors : []),
      ].filter(Boolean);
      console.log("[storefront-image-search] detected keywords/labels", {
        tenantId,
        source: aiSource,
        keywords,
        visual_confidence: understanding?.confidence || 0,
        top_candidates: proSearch.topMatches?.slice(0, 5) || [],
      });
    }

    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    let products = await queryProductsByIds(tenantId, matchedIds, pricingSettings);
    products = expandProductsToColorCards(await scrubInactiveClassifications(await hydrateProductsWithImages(products, { compact: true }))).map(slimProductForList);
    const productsById = new Map();
    products.forEach((product) => {
      const key = String(product.parent_product_id || product.id);
      if (!productsById.has(key)) productsById.set(key, []);
      productsById.get(key).push(product);
    });
    products = candidates.flatMap((candidate) =>
      (productsById.get(String(candidate.product_id)) || []).map((product) => ({
        ...product,
        visual_score: Number(candidate.finalScore || candidate.score || 0),
        final_score: Number(candidate.finalScore || candidate.score || 0),
        image_match_score: Number(candidate.finalScore || candidate.score || 0),
        image_ranking_debug: candidate.score_breakdown || null,
      }))
    );

    console.log("[storefront-image-search] matched product ids", {
      tenant_id: tenantId,
      candidate_product_count: matchedIds.length,
      final_matched_result_count: products.length,
      product_ids: products.map((product) => product.id),
      direct_matches: candidates.map((candidate) => ({
        productId: candidate.product_id,
        variantId: candidate.variant_id,
        score: candidate.finalScore || candidate.score || 0,
        breakdown: candidate.score_breakdown || null,
      })),
    });

    if (!products.length) {
      emptyReason.code = keywords.length ? "no_keyword_matches" : "no_image_or_keyword_matches";
      emptyReason.details = keywords.join(", ");
      console.warn("[storefront-image-search] empty result reason", { tenantId, ...emptyReason });
    }

    res.json({
      success: true,
      products,
      keywords,
      message: products.length
        ? (Number(candidates[0]?.finalScore || candidates[0]?.score || 0) >= 0.82 ? "أيوه، ده أقرب موديل عندنا" : "مش لاقي نفس الموديل بالظبء بس دي أقرب اختيارات شبهه.")
        : "مش لاقي نفس الموديل بالظبء بس دي أقرب اختيارات شبهه.",
      source: aiSource,
      visual_confidence: understanding?.confidence || 0,
      visual_attributes: proSearch.attributes || null,
      top_candidates: proSearch.topMatches || [],
      correction_used: false,
      top_rank_reason: proSearch.reasonWhyFirstRanked || "",
    });
  } catch (error) {
    console.error("[storefront-image-search] failed", {
      req_file_exists: Boolean(req.file),
      tenant_id: tenantId,
      mimetype: file?.mimetype || "",
      size: file?.size || file?.buffer?.length || 0,
      message: error?.message || String(error),
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      message: "تعذر البحث بالصورة الآن",
      ...(process.env.NODE_ENV !== "production" ? { error: error?.message || "visual_search_failed" } : {}),
    });
  }
};

export const imageSearchProducts = async (req, res) => {
  const file = req.file;
  const tenantId = tenantFromRequest(req);
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();

    if (!file?.buffer?.length) {
      return res.status(400).json({ success: false, message: "يرجى رفع صورة للبحث" });
    }
    if (!VISUAL_SEARCH_ALLOWED_TYPES.has(file.mimetype)) {
      return res.status(400).json({ success: false, message: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP" });
    }
    if (Number(file.size || file.buffer.length) > VISUAL_SEARCH_MAX_BYTES) {
      return res.status(413).json({ success: false, message: "حجم الصورة كبير. ارفع صورة أصغر" });
    }

    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    let understanding = null;
    try {
      understanding = await withTimeout(
        understandProductImageForSearch({
          imageBuffer: file.buffer,
          mimeType: file.mimetype,
          requestId: req.id || `storefront-image:${Date.now()}`,
        }),
        process.env.STOREFRONT_IMAGE_VISION_TIMEOUT_MS || 12000,
        "storefront_image_vision"
      );
    } catch (error) {
      console.warn("[storefront-image-search] vision understanding failed; continuing with local matching", {
        tenantId,
        message: error?.message || "vision failed",
      });
    }

    const requestVisualQuery = [
      req.body?.query,
      req.body?.search,
      req.body?.keyword,
      file.originalname,
    ].filter(Boolean).join(" ");
    const visualQuery = [visualQueryFromUnderstanding(understanding), requestVisualQuery].filter(Boolean).join(" ");
    let proSearch = { candidates: [], attributes: null, topMatches: [], reasonWhyFirstRanked: "" };
    try {
      proSearch = await withTimeout(
        searchAiVisualProductsPro({
          tenantId,
          detected: understanding?.detected || {},
          visualQuery,
          uploadedImageBuffer: file.buffer,
          limit: 18,
        }),
        process.env.STOREFRONT_IMAGE_PRO_SEARCH_TIMEOUT_MS || 9000,
        "storefront_image_pro_search"
      );
    } catch (error) {
      console.warn("[storefront-image-search] pro visual search failed; continuing with local matching", {
        tenantId,
        message: error?.message || "pro visual search failed",
      });
    }

    const proMatches = (Array.isArray(proSearch.candidates) ? proSearch.candidates : []).map((item) => ({
      productId: item.product_id || item.productId,
      variantId: item.variant_id || item.variantId,
      score: item.finalScore ?? item.score ?? 0,
      reason: item.exact_image_match ? "visual_pro_exact" : item.score_breakdown?.reasonWhyRankedFirst || "visual_pro",
      exact_image_match: item.exact_image_match,
      score_breakdown: item.score_breakdown || null,
    }));

    const imageMatches = await withTimeout(
      findProductsByImageSimilarity({ tenantId, imageBuffer: file.buffer, limit: 18 }),
      process.env.STOREFRONT_IMAGE_LOCAL_SEARCH_TIMEOUT_MS || 26000,
      "storefront_image_local_search"
    ).catch((error) => {
      console.warn("[storefront-image-search] image similarity failed; continuing with fallback", {
        tenantId,
        message: error?.message || "image similarity failed",
      });
      return [];
    });
    const mergedMatches = mergeImageSearchMatches(proMatches, imageMatches).slice(0, 18);
    const matchedIds = [...new Set(mergedMatches.map((item) => Number(item.productId)).filter((value) => Number.isFinite(value) && value > 0))];

    let products = matchedIds.length ? await queryProductsByIds(tenantId, matchedIds, pricingSettings) : [];
    products = matchedIds.length
      ? await scrubInactiveClassifications(await hydrateProductsWithImages(products, { compact: true }))
      : [];

    const productsById = new Map(products.map((product) => [String(product.id), product]));
    const exactMatches = [];
    const similarMatches = [];

    for (const match of mergedMatches) {
      const product = productsById.get(String(match.productId));
      if (!product) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(match.score || 0))));
      const payload = {
        ...slimProductForList(product),
        confidence: score,
        score,
        match_type: match.reason === "exact_sha256" || match.reason === "visual_pro_exact" || score >= 95 || (score >= 80 && String(match.reason || "").includes("known_model")) ? "exact" : "similar",
        match_reason: match.reason || "",
        matched_variant_id: match.variantId || null,
        image_ranking_debug: match.scoreBreakdown || null,
      };
      if (payload.match_type === "exact") {
        exactMatches.push(payload);
      } else {
        similarMatches.push(payload);
      }
    }

    const inferredGender = normalizeProductAudiences(req.body?.gender, req.body?.audience, req.body?.audiences);
    const inferredCategory = String(req.body?.category || req.body?.product_category || "").trim();
    const inferredProductType = String(req.body?.product_type || req.body?.productType || req.body?.type || "").trim();
    const inferredBrand = String(req.body?.brand || "").trim();

    if (!exactMatches.length && !similarMatches.length) {
      const fallback = await queryProducts(
        tenantId,
        visualQuery,
        inferredCategory,
        {
          brand: inferredBrand || proSearch.attributes?.brand || understanding?.detected?.brand_guess || "",
          gender: inferredGender,
          productType: uniqueTerms([inferredProductType, proSearch.attributes?.productType, understanding?.detected?.product_type]),
          grade: [],
          quality: [],
          size: "",
          inStock: true,
        },
        false,
        8,
        0
      ).catch((error) => {
        console.warn("[storefront-image-search] metadata fallback failed", {
          tenantId,
          message: error?.message || "metadata fallback failed",
        });
        return { rows: [] };
      });
      const fallbackProducts = await scrubInactiveClassifications(
        await hydrateProductsWithImages(
          fallback.rows.map((row) => normalizeProduct(row, pricingSettings)),
          { compact: true }
        )
      );
      for (const product of fallbackProducts.slice(0, 8)) {
        similarMatches.push({
          ...slimProductForList(product),
          confidence: 35,
          score: 35,
          match_type: "similar",
          match_reason: "metadata_fallback",
        });
      }
    }

    const topConfidence = exactMatches[0]?.confidence || similarMatches[0]?.confidence || 0;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(topConfidence || 0))));
    const message = confidence >= 80
      ? "لقينا الموديل ده"
      : similarMatches.length
        ? "الموديل مش متوفر، بس دي أقرب موديلات شبهه"
        : "الموديل ده مش متوفر حاليًا";

    return res.json({
      success: true,
      exactMatches,
      similarMatches,
      products: [...exactMatches, ...similarMatches],
      confidence,
      message,
      source: proMatches.length ? "visual_pro_plus_local_similarity" : imageMatches.length ? "local_visual_similarity" : exactMatches.length || similarMatches.length ? "metadata_fallback" : "image_search_empty",
      fallback_used: !mergedMatches.length,
      visual_confidence: understanding?.confidence || 0,
      visual_attributes: proSearch.attributes || understanding?.detected || null,
      top_candidates: proSearch.topMatches || [],
      top_rank_reason: proSearch.reasonWhyFirstRanked || "",
    });
  } catch (error) {
    console.error("[storefront-image-search] failed", {
      req_file_exists: Boolean(req.file),
      tenant_id: tenantId,
      mimetype: file?.mimetype || "",
      size: file?.size || file?.buffer?.length || 0,
      message: error?.message || String(error),
      stack: error?.stack,
    });
    return res.status(500).json({
      success: false,
      message: "تعذر البحث بالصورة الآن",
      ...(process.env.NODE_ENV !== "production" ? { error: error?.message || "image_search_failed" } : {}),
    });
  }
};

const countActiveProductsByGender = async (tenantId, aliases = []) => {
  const normalizedAliases = normalizeProductAudiences(aliases);
  if (!normalizedAliases.length) return 0;

  const result = await db.query(
    `
    SELECT COUNT(DISTINCT p.id)::int AS total
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.id
      AND pv.is_active IS DISTINCT FROM FALSE
      AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
      AND pv.deleted_at IS NULL
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
      AND p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
      AND COALESCE(p.is_storefront_visible, TRUE) = TRUE
      AND ${productAudienceFilterSql("$2")}
      AND COALESCE(pv.stock, p.stock, 0) > 0
    `,
    [tenantId, normalizedAliases]
  );
  return Number(result.rows[0]?.total || 0);
};

export const listGenderClassifications = async (req, res) => {
  try {
    const tenantId = tenantFromRequest(req);
    const payload = await (async () => {
      const group = await fetchProductClassificationGroupByKey("gender", { includeInactive: false });
      const options = [];
      const sourceOptions = group?.options?.length
        ? group.options
        : [
            { id: "men", value: "men", label_en: "Men", label_ar: "Men", name_en: "Men", name_ar: "Men", icon: "", color: "", sort_order: 1, is_active: true },
            { id: "women", value: "women", label_en: "Women", label_ar: "Women", name_en: "Women", name_ar: "Women", icon: "", color: "", sort_order: 2, is_active: true },
            { id: "kids", value: "kids", label_en: "Kids", label_ar: "Kids", name_en: "Kids", name_ar: "Kids", icon: "", color: "", sort_order: 3, is_active: true },
          ];

      for (const option of sourceOptions) {
        const aliases = await getClassificationFilterAliases("gender", option.value);
        let product_count = await countActiveProductsByGender(tenantId, [...aliases, option.value, option.label_en, option.label_ar]);
        if (product_count === 0 && tenantId !== null) {
          product_count = await countActiveProductsByGender(null, [...aliases, option.value, option.label_en, option.label_ar]);
        }
        options.push({
          id: option.id,
          value: option.value,
          name_ar: option.name_ar || option.label_ar || "",
          name_en: option.name_en || option.label_en || "",
          label_ar: option.label_ar,
          label_en: option.label_en,
          english_name: option.english_name || option.label_en || "",
          icon: option.icon,
          color: option.color,
          sort_order: option.sort_order,
          is_active: option.is_active,
          product_count,
        });
      }

      return { success: true, group: "gender", options };
    })();
    res.json(payload);
  } catch (error) {
    console.error("[storefront] gender classifications", error);
    res.status(500).json({ success: false, message: "Failed to load gender classifications" });
  }
};

const lastPieceCategorySql = `
  CASE
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, c.name)) LIKE ANY (ARRAY['%رجال%', '%male%', '%men%']) THEN 'رجالي'
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, c.name)) LIKE ANY (ARRAY['%حريمي%', '%نساء%', '%نسائي%', '%female%', '%women%']) THEN 'حريمي'
    WHEN LOWER(CONCAT_WS(' ', p.gender, p.product_type, c.name)) LIKE ANY (ARRAY['%أطفال%', '%اطفال%', '%طفل%', '%kids%', '%children%']) THEN 'أطفال'
    ELSE COALESCE(NULLIF(c.name, ''), NULLIF(p.product_type, ''), NULLIF(p.gender, ''), '')
  END
`;

const numericJsonExpr = (jsonColumn, key) => `
  CASE
    WHEN ${jsonColumn} ? '${key}'
      AND (${jsonColumn}->>'${key}') ~ '^[0-9]+(\\.[0-9]+)?$'
    THEN (${jsonColumn}->>'${key}')::numeric
    ELSE 0
  END
`;

const buildPurchaseInvoiceSalePriceJoin = async () => {
  const [purchaseColumns, purchaseItemColumns] = await Promise.all([
    tableColumns(db, "purchases"),
    tableColumns(db, "purchase_items"),
  ]);
  if (!purchaseItemColumns.size || !purchaseItemColumns.has("purchase_id")) {
    return { join: "", select: "0" };
  }

  const saleCandidates = [];
  if (purchaseItemColumns.has("sale_price")) saleCandidates.push("NULLIF(pi.sale_price, 0)");
  if (purchaseItemColumns.has("metadata")) saleCandidates.push(`NULLIF(${numericJsonExpr("pi.metadata", "sale_price")}, 0)`);
  const sellingCandidates = [];
  if (purchaseItemColumns.has("selling_price")) sellingCandidates.push("NULLIF(pi.selling_price, 0)");
  if (purchaseItemColumns.has("regular_price")) sellingCandidates.push("NULLIF(pi.regular_price, 0)");
  if (purchaseItemColumns.has("metadata")) {
    sellingCandidates.push(`NULLIF(${numericJsonExpr("pi.metadata", "selling_price")}, 0)`);
    sellingCandidates.push(`NULLIF(${numericJsonExpr("pi.metadata", "regular_price")}, 0)`);
  }
  if (!saleCandidates.length && !sellingCandidates.length) {
    return { join: "", selectSale: "COALESCE(NULLIF(pv.sale_price, 0), 0)", selectSelling: "COALESCE(NULLIF(pv.price, 0), 0)", selectLastPiece: "COALESCE(NULLIF(pv.sale_price, 0), NULLIF(pv.price, 0), 0)" };
  }

  const matchClauses = [];
  if (purchaseItemColumns.has("variant_id")) matchClauses.push("pi.variant_id = pv.id");
  if (purchaseItemColumns.has("product_id") && purchaseItemColumns.has("size")) {
    matchClauses.push("(pi.product_id = p.id AND LOWER(TRIM(pi.size)) = LOWER(TRIM(pv.size)))");
  }
  if (!matchClauses.length) {
    return { join: "", selectSale: "COALESCE(NULLIF(pv.sale_price, 0), 0)", selectSelling: "COALESCE(NULLIF(pv.price, 0), 0)", selectLastPiece: "COALESCE(NULLIF(pv.sale_price, 0), NULLIF(pv.price, 0), 0)" };
  }

  const tenantClause = purchaseItemColumns.has("tenant_id") ? "AND (pi.tenant_id = p.tenant_id OR pi.tenant_id IS NULL)" : "";
  const purchaseTenantClause = purchaseColumns.has("tenant_id") ? "AND (pu.tenant_id = p.tenant_id OR pu.tenant_id IS NULL)" : "";
  const purchaseStatusClause = purchaseColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(pu.status)), ''), 'received') NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')"
    : "";
  const purchaseDateExpr = purchaseColumns.has("created_at") ? "pu.created_at" : "pi.id";
  const purchaseSaleExpr = saleCandidates.length ? `COALESCE(${saleCandidates.join(", ")}, 0)` : "0";
  const purchaseSellingExpr = sellingCandidates.length ? `COALESCE(${sellingCandidates.join(", ")}, 0)` : "0";

  return {
    join: `
      LEFT JOIN LATERAL (
        SELECT
          ${purchaseSaleExpr} AS purchase_sale_price,
          ${purchaseSellingExpr} AS purchase_selling_price
        FROM purchase_items pi
        JOIN purchases pu ON pu.id = pi.purchase_id
        WHERE (${matchClauses.join(" OR ")})
          ${tenantClause}
          ${purchaseTenantClause}
          ${purchaseStatusClause}
          AND (${purchaseSaleExpr} > 0 OR ${purchaseSellingExpr} > 0)
        ORDER BY ${purchaseDateExpr} DESC NULLS LAST, pi.id DESC
        LIMIT 1
      ) last_purchase_price ON TRUE
    `,
    selectSale: "COALESCE(last_purchase_price.purchase_sale_price, NULLIF(pv.sale_price, 0), 0)",
    selectSelling: "COALESCE(last_purchase_price.purchase_selling_price, NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), 0)",
    selectLastPiece: "COALESCE(last_purchase_price.purchase_sale_price, NULLIF(pv.sale_price, 0), last_purchase_price.purchase_selling_price, NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), 0)",
  };
};

const queryLastPieceProducts = async (tenantId, category, size, limit) => {
  const variantColumns = await tableColumns(db, "product_variants");
  const purchaseSalePrice = await buildPurchaseInvoiceSalePriceJoin();
  const variantStatusClause = variantColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(pv.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')"
    : "";

  return db.query(
    `
    WITH active_variants AS (
      SELECT
        pv.*,
        ${lastPieceCategorySql} AS last_piece_category,
        ${purchaseSalePrice.selectSale} AS purchase_sale_price,
        ${purchaseSalePrice.selectSale} AS purchase_invoice_sale_price,
        ${purchaseSalePrice.selectSelling} AS purchase_invoice_selling_price,
        ${purchaseSalePrice.selectLastPiece} AS last_piece_sale_price
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      ${purchaseSalePrice.join}
      WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
        AND p.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
        AND COALESCE(p.is_storefront_visible, TRUE) = TRUE
        AND pv.is_active IS DISTINCT FROM FALSE
        AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
        AND pv.deleted_at IS NULL
        ${variantStatusClause}
        AND ($2 = '' OR ${lastPieceCategorySql} = $2)
    ),
    product_stock AS (
      SELECT
        product_id,
        COALESCE(SUM(GREATEST(COALESCE(stock, 0), 0)), 0)::int AS total_product_stock
      FROM active_variants
      GROUP BY product_id
    ),
    last_piece_products AS (
      SELECT ps.*
      FROM product_stock ps
      WHERE ps.total_product_stock BETWEEN 1 AND 3
        AND (
          $3 = ''
          OR EXISTS (
            SELECT 1
            FROM active_variants av
            WHERE av.product_id = ps.product_id
              AND GREATEST(COALESCE(av.stock, 0), 0) > 0
              AND LOWER(TRIM(av.size)) = LOWER(TRIM($3))
          )
        )
    )
    SELECT
      p.*,
      c.name AS category_name,
      b.name AS brand_name,
      COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS public_image_url,
      lpp.total_product_stock AS variant_total_stock,
      COALESCE(BOOL_OR(av.sale_price > 0 AND av.sale_price < av.price), FALSE) AS has_variant_discount,
      jsonb_agg(
        jsonb_build_object(
          'id', av.id,
          'product_id', av.product_id,
          'size', av.size,
          'color', av.color,
          'sku', av.sku,
          'barcode', av.barcode,
          'edition_name', av.edition_name,
          'edition_slug', av.edition_slug,
          'image_url', COALESCE(NULLIF(av.image_url, ''), NULLIF(av.image, ''), NULLIF(av.photo_url, ''), NULLIF(av.thumbnail_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), ''),
          'price', COALESCE(NULLIF(av.selling_price, 0), av.price),
          'selling_price', COALESCE(NULLIF(av.selling_price, 0), av.price),
          'regular_price', COALESCE(NULLIF(av.regular_price, 0), av.price),
          'original_price', COALESCE(NULLIF(av.regular_price, 0), NULLIF(p.regular_price, 0), av.price),
          'base_price', COALESCE(NULLIF(av.regular_price, 0), NULLIF(p.regular_price, 0), av.price),
          'list_price', COALESCE(NULLIF(av.regular_price, 0), NULLIF(p.regular_price, 0), av.price),
          'compare_base_price', COALESCE(NULLIF(p.custom_compare_price, 0), NULLIF(av.regular_price, 0), NULLIF(p.regular_price, 0), av.price),
          'custom_compare_price', COALESCE(NULLIF(p.custom_compare_price, 0), NULLIF(av.regular_price, 0), NULLIF(p.regular_price, 0), av.price),
          'sale_price', av.sale_price,
          'purchase_sale_price', av.purchase_sale_price,
          'purchase_invoice_sale_price', av.purchase_invoice_sale_price,
          'purchase_invoice_selling_price', av.purchase_invoice_selling_price,
          'last_piece_sale_price', av.last_piece_sale_price,
          'sale_price_enabled', av.sale_price_enabled,
          'sale_start_at', av.sale_start_at,
          'sale_end_at', av.sale_end_at,
          'cost_price', av.cost_price,
          'stock', av.stock,
          'last_piece_category', av.last_piece_category
        )
        ORDER BY av.stock ASC, av.size ASC, av.color ASC
      ) FILTER (WHERE GREATEST(COALESCE(av.stock, 0), 0) > 0 AND COALESCE(NULLIF(TRIM(av.size), ''), '') <> '') AS variants
    FROM last_piece_products lpp
    JOIN products p ON p.id = lpp.product_id
    JOIN active_variants av ON av.product_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    GROUP BY p.id, c.name, b.name, m.name, lpp.total_product_stock
    ORDER BY lpp.total_product_stock ASC, MIN(GREATEST(COALESCE(av.stock, 0), 0)) ASC, MAX(p.updated_at) DESC NULLS LAST, p.id DESC
    LIMIT $4
    `,
    [tenantId, toText(category), toText(size), limit]
  );
};

const queryLastPieceApiDebugStats = async (tenantId, category, size) => {
  const variantColumns = await tableColumns(db, "product_variants");
  const variantStatusClause = variantColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(pv.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')"
    : "";
  const result = await db.query(
    `
    WITH active_variants AS (
      SELECT
        pv.product_id,
        p.name AS product_name,
        pv.size,
        pv.color,
        GREATEST(COALESCE(pv.stock, 0), 0) AS stock,
        ${lastPieceCategorySql} AS last_piece_category
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
        AND p.is_active IS DISTINCT FROM FALSE
        AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
        AND COALESCE(p.is_storefront_visible, TRUE) = TRUE
        AND pv.is_active IS DISTINCT FROM FALSE
        AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
        AND pv.deleted_at IS NULL
        ${variantStatusClause}
        AND ($2 = '' OR ${lastPieceCategorySql} = $2)
    ),
    product_stock AS (
      SELECT
        product_id,
        MAX(product_name) AS product_name,
        MAX(last_piece_category) AS last_piece_category,
        COALESCE(SUM(stock), 0)::int AS total_product_stock,
        jsonb_agg(
          jsonb_build_object('size', size, 'color', color, 'qty', stock)
          ORDER BY stock ASC, size ASC, color ASC
        ) FILTER (WHERE stock > 0) AS variants
      FROM active_variants
      GROUP BY product_id
    ),
    matching_products AS (
      SELECT ps.*
      FROM product_stock ps
      WHERE ps.total_product_stock > 0
        AND (
          $3 = ''
          OR EXISTS (
            SELECT 1
            FROM active_variants av
            WHERE av.product_id = ps.product_id
              AND av.stock > 0
              AND LOWER(TRIM(av.size)) = LOWER(TRIM($3))
          )
        )
    )
    SELECT
      COUNT(*) FILTER (WHERE total_product_stock BETWEEN 1 AND 3)::int AS eligible_product_count,
      COUNT(*) FILTER (WHERE total_product_stock > 3)::int AS excluded_because_total_above3,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', product_id,
            'name', product_name,
            'category', last_piece_category,
            'totalProductStock', total_product_stock,
            'variants', variants
          )
          ORDER BY total_product_stock ASC, product_id DESC
        ) FILTER (WHERE total_product_stock BETWEEN 1 AND 3),
        '[]'::jsonb
      ) AS sample_eligible_products
    FROM matching_products
    `,
    [tenantId, toText(category), toText(size)]
  );
  return result.rows[0] || {};
};

export const listLastPieceProducts = async (req, res) => {
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const payload = await (async () => {
      const category = toText(req.query.category);
      const size = toText(req.query.size);
      const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 120);
      let result = await queryLastPieceProducts(tenantId, category, size, limit);
      let usedTenantFallback = false;
      if (!result.rows.length && tenantId !== null) {
        const fallback = await queryLastPieceProducts(null, category, size, limit);
        if (fallback.rows.length) {
          result = fallback;
          usedTenantFallback = true;
        }
      }

      const pricingSettings = await loadStorefrontPricingSettings(tenantId);
      const products = await scrubInactiveClassifications(await hydrateProductsWithImages(result.rows.map((row) => normalizeProduct(row, pricingSettings)), { compact: true })).then((rows) => rows.map((product) => {
        const availableVariants = (product.variants || []).filter((variant) => {
          const stock = toNumber(variant.stock);
          return stock > 0;
        }).sort((a, b) => toNumber(a.stock) - toNumber(b.stock));
        const totalProductStock = toNumber(product.total_stock || product.variant_total_stock || product.stock);
        const categoryLabel = firstText(availableVariants[0]?.last_piece_category, product.category);
        return {
          ...product,
          category: categoryLabel,
          total_stock: totalProductStock,
          variants: availableVariants,
          sizes: [...new Set(availableVariants.map((variant) => variant.size).filter(Boolean))],
          colors: [...new Set(availableVariants.map((variant) => variant.color).filter(Boolean))],
          low_stock: true,
        };
      }).filter((product) => product.total_stock > 0 && product.total_stock <= 3 && product.variants.length).map(slimProductForList));

      const categories = ["رجالي", "حريمي", "أطفال"]
        .map((label) => ({
          label,
          count: products.filter((product) => product.category === label).length,
        }))
        .filter((item) => item.count > 0);
      const sizes = [...new Set(
        products
          .filter((product) => !category || product.category === category)
          .flatMap((product) => product.variants.map((variant) => variant.size).filter(Boolean))
      )].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b), "ar"));

      if (process.env.NODE_ENV !== "production") {
        console.log("[storefront] last-piece", { tenantId, usedTenantFallback, category, size, products: products.length });
      }
      products.slice(0, 10).forEach((product) => {
        (product.variants || []).forEach((row) => {
          console.log("[last-piece-db-price-trace]", {
            product_id: row.product_id || product.id,
            variant_id: row.id,
            size: row.size,
            color: row.color,
            stock: row.stock,
            raw_row_keys: Object.keys(row || {}),
            raw_prices: {
              row_sale_price: row.sale_price,
              row_selling_price: row.selling_price,
              row_retail_price: row.retail_price,
              row_unit_sale_price: row.unit_sale_price,
              row_purchase_sale_price: row.purchase_sale_price,
              row_purchase_invoice_sale_price: row.purchase_invoice_sale_price,
              row_purchase_invoice_selling_price: row.purchase_invoice_selling_price,
              row_last_piece_sale_price: row.last_piece_sale_price,
              row_final_price: row.final_price,
              row_price: row.price,
              row_regular_price: row.regular_price,
            },
          });
        });
      });

      return {
        success: true,
        categories,
        sizes,
        products,
        hooks: {
          story_export: "reserved",
          telegram_posting: "reserved",
          whatsapp_status_export: "reserved",
          countdown_timers: "reserved",
          size_view_counts: "reserved",
        },
      };
    })();
    try {
      const category = toText(req.query.category);
      const size = toText(req.query.size);
      const stats = await queryLastPieceApiDebugStats(tenantId, category, size);
      console.log("[last-piece-api-debug]", {
        categoryId: req.query.category_id || req.query.categoryId || null,
        categoryName: category || null,
        eligibleProductCount: Number(stats.eligible_product_count || payload.products?.length || 0),
        excludedBecauseTotalAbove3: Number(stats.excluded_because_total_above3 || 0),
        sampleEligibleProducts: (Array.isArray(stats.sample_eligible_products) ? stats.sample_eligible_products : []).slice(0, 5),
      });
    } catch (debugError) {
      console.warn("[last-piece-api-debug] failed", debugError?.message || debugError);
    }
    res.json(payload);
  } catch (error) {
    console.error("[storefront] last-piece", error);
    res.status(500).json({ success: false, message: "Failed to load last piece products" });
  }
};

export const resolveProductLink = async (req, res) => {
  try {
    const tenantId = tenantFromRequest(req);
    const slugOrId = toText(req.params.slugOrId || req.params.identifier || "");
    if (!slugOrId) return res.status(404).json({ success: false, resolvable: false, message: "Product not found" });
    const identifiers = productIdentifierCandidates(slugOrId);
    let matchedTenantId = tenantId;
    let productId = await findStorefrontProductId(matchedTenantId, identifiers);
    if (!productId && tenantId !== null) {
      matchedTenantId = null;
      productId = await findStorefrontProductId(matchedTenantId, identifiers);
    }
    const productRow = await loadStorefrontProductRowById(matchedTenantId, productId);
    if (!productRow) {
      console.warn("[storefront] product resolve failed", {
        identifier: slugOrId,
        identifiers,
        tenant_id: tenantId,
        reason: "product_not_found",
      });
      return res.status(404).json({ success: false, resolvable: false, message: "Product not found" });
    }
    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    const [product] = await scrubInactiveClassifications(
      await hydrateProductsWithImages([normalizeProduct(productRow, pricingSettings)])
    );
    const link = await resolveStorefrontProductLink({ tenantId, product });
    console.log("[storefront] product resolve", {
      identifier: slugOrId,
      tenant_id: tenantId,
      product_id: product.id,
      slug: product.slug || "",
      generated_url: link.product_url || "",
      resolve_success: link.resolve_success,
      fallback_used: link.fallback_used,
    });
    if (!link.resolve_success) {
      return res.status(404).json({ success: false, resolvable: false, product, link, message: "Product link cannot resolve" });
    }
    return res.json({ success: true, resolvable: true, product, link });
  } catch (error) {
    console.error("[storefront] product resolve", error);
    return res.status(500).json({ success: false, resolvable: false, message: "Failed to resolve product" });
  }
};

export const getProduct = async (req, res) => {
  try {
    const tenantId = tenantFromRequest(req);
    const identifier = toText(req.params.identifier || req.params.id || "");
    if (!identifier) return res.status(404).json({ success: false, message: "Product not found" });
    const identifiers = productIdentifierCandidates(identifier);
    console.log("[storefront] product lookup", { identifier, identifiers, tenant_id: tenantId, filters: productLookupFilters });
    let matchedTenantId = tenantId;
    let productId = await findStorefrontProductId(matchedTenantId, identifiers);
    if (!productId && tenantId !== null) {
      matchedTenantId = null;
      productId = await findStorefrontProductId(matchedTenantId, identifiers);
    }
    const productRow = await loadStorefrontProductRowById(matchedTenantId, productId);
    if (!productRow) {
      console.warn("[storefront] product not found", {
        identifier,
        identifiers,
        tenant_id: tenantId,
        checked_fields: productLookupFields,
        filters: productLookupFilters,
      });
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    console.log("[storefront] product matched", { identifier, matched_product_id: productRow.id });
    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    const [product] = await scrubInactiveClassifications(await hydrateProductsWithImages([normalizeProduct(productRow, pricingSettings)]));
    const firstVariant = Array.isArray(product?.variants) ? product.variants[0] : null;
    console.log("[storefront-price-debug]", {
      identifier,
      product_id: product?.id,
      slug: product?.slug,
      original_price: product?.original_price,
      base_price: product?.base_price,
      list_price: product?.list_price,
      regular_price: product?.regular_price,
      compare_at_price: product?.compare_at_price,
      selling_price: product?.selling_price,
      sale_price: product?.sale_price,
      final_price: product?.final_price,
      sale_mode_enabled: product?.sale_mode_enabled,
      first_variant: firstVariant ? {
        id: firstVariant.id,
        original_price: firstVariant.original_price,
        base_price: firstVariant.base_price,
        list_price: firstVariant.list_price,
        regular_price: firstVariant.regular_price,
        compare_at_price: firstVariant.compare_at_price,
        selling_price: firstVariant.selling_price,
        sale_price: firstVariant.sale_price,
        final_price: firstVariant.final_price,
        sale_mode_enabled: firstVariant.sale_mode_enabled,
      } : null,
    });
    const productPricePayload = {
      id: product?.id,
      slug: product?.slug,
      original_price: product?.original_price,
      base_price: product?.base_price,
      regular_price: product?.regular_price,
      list_price: product?.list_price,
      compare_at_price: product?.compare_at_price,
      compare_base_price: product?.compare_base_price,
      custom_compare_price: product?.custom_compare_price,
      use_custom_compare_price: product?.use_custom_compare_price,
      selling_price: product?.selling_price,
      sale_price: product?.sale_price,
      selected_variant: firstVariant ? {
        id: firstVariant.id,
        original_price: firstVariant.original_price,
        base_price: firstVariant.base_price,
        regular_price: firstVariant.regular_price,
        list_price: firstVariant.list_price,
        compare_at_price: firstVariant.compare_at_price,
        compare_base_price: firstVariant.compare_base_price,
        custom_compare_price: firstVariant.custom_compare_price,
        selling_price: firstVariant.selling_price,
        sale_price: firstVariant.sale_price,
      } : null,
    };
    console.log("[storefront-product-price-payload]", productPricePayload);
    // The interactive product page must not wait for OG image generation or
    // merchant-policy lookups. Those can download and resize a remote image and
    // are only needed by the dedicated share/SEO rendering flow.
    res.set("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
    res.set("Vary", "X-Tenant-Id");
    res.json({ success: true, product, price_debug: productPricePayload });
  } catch (error) {
    console.error("[storefront] product", error);
    res.status(500).json({ success: false, message: "Failed to load product" });
  }
};

export const getProductByToken = async (req, res) => {
  try {
    await ensureStorefrontSchema();
    await ensureProductVariantImagesSchema();
    const tenantId = tenantFromRequest(req);
    const rawToken = toText(req.params.token || "");
    const token = rawToken.includes("/") ? rawToken.split("/").filter(Boolean).pop() : rawToken;
    if (!token) return res.status(404).json({ success: false, message: "Product not found" });
    const identifiers = productIdentifierCandidates(token);
    console.log("[storefront] product by token lookup", { identifier: token, identifiers, tenant_id: tenantId, filters: productLookupFilters });

    const queryByTenant = (scopeTenantId) =>
      db.query(
        buildCatalogQuery({
          where: productIdentifierClause("$2"),
          trailing: `GROUP BY p.id, c.name, b.name, m.name ${productIdentifierOrder("$2")} LIMIT 1`,
        }),
        [scopeTenantId, identifiers]
      );

    let result = await queryByTenant(tenantId);
    if (!result.rows[0] && tenantId !== null) result = await queryByTenant(null);
    if (!result.rows[0]) {
      console.warn("[storefront] product by token not found", {
        identifier: token,
        identifiers,
        tenant_id: tenantId,
        checked_fields: productLookupFields,
        filters: productLookupFilters,
      });
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    console.log("[storefront] product by token matched", { identifier: token, matched_product_id: result.rows[0].id });
    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    const [product] = await scrubInactiveClassifications(await hydrateProductsWithImages([normalizeProduct(result.rows[0], pricingSettings)]));
    res.json({ success: true, product: await attachSocialMetadata(product, req) });
  } catch (error) {
    console.error("[storefront] product by token", error);
    res.status(500).json({ success: false, message: "Failed to load product" });
  }
};

export const searchProducts = listProducts;

const resolveCustomer = async (client, tenantId, checkout = {}, customerColumns = null, runQuery = queryWithContext) => {
  void customerColumns;
  void runQuery;
  return resolveOrCreateCustomerAccount(client, {
    tenantId,
    customerId: checkout.customer_id || checkout.customerId || null,
    name: toText(checkout.full_name || checkout.customer_name || "Online Customer"),
    phone: checkout.primary_phone || checkout.customer_phone || checkout.phone || "",
    email: checkout.email || checkout.customer_email || "",
    address: checkout.detailed_address || checkout.address || "",
  });
};

const isDamiettaGovernorate = (value = "") => {
  const text = toText(value).toLowerCase();
  return text.includes("دمياط") || text.includes("damietta") || text.includes("دمياط");
};

const canUseCod = () => true;

export const getShippingQuote = async (req, res) => {
  try {
    const quote = await resolveStorefrontShippingQuote({
      governorate: req.query?.governorate || req.query?.province || "",
      city: req.query?.city || req.query?.markaz || req.query?.city_area || "",
      area: req.query?.area || req.query?.district || req.query?.city_area || "",
      governorate_id: req.query?.governorate_id || "",
      city_id: req.query?.city_id || "",
      area_id: req.query?.area_id || req.query?.district_id || req.query?.location_id || "",
      district_id: req.query?.district_id || req.query?.area_id || req.query?.location_id || "",
      zone_id: req.query?.zone_id || "",
      subtotal: req.query?.subtotal || req.query?.order_subtotal || req.query?.order_total || 0,
    });
    return res.json({ success: true, quote });
  } catch (error) {
    console.error("[storefront] shipping quote", {
      requestId: req.id,
      message: error?.message || String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to resolve shipping price" });
  }
};

/**
 * Open a Paymob hosted-checkout session for an already-committed order.
 *
 * Runs outside the checkout transaction on purpose: the order insert holds row
 * locks on the variants it just decremented, and parking those behind a call to
 * Paymob would turn every slow gateway response into stock-lock contention.
 * The cost is that a failure here leaves a real order in "pending_payment" with
 * no session — recoverable, because the caller can start a fresh session for
 * that order without touching stock again.
 */
const startPaymobCheckoutSession = async ({ order, tenantId, items = [], checkout = {}, customer = null }) => {
  const amountCents = Math.round(Number(order?.total_amount ?? order?.total ?? 0) * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    const error = new Error("Order total is not payable");
    error.status = 400;
    throw error;
  }
  const trackToken = order?.public_token || "";
  const intention = await createPaymentIntention({
    tenantId,
    orderId: order.id,
    amountCents,
    items,
    billing: {
      full_name: checkout.full_name || order.customer_name,
      email: checkout.email || customer?.email || order.customer_email,
      phone: order.customer_phone || checkout.primary_phone,
      street: checkout.street_address || checkout.detailed_address,
      building: checkout.building_number,
      floor: checkout.floor_number,
      apartment: checkout.apartment_number,
      city: checkout.city_area || checkout.city,
      state: checkout.governorate,
      country: "EG",
    },
    // Paymob appends its own result params to this URL. The storefront reads
    // the token to look the order up rather than trusting those params.
    redirectionUrl: trackToken
      ? `${paymobOnlineConfig().storefrontUrl}/shop/confirm/${encodeURIComponent(trackToken)}`
      : undefined,
  });

  const client = await db.connect();
  try {
    await ensurePaymentTransactionsSchema(client);
    await client.query(
      `
      INSERT INTO payment_transactions
        (tenant_id, order_id, provider, provider_order_id, amount_cents, currency, status, request_payload, response_payload)
      VALUES ($1, $2, 'paymob', NULLIF($3, ''), $4, $5, 'sent', $6::jsonb, $7::jsonb)
      `,
      [
        tenantId,
        order.id,
        intention.providerOrderId || "",
        amountCents,
        paymobOnlineConfig().currency,
        JSON.stringify({ ...intention.requestPayload, channel: "storefront" }),
        JSON.stringify({ intention_id: intention.intentionId, special_reference: intention.specialReference }),
      ]
    );
  } finally {
    client.release();
  }

  return {
    checkout_url: intention.checkoutUrl,
    special_reference: intention.specialReference,
    provider: "paymob",
  };
};

const loadOrderByPublicToken = async (token) => {
  const value = toText(token);
  if (!value) return null;
  const result = await db.query(
    `SELECT * FROM orders WHERE public_token = $1 LIMIT 1`,
    [value]
  );
  return result.rows[0] || null;
};

const publicPaymentView = (order = {}) => {
  const total = Number(order.total_amount ?? order.total ?? order.total_price ?? 0);
  const paid = Number(order.paid_amount || 0);
  return {
    order_id: order.id,
    public_order_number: order.public_order_number || order.invoice_number || "",
    payment_status: order.payment_status || "unpaid",
    payment_method: order.payment_method || "",
    status: normalizeOrderLifecycleStatus(order.status),
    total,
    paid_amount: paid,
    // Denormalized column is the authority elsewhere in the app, so prefer it
    // over recomputing total - paid here.
    remaining_amount: Number(order.remaining_amount ?? Math.max(0, total - paid)),
    is_paid: String(order.payment_status || "").toLowerCase() === "paid",
  };
};

/**
 * Payment state for one order, addressed by its unguessable public token.
 *
 * The storefront polls this after Paymob redirects the customer back, because
 * the redirect carries Paymob's own result params and those are attacker
 * controllable — the webhook is the only thing that may mark an order paid.
 */
export const getStorefrontPaymentStatus = async (req, res) => {
  try {
    const order = await loadOrderByPublicToken(req.params?.token);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    return res.json({ success: true, payment: publicPaymentView(order) });
  } catch (error) {
    console.error("[storefront] payment status", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "Failed to load payment status" });
  }
};

/**
 * Mint a fresh Paymob session for an order that is still awaiting payment —
 * the customer closed the hosted page, or the session creation failed at
 * checkout time. Stock was already reserved when the order was created, so
 * this never touches inventory.
 */
export const restartStorefrontPaymentSession = async (req, res) => {
  try {
    const order = await loadOrderByPublicToken(req.params?.token);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (String(order.payment_status || "").toLowerCase() === "paid") {
      return res.status(409).json({ success: false, message: "Order is already paid", payment: publicPaymentView(order) });
    }
    if (!GATEWAY_PAYMENT_METHODS.has(String(order.payment_method || "").toLowerCase())) {
      return res.status(400).json({ success: false, message: "Order is not an online card payment" });
    }
    if (!isPaymobOnlineReady()) {
      return res.status(503).json({ success: false, message: "Online card payment is unavailable right now" });
    }
    const itemsResult = await db.query(
      `SELECT product_name, variant_name, sku, quantity, sale_price AS price FROM order_items WHERE order_id = $1`,
      [order.id]
    );
    const session = await startPaymobCheckoutSession({
      order,
      tenantId: order.tenant_id,
      items: itemsResult.rows || [],
      checkout: {
        full_name: order.customer_name,
        email: order.customer_email,
        primary_phone: order.customer_phone,
        street_address: order.street_address,
        building_number: order.building_number,
        floor_number: order.floor_number,
        apartment_number: order.apartment_number,
        city_area: order.city_area,
        governorate: order.governorate,
      },
    });
    return res.json({ success: true, payment: { ...session, status: "ready" } });
  } catch (error) {
    console.error("[storefront] restart payment session", {
      token: toText(req.params?.token).slice(0, 6),
      status: error?.status || null,
      message: error?.message || String(error),
    });
    return res.status(error?.status && error.status < 500 ? error.status : 502).json({
      success: false,
      message: "Failed to start the payment session",
    });
  }
};

export const createWebsiteOrder = async (req, res) => {
  const client = await db.connect();
  let checkoutStep = "start";
  let checkoutQueryContext = {};
  let receivedPayload = null;
  const markCheckoutStep = (step, details = {}) => {
    checkoutStep = step;
    checkoutQueryContext = { step, ...details };
    logCheckoutStep(step, details);
  };
  const runCheckoutQuery = (queryClient, query, params = [], context = {}) =>
    queryWithContext(queryClient, query, params, { ...checkoutQueryContext, step: checkoutStep, ...context });
  try {
    // The POS online-invoice mode reaches this controller through an authenticated route,
    // so the till session — not a client-supplied header — decides which tenant it writes to.
    const posOnlineOrder = Boolean(req?.posOnlineOrder);
    const sessionTenantId = Number(req?.tenantId);
    const tenantId = posOnlineOrder && Number.isFinite(sessionTenantId) && sessionTenantId > 0
      ? sessionTenantId
      : tenantFromRequest(req);
    await ensureStorefrontSchema(client);
    const checkoutRaw = parseJsonField(req.body?.checkout, req.body || {});
    const items = parseJsonField(req.body?.items, Array.isArray(req.body?.items) ? req.body.items : []);
    const checkout = {
      ...checkoutRaw,
      full_name: toText(checkoutRaw.full_name || checkoutRaw.customer_name || checkoutRaw.name),
      primary_phone: toText(checkoutRaw.primary_phone || checkoutRaw.customer_phone || checkoutRaw.phone),
      email: toText(checkoutRaw.email || checkoutRaw.customer_email).toLowerCase(),
      governorate: toText(checkoutRaw.governorate || checkoutRaw.province),
      city_area: toText(checkoutRaw.city_area || checkoutRaw.city || checkoutRaw.area),
      governorate_id: toText(checkoutRaw.governorate_id || checkoutRaw.governorateId),
      city_id: toText(checkoutRaw.city_id || checkoutRaw.cityId),
      area_id: toText(checkoutRaw.area_id || checkoutRaw.areaId || checkoutRaw.district_id || checkoutRaw.districtId || checkoutRaw.location_id || checkoutRaw.locationId),
      district_id: toText(checkoutRaw.district_id || checkoutRaw.districtId || checkoutRaw.area_id || checkoutRaw.areaId || checkoutRaw.location_id || checkoutRaw.locationId),
      zone_id: toText(checkoutRaw.zone_id || checkoutRaw.zoneId),
      shipping_city_id: toText(checkoutRaw.shipping_city_id || checkoutRaw.shippingCityId || checkoutRaw.city_id || checkoutRaw.cityId),
      shipping_zone_id: toText(checkoutRaw.shipping_zone_id || checkoutRaw.shippingZoneId || checkoutRaw.zone_id || checkoutRaw.zoneId),
      shipping_district_id: toText(checkoutRaw.shipping_district_id || checkoutRaw.shippingDistrictId || checkoutRaw.district_id || checkoutRaw.districtId || checkoutRaw.area_id || checkoutRaw.areaId),
      city: toText(checkoutRaw.city),
      area: toText(checkoutRaw.area || checkoutRaw.district),
      detailed_address: toText(checkoutRaw.detailed_address || checkoutRaw.customer_address || checkoutRaw.address),
      street_address: toText(checkoutRaw.street_address || checkoutRaw.streetAddress || checkoutRaw.shipping_address?.street_address || checkoutRaw.shipping_provider_address?.street_address || checkoutRaw.detailed_address || checkoutRaw.customer_address || checkoutRaw.address),
      building_number: toText(checkoutRaw.building_number || checkoutRaw.buildingNumber || checkoutRaw.shipping_address?.building_number || checkoutRaw.shipping_address?.buildingNumber || checkoutRaw.shipping_provider_address?.building_number || checkoutRaw.shipping_provider_address?.buildingNumber),
      floor_number: toText(checkoutRaw.floor_number || checkoutRaw.floorNumber || checkoutRaw.floor || checkoutRaw.shipping_address?.floor_number || checkoutRaw.shipping_address?.floorNumber || checkoutRaw.shipping_address?.floor || checkoutRaw.shipping_provider_address?.floor_number || checkoutRaw.shipping_provider_address?.floorNumber || checkoutRaw.shipping_provider_address?.floor),
      apartment_number: toText(checkoutRaw.apartment_number || checkoutRaw.apartmentNumber || checkoutRaw.apartment || checkoutRaw.shipping_address?.apartment_number || checkoutRaw.shipping_address?.apartmentNumber || checkoutRaw.shipping_address?.apartment || checkoutRaw.shipping_provider_address?.apartment_number || checkoutRaw.shipping_provider_address?.apartmentNumber || checkoutRaw.shipping_provider_address?.apartment),
      payment_method: toText(checkoutRaw.payment_method || checkoutRaw.payment_type || "shipping_confirmation"),
      payment_type: toText(checkoutRaw.payment_type || checkoutRaw.payment_method || "shipping_confirmation"),
      shipping_method: toText(checkoutRaw.shipping_method || checkoutRaw.shipping_provider),
      shipping_provider: toText(checkoutRaw.shipping_provider || checkoutRaw.shipping_method),
      shipping_payment_method: toText(checkoutRaw.shipping_payment_method || req.body?.shipping_payment_method),
    };
    // Branch, cashier and seller are unknowable to a public checkout, so they are only ever
    // read off the authenticated till session — never off the body, which a shopper controls.
    // The seller is the one exception: it is a choice the cashier makes on screen, so it
    // arrives in the payload, bounded to numeric ids.
    const staffAttribution = posOnlineOrder ? buildPosStaffAttribution(req, checkoutRaw) : null;
    receivedPayload = {
      tenant_id: tenantId,
      checkout: { ...checkout, email: checkout.email ? "[redacted]" : "" },
      rawCheckout: {
        ...checkoutRaw,
        ...(checkoutRaw.email !== undefined ? { email: checkoutRaw.email ? "[redacted]" : "" } : {}),
        ...(checkoutRaw.customer_email !== undefined ? { customer_email: checkoutRaw.customer_email ? "[redacted]" : "" } : {}),
      },
      items: Array.isArray(items)
        ? items.map((item) => ({
            product_id: item?.product_id || item?.productId || null,
            variant_id: item?.variant_id || item?.variantId || null,
            quantity: item?.quantity || null,
            price: item?.price || null,
            lineId: item?.lineId || null,
          }))
        : items,
      delivery_fee: req.body?.delivery_fee ?? checkout.delivery_fee ?? null,
      discount: req.body?.discount ?? checkout.discount ?? null,
      proof: req.file
        ? { fieldname: req.file.fieldname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size }
        : null,
      bodyKeys: Object.keys(req.body || {}),
    };
    const checkoutValidationResponse = async (status, message, field, details = {}) => {
      console.warn("[storefront-checkout-validation]", {
        status,
        message,
        field,
        details,
        receivedPayload,
      });
      return res.status(status).json({
        success: false,
        message,
        field,
        details,
        receivedPayload,
      });
    };
    if (!items.length) {
      return checkoutValidationResponse(400, "Cart is empty", "items", { reason: "empty_cart" });
    }
    if (!toText(checkout.full_name) || !toText(checkout.primary_phone) || !toText(checkout.governorate) || !toText(checkout.city_area) || !toText(checkout.detailed_address)) {
      const missingFields = ["full_name", "primary_phone", "governorate", "city_area", "detailed_address"].filter((field) => !toText(checkout[field]));
      return checkoutValidationResponse(400, "Name, phone, governorate, city and address are required", missingFields[0] || null, { missing_fields: missingFields });
    }
    if (checkout.email && !isValidCustomerReviewEmail(checkout.email)) {
      return checkoutValidationResponse(400, "Enter a valid email address or leave it empty", "email", { reason: "invalid_email" });
    }

    await client.query("BEGIN");
    await ensureWhatsappOrderConfirmationSchema(client);
    const checkoutColumns = {
      customers: await tableColumns(client, "customers"),
      orders: await tableColumns(client, "orders"),
      orderItems: await tableColumns(client, "order_items"),
      products: await tableColumns(client, "products"),
      variants: await tableColumns(client, "product_variants"),
      notifications: await tableColumns(client, "website_notifications"),
    };
    markCheckoutStep("schema-columns", {
      customersTenant: checkoutColumns.customers.has("tenant_id"),
      ordersTenant: checkoutColumns.orders.has("tenant_id"),
      orderItemsTenant: checkoutColumns.orderItems.has("tenant_id"),
      variantsTenant: checkoutColumns.variants.has("tenant_id"),
    });

    markCheckoutStep("upsert customer", { table: "customers", phone: checkout.primary_phone });
    const customer = await resolveCustomer(client, tenantId, checkout, checkoutColumns.customers, runCheckoutQuery);
    markCheckoutStep("upsert customer:done", { table: "customers", customerId: customer?.id });
    const pricingSettings = await loadStorefrontPricingSettings(tenantId);
    // The canonical price tiers (manual override, purchase-invoice price) are optional columns; fall back to
    // NULL rather than break checkout on a database that predates them.
    const productPricingColumnSql = (column) => (checkoutColumns.products.has(column) ? `p.${column}` : "NULL");
    let subtotal = 0;
    const normalizedItems = [];
    const lockedItems = [];

    for (const item of items) {
      const variantId = Number(item.variant_id || item.variantId || 0);
      const quantity = Math.max(1, Number(item.quantity || 1));
      if (!variantId) throw checkoutValidationError("Select an available size and color", "items.variant_id", { item });
      const variantTenantClause = checkoutColumns.variants.has("tenant_id")
        ? "AND ($2::bigint IS NULL OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)"
        : "";
      const productTenantClause = checkoutColumns.products.has("tenant_id")
        ? "AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)"
        : "";
      markCheckoutStep("decrement stock:lock variant", { table: "product_variants", variantId, quantity, variantTenantScoped: checkoutColumns.variants.has("tenant_id") });
      const variantResult = await runCheckoutQuery(
        client,
        `
        SELECT
          pv.*,
          p.name AS product_name,
          COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS product_image,
          COALESCE(NULLIF(pv.image_url, ''), NULLIF(pv.image, ''), NULLIF(pv.photo_url, ''), NULLIF(pv.thumbnail_url, ''), '') AS variant_image,
          p.category_id AS product_category_id,
          p.brand_id AS product_brand_id,
          p.cost_price AS product_cost_price,
          COALESCE(NULLIF(p.regular_price, 0), p.price, 0) AS product_regular_price,
          COALESCE(NULLIF(p.selling_price, 0), p.price, 0) AS product_selling_price,
          ${productPricingColumnSql("manual_price_override_active")} AS product_manual_price_override_active,
          ${productPricingColumnSql("manual_selling_price")} AS product_manual_selling_price,
          ${productPricingColumnSql("purchase_selling_price")} AS product_purchase_selling_price,
          p.sale_price AS product_sale_price,
          p.sale_price_enabled AS product_sale_price_enabled,
          p.sale_start_at AS product_sale_start_at,
          p.sale_end_at AS product_sale_end_at,
          -- Curated-offer membership decides the charged price here exactly as it does on the product card;
          -- without it checkout would bill the normal price for a product the storefront advertised on sale.
          COALESCE(p.is_offer_story, FALSE) AS product_is_offer_story
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.id = $1
          AND pv.is_active IS DISTINCT FROM FALSE
          AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
          AND pv.deleted_at IS NULL
          ${variantTenantClause}
          ${productTenantClause}
        FOR UPDATE
        `,
        [variantId, tenantId],
        { table: "product_variants", operation: "select variant for update" }
      );
      const variant = variantResult.rows[0];
      if (!variant) throw checkoutValidationError("Selected variant is unavailable", "items.variant_id", { variant_id: variantId });
      if (Number(variant.stock || 0) < quantity) {
        throw checkoutValidationError(`Only ${variant.stock || 0} left from ${variant.product_name}`, "items.quantity", {
          variant_id: variantId,
          requested_quantity: quantity,
          available_stock: Number(variant.stock || 0),
          product_name: variant.product_name,
        });
      }
      lockedItems.push({ variant, quantity });
      markCheckoutStep("decrement stock:lock variant:done", { table: "product_variants", variantId, productId: variant.product_id, stockBefore: variant.stock });
    }

    // Price the cart through the same catalog projection the product cards render from, so what the customer
    // is charged cannot disagree with what the shelf advertised. The locking SELECT above reads only the
    // legacy price columns, but for a large part of the catalogue the sole normal price is a manual override
    // or a purchase-invoice price (see resolveCurrentSellingPrice) — those carts resolved to 0 and were
    // rejected as "no valid selling price". Runs on the checkout client so the transaction keeps one
    // connection. The per-row resolution below is the fallback for a product the projection cannot see.
    const shelfPricedProducts = await queryProductsByIds(
      tenantId,
      [...new Set(lockedItems.map(({ variant }) => Number(variant.product_id)).filter(Boolean))],
      pricingSettings,
      client
    );
    const shelfPriceByVariantId = new Map();
    for (const shelfProduct of shelfPricedProducts) {
      for (const shelfVariant of shelfProduct.variants || []) {
        const shelfPrice = roundMoney(shelfVariant.final_price || shelfVariant.price || shelfVariant.selling_price);
        if (shelfPrice > 0) shelfPriceByVariantId.set(String(shelfVariant.id), shelfPrice);
      }
    }

    for (const { variant, quantity } of lockedItems) {
      const originalPrice = roundMoney(variant.product_regular_price);
      // The canonical normal-price ladder: manual override, then the purchase-invoice price, then the legacy
      // columns — variant before product. Reading only selling_price/price here is what produced the 400.
      const sellingPrice = roundMoney(
        resolveCurrentSellingPrice({
          product: {
            manual_price_override_active: variant.product_manual_price_override_active,
            manual_selling_price: variant.product_manual_selling_price,
            purchase_selling_price: variant.product_purchase_selling_price,
            selling_price: variant.product_selling_price,
          },
          variant,
        }).value
      );
      const resolvedPrice = resolveStorefrontActivePrice({
        originalPrice,
        sellingPrice,
        salePrice: variant.sale_price || variant.product_sale_price,
        pricingSettings,
        forcedOffer: isForcedOfferSale({ is_offer_story: variant.product_is_offer_story }) || isForcedOfferSale(variant),
      });
      const price = shelfPriceByVariantId.get(String(variant.id)) || resolvedPrice.activePrice;
      if (price <= 0) {
        throw checkoutValidationError("This product does not have a valid selling price", "items.price", {
          product_id: variant.product_id,
          variant_id: variant.id,
        });
      }
      subtotal += price * quantity;
      normalizedItems.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        product_name: variant.product_name,
        variant_name: [variant.color, variant.size].filter(Boolean).join(" / "),
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        color: variant.color || "",
        size: variant.size || "",
        image_url: variant.variant_image || variant.product_image || "",
        product_image: variant.product_image || "",
        variant_image: variant.variant_image || "",
        price,
        quantity,
      });
    }

    const orderSettings = await getStorefrontOrderSettings();
    const shippingQuote = await resolveStorefrontShippingQuote({
      governorate: checkout.governorate,
      city: checkout.city || checkout.city_area,
      area: checkout.area || checkout.city_area || "",
      governorate_id: checkout.governorate_id,
      city_id: checkout.city_id,
      area_id: checkout.area_id,
      district_id: checkout.district_id,
      zone_id: checkout.zone_id,
      subtotal,
    });
    const deliveryFee = roundMoney(shippingQuote.price);
    const manualDiscount = Math.max(0, toNumber(req.body?.discount || checkout.discount, 0));
    const couponCode = toText(checkout.coupon_code || checkout.coupon || req.body?.coupon_code || req.body?.coupon || "").trim().toUpperCase();
    // Coupon base = goods only; shipping is folded in by validateCoupon only when the campaign opts in.
    const couponBaseTotal = Math.max(0, subtotal - manualDiscount);
    let couponValidation = null;
    let couponDiscountAmount = 0;
    if (couponCode) {
      couponValidation = await validateCoupon({
        tenantId,
        code: couponCode,
        orderTotal: couponBaseTotal,
        shippingAmount: deliveryFee,
        items: normalizedItems,
        appliedDiscounts: { invoice: manualDiscount },
        source: "website",
        customerId: customer?.id || null,
        client,
      });
      if (!couponValidation.valid) {
        await client.query("ROLLBACK");
        return checkoutValidationResponse(400, couponValidation.reason || "Invalid coupon", "coupon_code", {
          coupon_code: couponCode,
          coupon: couponValidation,
        });
      }
      couponDiscountAmount = Math.max(0, Number(couponValidation.discount_amount || 0));
    }
    const discount = Math.max(0, manualDiscount + couponDiscountAmount);
    const total = Math.max(0, subtotal - discount + deliveryFee);
    const requestedShippingPaymentMethod = toText(checkout.shipping_payment_method || req.body?.shipping_payment_method || "").toLowerCase();
    const requestedPaymentMethod = toText(checkout.payment_method || checkout.payment_type || "shipping_confirmation").toLowerCase();
    const requestedPaymentType = toText(checkout.payment_type || checkout.payment_method || "shipping_confirmation").toLowerCase();
    const supportedPaymentMethods = new Set(["cod", "cash", "shipping_confirmation", "instapay", "vodafone_cash", "electronic", "online", "transfer", ...GATEWAY_PAYMENT_METHODS]);
    if (![requestedPaymentMethod, requestedPaymentType].some((value) => supportedPaymentMethods.has(value))) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(400, "Unsupported payment method", "payment_method", { payment_method: requestedPaymentMethod, payment_type: requestedPaymentType });
    }
    // A gateway request has to be caught before the manual-transfer ladder
    // below, which funnels anything it does not recognise into "instapay".
    const isGatewayCheckout = [requestedPaymentMethod, requestedPaymentType].some((value) => GATEWAY_PAYMENT_METHODS.has(value));
    if (isGatewayCheckout && !isPaymobOnlineReady()) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(503, "Online card payment is unavailable right now", "payment_method", { payment_method: requestedPaymentMethod });
    }
    const paymentMethod = isGatewayCheckout
      ? "card"
      : requestedPaymentMethod === "cod" || requestedPaymentMethod === "cash"
        ? "cod"
        : requestedPaymentMethod === "instapay" || requestedPaymentMethod === "vodafone_cash"
          ? requestedPaymentMethod
          : requestedPaymentType === "instapay" || requestedPaymentType === "vodafone_cash"
            ? requestedPaymentType
            : requestedShippingPaymentMethod === "vodafone_cash"
              ? "vodafone_cash"
              : "instapay";
    const paymentType = paymentMethod;
    // Only manual transfers carry a shipping payment method — it is the field
    // the proof-review screens key off, and a gateway order has no proof.
    const shippingPaymentMethod = paymentMethod === "cod" || isGatewayCheckout ? "" : paymentMethod;
    const zoneShippingProviderId = normalizeShippingProviderKey(shippingQuote.provider_id || shippingQuote.provider || orderSettings.defaultShippingProvider);
    const requestedShippingMethod = normalizeShippingProviderKey(checkout.shipping_method || checkout.shipping_provider || zoneShippingProviderId);
    const shippingMethod = shippingProviders[requestedShippingMethod] ? requestedShippingMethod : zoneShippingProviderId;
    if (!shippingProviders[shippingMethod]) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(400, "Unsupported shipping method", "shipping_method", { shipping_method: shippingMethod });
    }
    if (shippingMethod === "bosta") {
      const missingBostaAddressFields = [];
      if (!toText(checkout.street_address)) missingBostaAddressFields.push("street_address");
      if (!toText(checkout.building_number)) missingBostaAddressFields.push("building_number");
      if (missingBostaAddressFields.length) {
        await client.query("ROLLBACK");
        return checkoutValidationResponse(400, "Street address and building number are required for Bosta delivery", missingBostaAddressFields[0], { missing_fields: missingBostaAddressFields });
      }
    }
    if (shippingMethod === "store_pickup" && !orderSettings.allowStorePickup) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(403, "Store pickup is disabled", "shipping_method", { shipping_method: shippingMethod });
    }
    const requestedDeliveryFee = roundMoney(toNumber(checkout.delivery_fee, toNumber(req.body?.delivery_fee, deliveryFee)));
    if (requestedDeliveryFee !== deliveryFee) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(409, "Shipping fee changed. Review the checkout total and try again.", "delivery_fee", {
        requested_delivery_fee: requestedDeliveryFee,
        delivery_fee: deliveryFee,
        shipping_quote: shippingQuote,
      });
    }
    const requestedPaidAmount = toNumber(checkout.paid_amount, 0);
    // A gateway order is not paid yet at this point — the money only exists
    // once Paymob's webhook lands, so it starts at zero like a COD order.
    const expectedPaidAmount = paymentMethod === "cod" || isGatewayCheckout ? 0 : total;
    if (roundMoney(requestedPaidAmount) !== roundMoney(expectedPaidAmount)) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(400, "Paid amount must equal the order total for electronic payments", "paid_amount", {
        paid_amount: requestedPaidAmount,
        expected_paid_amount: expectedPaidAmount,
        total,
      });
    }
    const shippingPaymentFile = req.file || null;
    if (paymentMethod === "cod" && !orderSettings.allowCod) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(403, "Cash on delivery is disabled", "payment_method", { payment_method: paymentMethod });
    }

    // Manual transfers are proven by a screenshot a human reviews. A gateway
    // payment is proven by the webhook, so demanding a screenshot here would
    // block the one method we can actually verify.
    if (paymentMethod !== "cod" && !isGatewayCheckout && shippingQuote.requires_shipping_proof !== false && !shippingPaymentFile) {
      await client.query("ROLLBACK");
      return checkoutValidationResponse(400, "Upload a valid transfer proof image", "shipping_payment_screenshot", { payment_method: paymentMethod });
    }
    if (shippingPaymentFile && !isValidShippingProofFile(shippingPaymentFile)) {
      await removeUploadedFile(shippingPaymentFile.path);
      await client.query("ROLLBACK");
      return checkoutValidationResponse(400, "Upload a valid transfer proof image", "shipping_payment_screenshot", { mimetype: shippingPaymentFile.mimetype, size: shippingPaymentFile.size });
    }
    const paidAmount = paymentMethod === "cod" || isGatewayCheckout ? 0 : total;
    const remainingAmount = Math.max(0, total - paidAmount);
    const paymentStatus = paymentMethod === "cod" || isGatewayCheckout ? "unpaid" : remainingAmount > 0 ? "partially_paid" : "paid";
    // "pending_payment" is an established alias that normalizes to "pending",
    // so it stays readable everywhere while keeping the raw value distinct from
    // a COD order that is merely waiting on a human to confirm it.
    const orderStatus = isGatewayCheckout
      ? "pending_payment"
      : paymentMethod === "cod"
        ? "pending_confirmation"
        : orderSettings.autoConfirmWebsiteOrders
          ? "confirmed"
          : orderSettings.defaultWebsiteStatus;
    const transferProofStatus = paymentMethod === "cod" || isGatewayCheckout ? null : "pending";
    const codAmount = paymentMethod === "cod" ? total : 0;
    const token = publicToken();
    const invoiceNumber = buildTemporaryInvoiceNumber();
    const shippingAddressLine = [
      checkout.street_address || checkout.detailed_address,
      checkout.building_number ? `Building ${checkout.building_number}` : "",
      checkout.floor_number ? `Floor ${checkout.floor_number}` : "",
      checkout.apartment_number ? `Apartment ${checkout.apartment_number}` : "",
      checkout.landmark ? `Near ${checkout.landmark}` : "",
    ].filter(Boolean).join(", ");
    markCheckoutStep("create order", { table: "orders", invoiceNumber, total, orderTenantScoped: checkoutColumns.orders.has("tenant_id") });
    let order = await insertReturning(client, "orders", {
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      public_token: token,
      invoice_public_enabled: true,
      customer_id: customer?.id || null,
      customer_name: checkout.full_name,
      customer_phone: customer?.phone || normalizePhone(checkout.primary_phone),
      customer_email: checkout.email || customer?.email || "",
      channel: "storefront",
      source: "website",
      customer_type: "online",
      status: orderStatus,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      payment_type: paymentMethod,
      shipping_method: shippingMethod,
      shipping_payment_method: shippingPaymentMethod,
      transfer_proof_status: transferProofStatus,
      subtotal,
      discount_amount: discount,
      delivery_fee: deliveryFee,
      shipping_fee: deliveryFee,
      shipping_cost: deliveryFee,
      service_fee: deliveryFee,
      total_amount: total,
      total_price: total,
      total,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      cod_amount: codAmount,
      shipping_payment_screenshot: shippingPaymentFile ? `/uploads/payment-proofs/${shippingPaymentFile.filename}` : "",
      shipping_payment_reference: toText(checkout.shipping_payment_reference),
      coupon_id: couponValidation?.coupon?.id || null,
      coupon_code: couponCode || "",
      coupon_discount_amount: couponDiscountAmount,
      customer_address: checkout.detailed_address || shippingAddressLine,
      governorate: checkout.governorate,
      city_area: checkout.city_area,
      governorate_id: checkout.governorate_id,
      city_id: checkout.city_id,
      area_id: checkout.area_id,
      district_id: checkout.district_id,
      zone_id: checkout.zone_id,
      landmark: checkout.landmark || "",
      street_address: checkout.street_address || checkout.detailed_address || "",
      building_number: checkout.building_number || "",
      floor_number: checkout.floor_number || "",
      apartment_number: checkout.apartment_number || "",
      delivery_notes: checkout.delivery_notes || "",
      order_notes: checkout.order_notes || "",
      notes: checkout.order_notes || "",
      shipping_provider: shippingMethod,
      shipping_provider_id: shippingMethod,
      shipping_city_id: checkout.shipping_city_id || checkout.city_id || shippingQuote.zone?.city_id || null,
      shipping_zone_id: checkout.shipping_zone_id || checkout.zone_id || shippingQuote.zone?.zone_id || shippingQuote.zone?.id || null,
      shipping_district_id: checkout.shipping_district_id || checkout.district_id || checkout.area_id || shippingQuote.zone?.district_id || null,
      shipping_address_line: shippingAddressLine || checkout.detailed_address,
      shipping_status: "pending",
      shipment_status: "pending",
      // Null for a real web order; insertReturning drops keys the table does not have, so a
      // database that predates origin_surface still takes the insert.
      ...(staffAttribution || {}),
    }, checkoutColumns.orders, { step: "create order" });
    order = await assignSequentialInvoiceNumber(client, order);
    order = attachPublicOrderNumber(order);
    markCheckoutStep("create order:done", { table: "orders", orderId: order?.id, invoiceNumber: order?.invoice_number, publicOrderNumber: order?.public_order_number });

    if (couponCode) {
      const couponRedemption = await redeemCoupon({
        tenantId,
        code: couponCode,
        orderId: order.id,
        customerId: customer?.id || null,
        source: "website",
        orderTotal: couponBaseTotal,
        shippingAmount: deliveryFee,
        items: normalizedItems,
        appliedDiscounts: { invoice: manualDiscount },
        client,
      });
      order.coupon_id = couponRedemption?.coupon?.id || order.coupon_id || null;
      order.coupon_code = couponRedemption?.coupon?.code || order.coupon_code || couponCode;
      order.coupon_discount_amount = Number(couponRedemption?.discount_amount || couponDiscountAmount || 0);
      order.discount_amount = Math.max(0, Number(order.discount_amount || 0));
      order.total_amount = total;
      order.total_price = total;
      order.total = total;
    }

    const lowStockProductIds = new Set();
    for (const item of normalizedItems) {
      markCheckoutStep("create order items", { table: "order_items", orderId: order.id, variantId: item.variant_id });
      const query = buildOrderItemInsertQuery({
        tenant_id: tenantId,
        order_id: order.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        sale_price: item.price,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: item.price * item.quantity,
        image_url: item.image_url,
        product_image: item.product_image,
        variant_image: item.variant_image,
        size: item.size,
        color: item.color,
      }, {
        availableColumns: checkoutColumns.orderItems,
        returning: true,
        filePath: "server/controllers/storefrontController.js",
        routeName: "storefrontCheckout",
        insertLabel: "storefrontCreateOrderItems",
        sqlSnippetLabel: "storefront_order_items_insert",
      });
      try {
        await client.query(query.sql, query.params);
      } catch (error) {
        throw enrichOrderItemsInsertError(error, {
          routeName: "storefrontCheckout",
          insertLabel: "storefrontCreateOrderItems",
          columnsCount: query.columns.length,
          paramsCount: query.params.length,
          sqlSnippetLabel: "storefront_order_items_insert",
        });
      }
      markCheckoutStep("create order items:done", { table: "order_items", orderId: order.id, variantId: item.variant_id });
      markCheckoutStep("decrement stock", { table: "product_variants", orderId: order.id, variantId: item.variant_id, quantity: item.quantity });
      await adjustVariantStock(client, {
        tenantId: checkoutColumns.variants.has("tenant_id") ? tenantId : null,
        variantId: item.variant_id,
        quantityChange: item.quantity * -1,
        movementType: "SALE_OUT",
        referenceType: "order",
        referenceId: order.id,
        reason: "Website order",
        notes: `Website order #${order.public_order_number || order.invoice_number}`,
      });
      lowStockProductIds.add(item.product_id);
      markCheckoutStep("create inventory movement:done", { table: "inventory_movements", orderId: order.id, variantId: item.variant_id });
      markCheckoutStep("decrement stock:done", { table: "product_variants", orderId: order.id, variantId: item.variant_id });
    }

    const lowStockEvents = [];
    for (const productId of lowStockProductIds) {
      const snapshot = await getProductLowStockSnapshot(client, { productId, tenantId });
      const totalStock = Number(snapshot?.total_stock || 0);
      if (totalStock >= 1 && totalStock <= LOW_STOCK_LIMIT) {
        lowStockEvents.push(snapshot);
      }
    }

    if (checkoutColumns.notifications.has("type") && checkoutColumns.notifications.has("title")) {
      markCheckoutStep("create payment/shipping records if used", { table: "website_notifications", orderId: order.id });
      await insertReturning(client, "website_notifications", {
        tenant_id: tenantId,
        customer_id: customer?.id || null,
        phone: customer?.phone || normalizePhone(checkout.primary_phone),
        type: "order_confirmed",
        title: "تم تأكيد طلبك",
        body: "طلبك دخل مرحلة التجهيز الآن",
        metadata: JSON.stringify({ order_id: order.id, invoice_number: order.invoice_number, public_order_number: order.public_order_number }),
      }, checkoutColumns.notifications, { step: "create payment/shipping records if used" });
      markCheckoutStep("create payment/shipping records if used:done", { table: "website_notifications", orderId: order.id });
    }
    await client.query("SAVEPOINT storefront_order_email_outbox");
    try {
      await enqueueOrderCreatedEmails(client, {
        tenantId,
        orderId: order.id,
        customerEmail: checkout.email || customer?.email || "",
      });
      await client.query("RELEASE SAVEPOINT storefront_order_email_outbox");
    } catch (emailQueueError) {
      await client.query("ROLLBACK TO SAVEPOINT storefront_order_email_outbox");
      console.warn("[order-email] outbox enqueue skipped", {
        orderId: order?.id,
        message: emailQueueError?.message || String(emailQueueError),
      });
    }
    await client.query("COMMIT");
    invalidateStorefrontTenantCache(tenantId);
    sendManagerInvoiceCreatedPush({
      order: {
        ...order,
        tenant_id: tenantId,
        branch_id: order.branch_id || null,
        customer_name: checkout.full_name,
        total_amount: total,
      },
      source: "storefront",
    }).catch((error) => console.warn("[manager-push:invoice-created] storefront skipped", {
      orderId: order?.id,
      message: error?.message || String(error),
    }));
    if (customer?.id) {
      issueFirstOrderCoupons({ tenantId, customerId: customer.id, orderId: order.id }).catch((error) => {
        console.warn("[coupons] first-order auto-issue skipped", { orderId: order?.id, message: error?.message || String(error) });
      });
    }
    sendOrderConfirmation({ ...order, items: normalizedItems }).catch((error) => {
      console.warn("[whatsapp:order-confirmation-send-skipped]", {
        orderId: order?.id,
        status: order?.status,
        source: order?.source || order?.channel,
        message: error?.message || String(error),
      });
    });
    sendPaymentReviewNotification({ ...order, items: normalizedItems }).catch((error) => {
      console.warn("[whatsapp:payment-review-notification-skipped]", {
        orderId: order?.id,
        status: order?.status,
        source: order?.source || order?.channel,
        message: error?.message || String(error),
      });
    });
    sendInvoiceWhatsapp({ ...order, items: normalizedItems }).catch((error) => {
      console.warn("[whatsapp:invoice-send-skipped]", {
        orderId: order?.id,
        status: order?.status,
        source: order?.source || order?.channel,
        message: error?.message || String(error),
      });
    });
    createSystemNotification("website_order_created", {
      tenant_id: tenantId,
      message: `طلب جديد ${order.public_order_number || order.invoice_number || order.id} من ${checkout.full_name}`,
      action_url: `/orders/${order.id}`,
      entity_type: "order",
      entity_id: order.id,
      metadata: { order_id: order.id, invoice_number: order.invoice_number, public_order_number: order.public_order_number, channel: "website" },
      customer_notification_ready: true,
    }).catch((error) => console.warn("[notifications] website order skipped", error?.message || error));
    if (shippingPaymentFile) {
      createSystemNotification("payment_proof_uploaded", {
        tenant_id: tenantId,
        message: `طلب ${order.public_order_number || order.invoice_number || order.id} يحتوي على صورة تحويل تحتاج مراجعة`,
        action_url: `/orders/${order.id}`,
        entity_type: "order",
        entity_id: order.id,
        metadata: { order_id: order.id, invoice_number: order.invoice_number, public_order_number: order.public_order_number, proof: order.shipping_payment_screenshot },
        customer_notification_ready: true,
      }).catch((error) => console.warn("[notifications] payment proof skipped", error?.message || error));
    }
    lowStockEvents.forEach((item) => {
      const stock = Number(item.total_stock || 0);
      const productName = item.product_name || "Product";
      createSystemNotification("low_stock", {
        tenant_id: tenantId,
        priority: stock === 1 ? "critical" : "high",
        title: "آخر قطع متاحة",
        message: lowStockMessage(productName, stock),
        action_url: `/inventory?productId=${encodeURIComponent(String(item.product_id || ""))}`,
        entity_type: "product",
        entity_id: item.product_id,
        metadata: { product_id: item.product_id, stock, image_url: item.image_url || "", badge: "عاجل", source: "website_order" },
      }).catch((error) => console.warn("[notifications] low stock skipped", error?.message || error));
    });
    const customerReviews = await createStorefrontCustomerReviewData({
      order,
      email: checkout.email || customer?.email || "",
      items: normalizedItems,
      shippingQuote,
    }).catch(() => null);
    // The order is committed either way. If Paymob cannot hand us a session the
    // customer still has a real order sitting in pending_payment, so report the
    // failure inline instead of 500-ing and leaving them with no order id.
    let paymentSession = null;
    let paymentSessionError = "";
    if (isGatewayCheckout) {
      try {
        paymentSession = await startPaymobCheckoutSession({
          order,
          tenantId,
          items: normalizedItems,
          checkout,
          customer,
        });
      } catch (error) {
        paymentSessionError = error?.message || String(error);
        console.error("[paymob-online-session-failed]", {
          order_id: order?.id,
          public_order_number: order?.public_order_number,
          status: error?.status || null,
          message: paymentSessionError,
        });
      }
    }
    res.status(201).json({
      success: true,
      order: withPaymentProofAliases(order),
      items: normalizedItems,
      track_token: token,
      ...(isGatewayCheckout
        ? { payment: paymentSession ? { ...paymentSession, status: "ready" } : { status: "failed", message: paymentSessionError } }
        : {}),
      ...(customerReviews ? { customer_reviews: customerReviews } : {}),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (req.file?.path) {
      await removeUploadedFile(req.file.path);
    }
    console.error("[storefront-order-confirm] error:", {
      step: error?.checkoutDbContext?.step || checkoutStep,
      table: error?.checkoutDbContext?.table || checkoutQueryContext.table || null,
      operation: error?.checkoutDbContext?.operation || null,
      query: error?.checkoutDbContext?.query || null,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      field: error?.field || null,
      details: error?.details || null,
      receivedPayload,
      stack: error?.stack,
    });
    const status = Number(error?.status || error?.statusCode || 400);
    const message = error?.expose
      ? error.message
      : "Checkout failed while confirming the order. Try again or contact us on WhatsApp.";
    res.status(status >= 400 && status < 500 ? status : 400).json({
      success: false,
      message,
      field: error?.field || null,
      details: error?.details || {
        step: error?.checkoutDbContext?.step || checkoutStep,
        table: error?.checkoutDbContext?.table || checkoutQueryContext.table || null,
        code: error?.code || null,
        detail: error?.detail || null,
        routeName: error.routeName,
        insertLabel: error.insertLabel,
        columnsCount: error.columnsCount,
        paramsCount: error.paramsCount,
        sqlSnippetLabel: error.sqlSnippetLabel,
      },
      receivedPayload,
    });
  } finally {
    client.release();
  }
};

// The till raises a website order through this wrapper rather than POST /storefront/checkout:
// the flag is what unlocks branch/cashier/seller attribution, and it can only be set behind
// authentication — a shopper hitting the public checkout can never turn it on.
export const createPosOnlineOrder = async (req, res) => {
  req.posOnlineOrder = true;
  return createWebsiteOrder(req, res);
};

const loadPublicOrder = async ({ tenantId, orderNumber: number, phone }) => {
  const lookupNumber = toText(number);
  const shortWebsiteMatch = lookupNumber.match(/^WEB-(\d{2,})$/i);
  const legacyWebsiteSuffix = shortWebsiteMatch ? shortWebsiteMatch[1] : "";
  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND (
        invoice_number = $2
        OR public_order_number = $2
        OR display_order_number = $2
        OR id::text = $2
        OR $2 = ('WEB-' || id::text)
        OR public_token = $2
        OR ($4 <> '' AND invoice_number LIKE ('WEB-%-' || $4))
      )
      AND ($3 = '' OR customer_phone = $3)
    LIMIT 1
    `,
    [tenantId, lookupNumber, toText(phone), legacyWebsiteSuffix]
  );
  const order = result.rows[0];
  if (!order) return null;
  const publicOrder = attachPublicOrderNumber(order);
  const items = await db.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [order.id]);
  return { order: publicOrder, items: items.rows };
};

export const trackOrder = async (req, res) => {
  res.type("application/json; charset=utf-8");
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const orderNumberValue = req.query.order_number || req.body?.order_number || req.params.orderNumber;
    const phone = req.query.phone || req.body?.phone || "";
    const loaded = await loadPublicOrder({ tenantId, orderNumber: orderNumberValue, phone });
    if (!loaded) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true, ...loaded, timeline: buildOrderTimeline(loaded.order) });
  } catch (error) {
    console.error("[storefront] track", error);
    res.status(500).json({ success: false, message: "Failed to track order" });
  }
};

// The courier's own vocabulary, in the order a parcel actually travels. Bosta's webhook writes
// these onto shipment_status/shipping_status (BOSTA_STATE_CODES maps its numeric states onto
// them), so reaching any stage implies every earlier one — a parcel cannot be out for delivery
// without having been created. Ranking beats per-stage lists: those listed "created" while the
// webhook writes "shipment_created", and never listed out_for_delivery at all, so two of the six
// stages could never light up from a real Bosta callback.
const SHIPPING_STAGE_RANK = {
  pending: 0,
  ready_to_ship: 1,
  shipment_created: 2,
  created: 2,
  picked_up: 3,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
};

const ORDER_STAGE_RANK = {
  pending: 0,
  pending_confirmation: 0,
  edit_requested: 0,
  confirmed: 1,
  ready_to_ship: 2,
  shipment_created: 3,
  shipped: 3,
  out_for_delivery: 4,
  delivered: 5,
};

// Order stage 1 == confirmed, shipping stage 1 == ready_to_ship, so the two scales are compared
// against the timeline's own indexes rather than each other.
const TIMELINE_STAGES = [
  { key: "received", label: "تم استلام الطلب", order: 0, shipping: 0 },
  { key: "confirmed", label: "تم تأكيد الطلب", order: 1, shipping: 1 },
  { key: "ready_to_ship", label: "جاهز للشحن", order: 2, shipping: 1 },
  { key: "shipment_created", label: "تم إنشاء الشحنة", order: 3, shipping: 2 },
  { key: "out_for_delivery", label: "خرج للتسليم", order: 4, shipping: 4 },
  { key: "delivered", label: "تم التسليم", order: 5, shipping: 5 },
];

const buildOrderTimeline = (order = {}) => {
  const status = normalizeOrderLifecycleStatus(order.status || "", "pending");
  const shipping = normalizeShippingLifecycleStatus(order.shipment_status || order.shipping_status || "", "pending");
  const orderRank = ORDER_STAGE_RANK[status] ?? 0;
  const shippingRank = SHIPPING_STAGE_RANK[shipping] ?? 0;
  // A cancelled or returned parcel is not "further along"; it leaves the happy path, and the
  // stages it never reached must not light up because the order ended somewhere else.
  const derailed = ["cancelled", "cancelled_by_customer", "returned", "failed_delivery"].includes(status)
    || ["cancelled", "returned", "failed_delivery"].includes(shipping);
  return TIMELINE_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    done: stage.key === "received" || (!derailed && (orderRank >= stage.order || shippingRank >= stage.shipping)),
  }));
};

export const accountByPhone = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    await ensureLoyaltySchema(db);
    const tenantId = Number(req.storefrontCustomer?.tenant_id || tenantFromRequest(req));
    const jwtPhone = normalizePhone(toText(req.storefrontCustomer?.phone || ""));
    const fallbackPhone = normalizePhone(toText(req.query.phone || req.body?.phone || req.params.phone));
    const phone = jwtPhone || fallbackPhone;
    console.info("[storefront-account] auth-phone-source", {
      source: jwtPhone ? "jwt" : fallbackPhone ? "request" : "missing",
      hasPhone: Boolean(phone),
      phone_suffix: phone ? phone.slice(-4) : "",
    });
    if (!jwtPhone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    if (!phone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const phoneVariants = getPhoneSearchVariants(phone);
    const customer = await db.query(
      `
      SELECT *
      FROM customers
      WHERE tenant_id = $1
        AND ${phoneSqlDigits("phone")} = ANY($2::text[])
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [tenantId, phoneVariants]
    );
    const customerId = customer.rows[0]?.id || null;
    const orders = await db.query(
      `
      SELECT *
      FROM orders
      WHERE tenant_id = $1
        AND (
          ($3::bigint IS NOT NULL AND customer_id = $3::bigint)
          OR ${phoneSqlDigits("customer_phone")} = ANY($2::text[])
        )
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [tenantId, phoneVariants, customerId]
    );
    const accountPricingSettings = await loadStorefrontPricingSettings(tenantId);
    const accountSaleModeEnabled = saleModeEnabled(accountPricingSettings);
    const wishlist = await db.query(
      `
      SELECT
        p.id,
        p.name,
        b.name AS brand,
        b.name AS brand_name,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS image_url,
        COALESCE(NULLIF(p.selling_price, 0), display_variant.selling_price, NULLIF(p.price, 0), NULLIF(p.regular_price, 0), 0) AS price,
        COALESCE(NULLIF(p.selling_price, 0), display_variant.selling_price, NULLIF(p.price, 0), NULLIF(p.regular_price, 0), 0) AS selling_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS original_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS regular_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS compare_at_price,
        COALESCE(NULLIF(p.sale_price, 0), display_variant.sale_price, 0) AS sale_price,
        $3::boolean AS sale_prices_enabled,
        $3::boolean AS global_sale_enabled,
        $3::boolean AS sale_mode_enabled,
        cw.created_at
      FROM customer_wishlist cw
      JOIN products p ON p.id = cw.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), NULLIF(pv.regular_price, 0)) AS selling_price,
          COALESCE(NULLIF(pv.regular_price, 0), NULLIF(pv.price, 0)) AS compare_price,
          NULLIF(pv.sale_price, 0) AS sale_price
        FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.deleted_at IS NULL AND pv.is_active IS NOT FALSE AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
        ORDER BY (COALESCE(pv.stock, 0) > 0) DESC, pv.color_sort_order ASC, pv.id ASC
        LIMIT 1
      ) display_variant ON TRUE
      WHERE cw.tenant_id = $1 AND cw.phone = $2
      ORDER BY cw.created_at DESC
      LIMIT 50
      `,
      [tenantId, phone, accountSaleModeEnabled]
    );
    const recent = await db.query(
      `
      SELECT DISTINCT ON (rv.product_id)
        p.id,
        p.name,
        b.name AS brand,
        b.name AS brand_name,
        COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, '')) AS image_url,
        COALESCE(NULLIF(p.selling_price, 0), display_variant.selling_price, NULLIF(p.price, 0), NULLIF(p.regular_price, 0), 0) AS price,
        COALESCE(NULLIF(p.selling_price, 0), display_variant.selling_price, NULLIF(p.price, 0), NULLIF(p.regular_price, 0), 0) AS selling_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS original_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS regular_price,
        COALESCE(NULLIF(p.custom_compare_price, 0), display_variant.compare_price, NULLIF(p.regular_price, 0), 0) AS compare_at_price,
        COALESCE(NULLIF(p.sale_price, 0), display_variant.sale_price, 0) AS sale_price,
        $3::boolean AS sale_prices_enabled,
        $3::boolean AS global_sale_enabled,
        $3::boolean AS sale_mode_enabled,
        rv.viewed_at
      FROM recently_viewed_products rv
      JOIN products p ON p.id = rv.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), NULLIF(pv.regular_price, 0)) AS selling_price,
          COALESCE(NULLIF(pv.regular_price, 0), NULLIF(pv.price, 0)) AS compare_price,
          NULLIF(pv.sale_price, 0) AS sale_price
        FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.deleted_at IS NULL AND pv.is_active IS NOT FALSE AND COALESCE(pv.is_storefront_visible, TRUE) = TRUE
        ORDER BY (COALESCE(pv.stock, 0) > 0) DESC, pv.color_sort_order ASC, pv.id ASC
        LIMIT 1
      ) display_variant ON TRUE
      WHERE rv.tenant_id = $1 AND rv.phone = $2
      ORDER BY rv.product_id, rv.viewed_at DESC
      LIMIT 20
      `,
      [tenantId, phone, accountSaleModeEnabled]
    );
    // The SELECTs above read the raw price columns, but for a large part of the catalogue the
    // only normal price lives on the purchase invoice (see resolveCurrentSellingPrice), so those
    // rows come back at 0. Re-hydrate them through the same catalog projection the storefront
    // grid uses, which also restores the variants/colours/sizes the cards render.
    const accountProductIds = [...new Set([...wishlist.rows, ...recent.rows].map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0))];
    const accountCatalog = new Map(
      (await queryProductsByIds(tenantId, accountProductIds, accountPricingSettings)).map((product) => [String(product.id), product])
    );
    const hydrateAccountProduct = (row = {}) => {
      const product = accountCatalog.get(String(row.id));
      if (!product) return row;
      return { ...row, ...product, created_at: row.created_at ?? product.created_at, viewed_at: row.viewed_at ?? product.viewed_at };
    };
    const loyalty = customerId ? await getCustomerLoyaltySummary(db, customerId, tenantId) : null;
    const addresses = [
      ...new Set(
        orders.rows
          .map((order) => [order.governorate, order.city_area, order.customer_address].filter(Boolean).join(" - "))
          .filter(Boolean)
      ),
    ].slice(0, 6);
    res.json({
      success: true,
      customer: customer.rows[0] || null,
      preferences: normalizePreferredSizes(customer.rows[0]?.preferred_sizes || defaultPreferredSizes()),
      orders: orders.rows.map(attachPublicOrderNumber),
      loyalty,
      addresses,
      wishlist: wishlist.rows.map((row) => ({ product_id: row.id })),
      wishlist_products: wishlist.rows.map(hydrateAccountProduct),
      recent_products: recent.rows
        .sort((a, b) => new Date(b.viewed_at || 0) - new Date(a.viewed_at || 0))
        .map(hydrateAccountProduct),
    });
  } catch (error) {
    console.error("[storefront-account] failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      hasStorefrontCustomer: Boolean(req.storefrontCustomer),
      hasJwtPhone: Boolean(req.storefrontCustomer?.phone),
      tenantId: Number(req.storefrontCustomer?.tenant_id || req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID),
    });
    res.status(500).json({ success: false, message: "Failed to load account" });
  }
};

export const getStorefrontCustomerPreferences = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = Number(req.storefrontCustomer?.tenant_id || tenantFromRequest(req));
    const phone = normalizePhone(toText(req.storefrontCustomer?.phone || ""));
    if (!phone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const customer = await findStorefrontCustomerByPhone(db, { tenantId, phone });
    return res.json({
      success: true,
      preferences: normalizePreferredSizes(customer?.preferred_sizes || defaultPreferredSizes()),
    });
  } catch (error) {
    console.error("[storefront-preferences] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      hasStorefrontCustomer: Boolean(req.storefrontCustomer),
      hasJwtPhone: Boolean(req.storefrontCustomer?.phone),
      tenantId: Number(req.storefrontCustomer?.tenant_id || req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID),
    });
    return res.status(500).json({ success: false, message: "Failed to load customer preferences" });
  }
};

export const updateStorefrontCustomerPreferences = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = Number(req.storefrontCustomer?.tenant_id || tenantFromRequest(req));
    const phone = normalizePhone(toText(req.storefrontCustomer?.phone || ""));
    if (!phone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const customer = await findStorefrontCustomerByPhone(db, { tenantId, phone });
    const currentSizes = normalizePreferredSizes(customer?.preferred_sizes || defaultPreferredSizes());
    const incomingSizes = normalizePreferredSizes(req.body?.preferred_sizes || req.body || {});
    const preferredSizes = mergePreferredSizes(currentSizes, incomingSizes);
    if (customer?.id) {
      await db.query(
        `
        UPDATE customers
        SET preferred_sizes = $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1
          AND id = $2
        `,
        [tenantId, customer.id, JSON.stringify(preferredSizes)]
      );
    } else {
      await db.query(
        `
        INSERT INTO customers (
          tenant_id,
          name,
          phone,
          status,
          registration_source,
          created_at,
          updated_at,
          first_visit_at,
          last_visit_at,
          storefront_last_seen_at,
          is_storefront_customer,
          loyalty_points,
          loyalty_tier,
          wallet_balance,
          total_spent,
          total_orders,
          preferred_sizes
        )
        VALUES (
          $1,
          $2,
          $3,
          'active',
          'storefront',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          TRUE,
          0,
          'Bronze',
          0,
          0,
          0,
          $4::jsonb
        )
        `,
        [tenantId, "Storefront Customer", phone, JSON.stringify(preferredSizes)]
      );
    }
    return res.json({ success: true, preferences: preferredSizes });
  } catch (error) {
    console.error("[storefront-preferences] save failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      hasStorefrontCustomer: Boolean(req.storefrontCustomer),
      hasJwtPhone: Boolean(req.storefrontCustomer?.phone),
      tenantId: Number(req.storefrontCustomer?.tenant_id || req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID),
    });
    return res.status(500).json({ success: false, message: "Failed to save customer preferences" });
  }
};

export const getStorefrontCustomerCart = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = Number(req.storefrontCustomer?.tenant_id || tenantFromRequest(req));
    const phone = getStorefrontCartPhone(req);
    if (!phone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const cart = await loadStorefrontCustomerCart(tenantId, phone);
    return res.json({ success: true, cart });
  } catch (error) {
    console.error("[storefront-cart] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      hasStorefrontCustomer: Boolean(req.storefrontCustomer),
      hasJwtPhone: Boolean(req.storefrontCustomer?.phone),
      tenantId: Number(req.storefrontCustomer?.tenant_id || req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID),
    });
    return res.status(500).json({ success: false, message: "Failed to load customer cart" });
  }
};

export const updateStorefrontCustomerCart = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = Number(req.storefrontCustomer?.tenant_id || tenantFromRequest(req));
    const phone = getStorefrontCartPhone(req);
    if (!phone) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const customer = await findStorefrontCustomerByPhone(db, { tenantId, phone });
    const cart = normalizeStorefrontCartItems(req.body?.cart || req.body?.items || req.body?.cart_items || req.body || []);
    const saved = await saveStorefrontCustomerCart({
      tenantId,
      phone,
      customerId: customer?.id || null,
      cart,
    });
    return res.json({ success: true, cart: normalizeStorefrontCartItems(saved?.cart || cart) });
  } catch (error) {
    console.error("[storefront-cart] save failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
      hasStorefrontCustomer: Boolean(req.storefrontCustomer),
      hasJwtPhone: Boolean(req.storefrontCustomer?.phone),
      tenantId: Number(req.storefrontCustomer?.tenant_id || req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.body?.tenant_id || DEFAULT_TENANT_ID),
    });
    return res.status(500).json({ success: false, message: "Failed to save customer cart" });
  }
};

export const latestShippingAddress = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = toText(req.query.phone || req.query.primary_phone || "");
    const email = toText(req.query.email || req.query.customer_email || "").toLowerCase();
    const phoneVariants = getPhoneSearchVariants(phone);
    const fallbackEmail = phoneVariants.length ? "" : email;
    if (!phoneVariants.length && !fallbackEmail) {
      return res.json({ success: true, address: null });
    }

    const customerValues = [tenantId, phoneVariants, fallbackEmail || null];
    const customerResult = await db.query(
      `
      SELECT id
      FROM customers
      WHERE tenant_id = $1
        AND (
          (cardinality($2::text[]) > 0 AND ${phoneSqlDigits("phone")} = ANY($2::text[]))
          OR ($3::text IS NOT NULL AND LOWER(COALESCE(email, '')) = $3::text)
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 20
      `,
      customerValues
    );
    const customerIds = customerResult.rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0);

    const orderResult = await db.query(
      `
      SELECT
      o.governorate,
      o.governorate_id,
      o.city_area,
      o.city_id,
      o.area_id,
      o.zone_id,
      o.district_id,
      o.customer_address AS detailed_address,
      o.street_address,
      o.building_number,
      o.floor_number,
      o.apartment_number,
      o.landmark,
      o.delivery_notes,
      o.customer_name,
      o.customer_phone,
      o.shipping_city_id,
      o.shipping_zone_id,
      o.shipping_district_id,
      o.created_at
      FROM orders o
      WHERE o.tenant_id = $1
        AND (
          (cardinality($2::bigint[]) > 0 AND o.customer_id = ANY($2::bigint[]))
          OR (cardinality($3::text[]) > 0 AND ${phoneSqlDigits("o.customer_phone")} = ANY($3::text[]))
        )
        AND (
          NULLIF(TRIM(COALESCE(o.governorate, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(o.city_area, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(o.customer_address, '')), '') IS NOT NULL
        )
      ORDER BY o.created_at DESC NULLS LAST, o.id DESC
      LIMIT 1
      `,
      [tenantId, customerIds, phoneVariants]
    );
    const row = orderResult.rows[0] || null;
    if (!row) return res.json({ success: true, address: null });

    return res.json({
      success: true,
      address: {
        governorate: row.governorate || "",
        province: row.governorate || "",
        governorate_id: row.governorate_id || "",
        city_area: row.city_area || "",
        city: row.city_area || "",
        area: row.city_area || "",
        city_id: row.city_id || "",
        area_id: row.area_id || "",
        zone_id: row.zone_id || "",
        district_id: row.district_id || "",
        detailed_address: row.detailed_address || "",
        address: row.detailed_address || "",
        street_address: row.street_address || "",
        building_number: row.building_number || "",
        floor_number: row.floor_number || "",
        apartment_number: row.apartment_number || "",
        landmark: row.landmark || "",
        delivery_notes: row.delivery_notes || "",
        customer_name: row.customer_name || "",
        phone: row.customer_phone || "",
        shipping_city_id: row.shipping_city_id || "",
        shipping_zone_id: row.shipping_zone_id || "",
        shipping_district_id: row.shipping_district_id || "",
        created_at: row.created_at || null,
      },
    });
  } catch (error) {
    console.error("[storefront] latest shipping address", error);
    return res.status(500).json({ success: false, message: "Failed to load latest shipping address" });
  }
};

const defaultPreferredSizes = () => ({
  men: "",
  women: "",
  kids: "",
  crocs: "",
});

const normalizePreferredSizes = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const text = (input = "") => String(input ?? "").trim();
  return {
    men: text(source.men || source.male || source["رجالي"] || source.man || source.men_size || source.size_men || ""),
    women: text(source.women || source.female || source["حريمي"] || source.women_size || source.size_women || ""),
    kids: text(source.kids || source.children || source["أطفال"] || source["اطفال"] || source.kids_size || source.size_kids || ""),
    crocs: text(source.crocs || source.crocs_size || source.size_crocs || ""),
  };
};

const mergePreferredSizes = (current = {}, patch = {}) => {
  const currentSizes = normalizePreferredSizes(current);
  const nextSizes = normalizePreferredSizes(patch);
  return {
    men: nextSizes.men || currentSizes.men || "",
    women: nextSizes.women || currentSizes.women || "",
    kids: nextSizes.kids || currentSizes.kids || "",
    crocs: nextSizes.crocs || currentSizes.crocs || "",
  };
};

const normalizeStorefrontCartItems = (value = []) => {
  const items = Array.isArray(value) ? value : Array.isArray(value?.cart) ? value.cart : Array.isArray(value?.items) ? value.items : Array.isArray(value?.cart_items) ? value.cart_items : [];
  return items
    .filter(Boolean)
    .map((item) => ({
      ...item,
      lineId: String(item?.lineId || item?.line_id || item?.id || `${item?.product_id || item?.productId || ""}:${item?.variant_id || item?.variantId || ""}:${item?.size || ""}:${item?.color || ""}`).trim(),
      product_id: item?.product_id || item?.productId || "",
      variant_id: item?.variant_id || item?.variantId || "",
      quantity: Math.max(1, Number(item?.quantity || 1)),
      price: Number(item?.price || item?.sale_price || 0),
      sale_price: Number(item?.sale_price || item?.price || 0),
      total_amount: Number(item?.total_amount || Number(item?.price || item?.sale_price || 0) * Math.max(1, Number(item?.quantity || 1))),
    }))
    .filter((item) => item.lineId);
};

const getStorefrontCartPhone = (req = {}) => normalizePhone(toText(req.storefrontCustomer?.phone || ""));

const loadStorefrontCustomerCart = async (tenantId, phone) => {
  const normalizedPhone = normalizePhone(toText(phone));
  if (!normalizedPhone) return [];
  const result = await db.query(
    `
    SELECT cart
    FROM storefront_customer_carts
    WHERE tenant_id = $1
      AND customer_phone = $2
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [tenantId, normalizedPhone]
  );
  return normalizeStorefrontCartItems(result.rows[0]?.cart || []);
};

const saveStorefrontCustomerCart = async ({ tenantId, phone, customerId = null, cart = [] }) => {
  const normalizedPhone = normalizePhone(toText(phone));
  const normalizedCart = normalizeStorefrontCartItems(cart);
  if (!normalizedPhone) return null;
  const payload = JSON.stringify(normalizedCart);
  const result = await db.query(
    `
    INSERT INTO storefront_customer_carts (
      tenant_id,
      customer_id,
      customer_phone,
      cart,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, customer_phone)
    DO UPDATE SET
      customer_id = COALESCE(EXCLUDED.customer_id, storefront_customer_carts.customer_id),
      cart = EXCLUDED.cart,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, tenant_id, customer_phone, customer_id, cart, updated_at
    `,
    [tenantId, customerId || null, normalizedPhone, payload]
  );
  return result.rows[0] || null;
};

const findStorefrontCustomerByPhone = async (client, { tenantId, phone = "" }) => {
  const normalizedPhone = normalizePhone(toText(phone));
  if (!normalizedPhone) return null;
  const variants = getPhoneSearchVariants(normalizedPhone);
  if (!variants.length) return null;
  const result = await client.query(
    `
    SELECT *
    FROM customers
    WHERE tenant_id = $1
      AND ${phoneSqlDigits("phone")} = ANY($2::text[])
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [tenantId, variants]
  );
  return result.rows[0] || null;
};

export const saveWishlist = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = normalizePhone(toText(req.storefrontCustomer?.phone || ""));
    const productId = Number(req.body.product_id);
    if (!phone || !productId) return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    const customer = await findStorefrontCustomerByPhone(db, { tenantId, phone });
    if (req.method === "DELETE" || req.body.remove) {
      await db.query(`DELETE FROM customer_wishlist WHERE tenant_id = $1 AND phone = $2 AND product_id = $3`, [tenantId, phone, productId]);
    } else {
      await db.query(
        `INSERT INTO customer_wishlist (tenant_id, customer_id, phone, product_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, phone, product_id) DO NOTHING`,
        [tenantId, customer?.id || null, phone, productId]
      );
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update wishlist" });
  }
};

export const saveRecentlyViewed = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const sessionId = toText(req.body.session_id);
    const phone = normalizePhone(toText(req.storefrontCustomer?.phone || ""));
    const productId = Number(req.body.product_id);
    if (!phone || !productId) return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    const customer = await findStorefrontCustomerByPhone(db, { tenantId, phone });
    await db.query(
      `DELETE FROM recently_viewed_products WHERE tenant_id = $1 AND product_id = $2 AND (($3 <> '' AND phone = $3) OR ($4 <> '' AND session_id = $4))`,
      [tenantId, productId, phone, sessionId]
    );
    await db.query(
      `INSERT INTO recently_viewed_products (tenant_id, customer_id, session_id, phone, product_id) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, customer?.id || null, sessionId, phone, productId]
    );
    await db.query(
      `
      DELETE FROM recently_viewed_products
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY tenant_id, COALESCE(NULLIF(phone, ''), session_id) ORDER BY viewed_at DESC) AS rn
          FROM recently_viewed_products
          WHERE tenant_id = $1 AND (($2 <> '' AND phone = $2) OR ($3 <> '' AND session_id = $3))
        ) ranked
        WHERE rn > 20
      )
      `,
      [tenantId, phone, sessionId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("[storefront] recently viewed", error);
    res.status(500).json({ success: false, message: "Failed to save recently viewed" });
  }
};

export const listNotifications = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const tenantId = tenantFromRequest(req);
    const phone = toText(req.query.phone);
    if (!phone) {
      return res.json({ success: true, notifications: [] });
    }
    const payload = await getOrSetCache(storefrontCacheKey(tenantId, "notifications", { phone }), 15, async () => {
      const result = await db.query(
        `SELECT * FROM website_notifications WHERE tenant_id = $1 AND ($2 = '' OR phone = $2) ORDER BY created_at DESC LIMIT 30`,
        [tenantId, phone]
      );
      return { success: true, notifications: result.rows };
    });
    res.json(payload);
  } catch {
    res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
};

export const listShippingProviders = async (_req, res) => {
  res.json({
    success: true,
    providers: shippingProviderCatalog.map((provider) => ({
      key: provider.key,
      id: provider.key,
      name: provider.name,
      configured: provider.isConfigured(),
    })),
  });
};

export const createShipment = async (req, res) => {
  try {
    await ensureStorefrontSchema(db);
    const orderResult = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [req.params.orderId]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.shipment_id || order.tracking_number) {
      const status = normalizeShippingLifecycleStatus(order.shipment_status || order.shipping_status || "created", "created");
      return res.status(409).json({
        success: false,
        message: "Shipment already exists for this order",
        provider: order.shipping_provider || "in_store_delivery",
        provider_id: order.shipping_provider_id || order.shipping_provider || "in_store_delivery",
        status,
        shipping_status: status,
        shipment_id: order.shipment_id || null,
        tracking_number: order.tracking_number || "",
        tracking_url: order.tracking_url || "",
      });
    }
    const provider = getShippingProvider(req.body.provider || req.body.provider_id || order.shipping_provider_id || order.shipping_provider || "in_store_delivery");
    const result = await provider.createShipment(order);
    if (result.success) {
      const nextShippingStatus = normalizeShippingLifecycleStatus(result.status || result.shipping_status || "created", "created");
      const updated = await db.query(
        `
        UPDATE orders
        SET shipping_provider = $1,
            shipping_provider_id = $2,
            shipping_status = $3,
            shipment_status = $3,
            shipment_id = $4,
            tracking_number = $5,
            tracking_url = $6,
            last_shipping_sync_at = NOW(),
            shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', $3, 'action', 'create', 'provider', $1, 'at', NOW()))
        WHERE id = $7
        RETURNING *
        `,
        [result.provider, result.provider_id || result.provider, nextShippingStatus, result.shipment_id, result.tracking_number, result.tracking_url, order.id]
      );
      result.status = nextShippingStatus;
      result.shipping_status = nextShippingStatus;
      const updatedOrder = updated.rows[0];
      sendShipmentCreated(updatedOrder).catch((error) => {
        console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder?.id, status: nextShippingStatus, message: error?.message || String(error) });
      });
    }
    res.json(result);
  } catch {
    res.status(500).json({ success: false, message: "Failed to create shipment" });
  }
};
