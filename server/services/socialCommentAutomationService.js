import crypto from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { enqueueJob } from "./jobQueueService.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import { ensureAiChannelAdapterSchema } from "./aiChannelAdapterService.js";
import { upsertAiCustomerProfile } from "./aiSalesAgentService.js";
import { createOrUpdateLeadOpportunity } from "./aiInboxLeadActionsService.js";
import { appendAutomationSupportTranscript } from "./aiSupportLogService.js";
import { likeComment, replyToComment, sendPrivateReply } from "./marketingCommentAutomationService.js";
import { getSocialCommentAutomationConfig, loadSocialCommentPost, processSocialCommentAutoReply } from "./socialCommentsCenterService.js";
import { enqueueSocialCommentJob } from "./socialCommentJobQueue.js";
import { resolveMappedProductsV2, resolvePrimaryProductV2 } from "./socialPostProductLinksV2Service.js";
import { resolveStorefrontProductLink } from "./storefrontProductUrlService.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import {
  DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  getSocialAutomationSettings,
} from "./socialAutomationSettingsService.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const metadataObject = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsLog = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.log(...args);
};
let socialRealtimeEmittersPromise = null;
const getSocialRealtimeEmitters = async () => {
  if (!socialRealtimeEmittersPromise) {
    socialRealtimeEmittersPromise = import("./socialRealtimeService.js")
      .then((module) => ({
        emitSocialCommentNew: module.emitSocialCommentNew || (() => {}),
        emitSocialCommentUpdated: module.emitSocialCommentUpdated || (() => {}),
        emitSocialReplyStatus: module.emitSocialReplyStatus || (() => {}),
      }))
      .catch((error) => {
        if (isSocialCommentsDebugEnabled()) {
          console.warn("SOCIAL_REALTIME_IMPORT_FAILED", {
            message: error?.message || String(error || ""),
          });
        }
        return {
          emitSocialCommentNew: () => {},
          emitSocialCommentUpdated: () => {},
          emitSocialReplyStatus: () => {},
        };
      });
  }
  return socialRealtimeEmittersPromise;
};
const emitSocialCommentNew = (payload = {}) => { void getSocialRealtimeEmitters().then(({ emitSocialCommentNew: emit }) => emit(payload)); };
const emitSocialCommentUpdated = (payload = {}) => { void getSocialRealtimeEmitters().then(({ emitSocialCommentUpdated: emit }) => emit(payload)); };
const emitSocialReplyStatus = (payload = {}) => { void getSocialRealtimeEmitters().then(({ emitSocialReplyStatus: emit }) => emit(payload)); };
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
let fetchMetaPostPreviewDetailsLoaderPromise = null;

const normalizeAutomationRunDiagnostics = (value = {}) => {
  const resolvedProductId = Number(value.resolved_product_id ?? value.product_id ?? null);
  return {
    skipped_reason: text(value.skipped_reason || ""),
    matched_config_key: text(value.matched_config_key || ""),
    resolved_post_id: text(value.resolved_post_id || ""),
    resolved_platform_post_id: text(value.resolved_platform_post_id || ""),
    resolved_product_id: Number.isFinite(resolvedProductId) && resolvedProductId > 0 ? Math.trunc(resolvedProductId) : null,
    duplicate_reason: text(value.duplicate_reason || ""),
    config_found: Boolean(value.config_found),
    config_enabled: Boolean(value.config_enabled),
    raw_runtime_context:
      value.raw_runtime_context && typeof value.raw_runtime_context === "object" && !Array.isArray(value.raw_runtime_context)
        ? value.raw_runtime_context
        : {},
  };
};

const logAutomationSkipReason = (payload = {}) => {
  debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_SKIP_REASON", payload);
};

const buildRuntimeContextSnapshot = ({
  row = {},
  config = null,
  productContext = null,
  stepResults = [],
  summary = null,
  salesContext = null,
  aiSales = null,
} = {}) => ({
  row: {
    tenant_id: row.tenant_id ?? null,
    platform: text(row.platform || ""),
    channel: text(row.channel || ""),
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    commenter_name: text(row.commenter_name || row.customer_name || ""),
    original_comment_text: text(row.original_comment_text || ""),
  },
  config: config
    ? {
        id: config.id ?? null,
        post_id: text(config.post_id || ""),
        platform: text(config.platform || ""),
        template_key: text(config.template_key || ""),
        enabled: Boolean(config.enabled),
        persisted: Boolean(config.persisted),
        product_id: config.product_id ?? null,
      }
    : null,
  product: productContext
    ? {
        found: Boolean(productContext.found),
        product_id: productContext.product_id ?? null,
        product_name: text(productContext.product_name || ""),
        source: text(productContext.source || ""),
      }
    : null,
  sales_context: salesContext
    ? {
        product_name: text(salesContext.product_name || ""),
        brand: text(salesContext.brand || ""),
        price: text(salesContext.price || ""),
        stock_status: text(salesContext.stock_status || ""),
        product_url: text(salesContext.product_url || ""),
        sizes: asArray(salesContext.sizes || []),
        colors: asArray(salesContext.colors || []),
      }
    : null,
  ai_sales: aiSales
    ? {
        intent: text(aiSales.intent || ""),
        confidence: Number(aiSales.confidence || 0) || 0,
        public_reply: text(aiSales.public_reply || ""),
        private_reply: text(aiSales.private_reply || ""),
        approval_status: text(aiSales.approval_status || ""),
      }
    : null,
  summary: summary
    ? {
        status: text(summary.status || ""),
        errorMessage: text(summary.errorMessage || ""),
      }
    : null,
  step_results: asArray(stepResults),
});

const buildAutomationRunDiagnostics = ({
  row = {},
  config = null,
  productContext = null,
  skippedReason = "",
  duplicateReason = "",
  rawRuntimeContext = {},
} = {}) => {
  const resolvedPostId = text(config?.post_id || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const resolvedPlatformPostId = text(row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || config?.post_id || "");
  const resolvedProductId = Number(
    productContext?.product_id ??
    config?.product_id ??
    row.product_id ??
    row.resolved_product_id ??
    row.metadata?.product_id ??
    row.raw_payload?.product_id ??
    null
  );
  const rowRuntimeMonitor = row.automation_state?.runtime_monitor || {};
  return normalizeAutomationRunDiagnostics({
    skipped_reason: skippedReason,
    matched_config_key: text(config?.template_key || row.matched_config_key || rowRuntimeMonitor.matched_config_key || ""),
    resolved_post_id: resolvedPostId,
    resolved_platform_post_id: resolvedPlatformPostId,
    resolved_product_id: Number.isFinite(resolvedProductId) && resolvedProductId > 0 ? Math.trunc(resolvedProductId) : null,
    duplicate_reason: duplicateReason,
    config_found: Boolean(config?.persisted ?? row.config_found ?? rowRuntimeMonitor.config_found ?? false),
    config_enabled: Boolean(config?.enabled ?? row.config_enabled ?? rowRuntimeMonitor.config_enabled ?? false),
    raw_runtime_context: rawRuntimeContext || rowRuntimeMonitor.raw_runtime_context || {},
  });
};

const loadFetchMetaPostPreviewDetails = async () => {
  if (!fetchMetaPostPreviewDetailsLoaderPromise) {
    fetchMetaPostPreviewDetailsLoaderPromise = import("./metaIntegrationService.js").then((module) => module.fetchMetaPostPreviewDetails);
  }
  return fetchMetaPostPreviewDetailsLoaderPromise;
};
const confidenceFrom = (value, fallback = 0.9) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const COMBINING_MARKS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ZERO_WIDTH_RE = /[\u200c\u200d\ufeff]/g;
const NON_TEXT_RE = /[^\p{L}\p{N}\s]+/gu;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\s]+$/u;

const normalizeCommentText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(COMBINING_MARKS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(NON_TEXT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

const dedupeTextList = (value = []) =>
  asArray(value)
    .map((item) => text(item))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);

const firstNonEmptyText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const SALES_INTENT_RULES = [
  {
    intent: "price_question",
    confidence: 0.98,
    patterns: ["السعر", "بكام", "بكم", "كام", "price", "cost", "sa3r", "s3r", "bkam"],
  },
  {
    intent: "size_question",
    confidence: 0.97,
    patterns: ["مقاس", "مقاسات", "سايز", "size", "sizes", "fit"],
  },
  {
    intent: "availability_question",
    confidence: 0.96,
    patterns: ["متوفر", "موجود", "available", "availability", "stock", "in stock"],
  },
  {
    intent: "color_question",
    confidence: 0.95,
    patterns: ["لون", "الوان", "ألوان", "color", "colors", "colour"],
  },
  {
    intent: "product_link_request",
    confidence: 0.95,
    patterns: ["لينك", "رابط", "link", "url", "details", "تفاصيل"],
  },
  {
    intent: "delivery_shipping_question",
    confidence: 0.95,
    patterns: ["شحن", "توصيل", "shipping", "delivery", "ship"],
  },
  {
    intent: "order_intent",
    confidence: 0.96,
    patterns: ["احجز", "احجزلي", "أحجز", "اطلب", "اطلبه", "عايز", "عاوزه", "هاخده", "طلب", "order", "reserve", "buy"],
  },
];

const detectSocialCommentSalesIntent = ({ commentText = "" } = {}) => {
  const normalized = normalizeCommentText(commentText);
  if (!normalized || EMOJI_ONLY_RE.test(text(commentText))) {
    return { intent: "generic_interest", confidence: 0.62, matched_pattern: "", normalized_text: normalized };
  }
  for (const rule of SALES_INTENT_RULES) {
    const matchedPattern = rule.patterns.find((pattern) => {
      if (pattern instanceof RegExp) return pattern.test(commentText) || pattern.test(normalized);
      const candidate = normalizeCommentText(pattern);
      return candidate && normalized.includes(candidate);
    });
    if (matchedPattern) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        matched_pattern: text(matchedPattern),
        normalized_text: normalized,
      };
    }
  }
  return { intent: "generic_interest", confidence: 0.7, matched_pattern: "", normalized_text: normalized };
};

const buildSalesPriceLabel = (salesContext = {}) =>
  firstNonEmptyText(
    salesContext.price,
    salesContext.final_price,
    salesContext.sale_price,
    salesContext.selling_price
  );

const buildArabicListLabel = (values = []) => dedupeTextList(values).join("، ");

const buildStockLabel = (salesContext = {}) => {
  const stockStatus = lower(salesContext.stock_status || "");
  if (stockStatus === "out_of_stock") return "المنتج غير متوفر حالياً";
  if (stockStatus === "in_stock") return "المنتج متوفر";
  if (stockStatus) return text(salesContext.stock_status);
  const availableStock = Number(salesContext.available_stock ?? null);
  if (Number.isFinite(availableStock)) {
    return availableStock > 0 ? `متوفر حالياً (${availableStock})` : "المنتج غير متوفر حالياً";
  }
  return "";
};

const buildSocialCommentSalesContext = ({ row = {}, productContext = {}, websiteLinks = {}, templateContext = {} } = {}) => {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  const rawPayload = row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload) ? row.raw_payload : {};
  const productMetadata = productContext.metadata && typeof productContext.metadata === "object" && !Array.isArray(productContext.metadata) ? productContext.metadata : {};
  const sizes = dedupeTextList([
    ...(asArray(productContext.sizes || [])),
    ...(asArray(productContext.available_sizes || [])),
    ...(asArray(row.sizes || [])),
    ...(asArray(row.product_sizes || [])),
  ]);
  const colors = dedupeTextList([
    ...(asArray(productContext.colors || [])),
    ...(asArray(productContext.available_colors || [])),
    ...(asArray(row.colors || [])),
    ...(asArray(row.product_colors || [])),
    text(productContext.color || ""),
    text(row.product_color || row.color || ""),
  ]);
  return {
    found: Boolean(productContext?.found),
    product_id: productContext?.product_id ?? row.product_id ?? metadata.product_id ?? null,
    product_name: firstNonEmptyText(productContext.product_name, row.product_name, metadata.product_name, templateContext.product_name),
    brand: firstNonEmptyText(productContext.brand, row.product_brand, metadata.product_brand, productMetadata.brand),
    price: firstNonEmptyText(productContext.price, row.product_price, metadata.product_price, templateContext.price),
    final_price: firstNonEmptyText(productContext.final_price, row.final_price, metadata.final_price),
    sale_price: firstNonEmptyText(productContext.sale_price, row.product_sale_price, row.sale_price, metadata.product_sale_price),
    selling_price: firstNonEmptyText(productContext.selling_price, row.product_selling_price, metadata.product_selling_price),
    stock_status: firstNonEmptyText(productContext.stock_status, row.stock_status, metadata.stock_status, templateContext.stock_status),
    available_stock: productContext.available_stock ?? row.available_stock ?? metadata.available_stock ?? null,
    total_stock: productContext.total_stock ?? row.total_stock ?? metadata.total_stock ?? null,
    sizes,
    colors,
    product_url: firstNonEmptyText(websiteLinks.product_link, websiteLinks.product_url, productContext.product_url, row.product_url, metadata.product_url),
    storefront_url: firstNonEmptyText(websiteLinks.product_link, productContext.storefront_url, metadata.storefront_url),
    image_url: firstNonEmptyText(productContext.image_url, row.product_image_url, metadata.product_image_url, rawPayload.product_image_url),
    store_policy: firstNonEmptyText(metadata.store_policy, rawPayload.store_policy, productMetadata.store_policy),
    store_address: firstNonEmptyText(metadata.store_address, rawPayload.store_address, productMetadata.store_address),
    delivery_notes: firstNonEmptyText(metadata.delivery_notes, rawPayload.delivery_notes, metadata.shipping_notes, rawPayload.shipping_notes),
  };
};

const buildSocialCommentSalesReplies = ({
  salesContext = {},
  intent = "generic_interest",
  fallbackPublicReply = "",
  fallbackPrivateReply = "",
  customerName = "",
} = {}) => {
  const productName = text(salesContext.product_name || "");
  const brand = text(salesContext.brand || "");
  const priceLabel = buildSalesPriceLabel(salesContext);
  const sizesLabel = buildArabicListLabel(salesContext.sizes || []);
  const colorsLabel = buildArabicListLabel(salesContext.colors || []);
  const stockLabel = buildStockLabel(salesContext);
  const productLink = firstNonEmptyText(salesContext.product_url, salesContext.storefront_url);
  const deliveryLabel = firstNonEmptyText(salesContext.delivery_notes, salesContext.store_policy, salesContext.store_address);
  if (!productName && !priceLabel && !sizesLabel && !colorsLabel && !productLink) {
    return {
      public_reply: text(fallbackPublicReply || ""),
      private_reply: text(fallbackPrivateReply || ""),
      used_fallback: true,
    };
  }

  const publicParts = [];
  if (intent === "price_question" && priceLabel) {
    publicParts.push(`السعر ${priceLabel} يا فندم ✅`);
  } else if (intent === "size_question" && sizesLabel) {
    publicParts.push(`متوفر مقاسات ${sizesLabel} ✅`);
  } else if (intent === "availability_question" && stockLabel) {
    publicParts.push(`${stockLabel} ✅`);
  } else if (intent === "color_question" && colorsLabel) {
    publicParts.push(`متوفر ألوان ${colorsLabel} ✅`);
  } else if (intent === "product_link_request") {
    publicParts.push("ابعت لحضرتك التفاصيل في الخاص ✅");
  } else if (intent === "delivery_shipping_question" && deliveryLabel) {
    publicParts.push(`${deliveryLabel} ✅`);
  } else if (intent === "order_intent") {
    publicParts.push("تمام يا فندم ✅");
  } else {
    if (stockLabel) publicParts.push(`${stockLabel} ✅`);
    else if (productName) publicParts.push(`${productName} متوفر ✅`);
  }
  if (!publicParts.some((part) => part.includes("السعر")) && priceLabel && ["availability_question", "generic_interest", "order_intent"].includes(intent)) {
    publicParts.push(`السعر ${priceLabel}`);
  }
  if (!publicParts.some((part) => part.includes("مقاسات")) && sizesLabel && ["price_question", "order_intent", "generic_interest"].includes(intent)) {
    publicParts.push(`مقاسات ${sizesLabel}`);
  }
  if (productLink) {
    publicParts.push("ابعت لحضرتك التفاصيل في الخاص.");
  }
  const publicReply = text(publicParts.join(" ").replace(/\s+/g, " ").trim() || fallbackPublicReply);

  const privateLines = [];
  privateLines.push(customerName ? `أهلاً بحضرتك يا ${customerName}` : "أهلاً بحضرتك");
  if (productName) privateLines.push(`المنتج: ${productName}`);
  if (brand) privateLines.push(`البراند: ${brand}`);
  if (priceLabel) privateLines.push(`السعر: ${priceLabel}`);
  if (stockLabel) privateLines.push(stockLabel);
  if (sizesLabel) privateLines.push(`المقاسات المتاحة: ${sizesLabel}`);
  if (colorsLabel) privateLines.push(`الألوان المتاحة: ${colorsLabel}`);
  if (productLink) privateLines.push(`لينك المنتج: ${productLink}`);
  if (deliveryLabel) privateLines.push(`التوصيل/الاستلام: ${deliveryLabel}`);
  privateLines.push("ابعتلي المقاس المناسب لحضرتك ولو حابب نكمل الطلب دلوقتي.");
  const privateReply = text(privateLines.join("\n").trim() || fallbackPrivateReply);

  return {
    public_reply: publicReply,
    private_reply: privateReply,
    used_fallback: false,
  };
};

const SOCIAL_COMMENT_GENERIC_PUBLIC_REPLIES = new Set([
  "تم الرد على حضرتك في الخاص ✅",
  "تم إرسال التفاصيل في رسالة خاصة",
  "تم إرسال التفاصيل في رسالة خاصة ",
]);

const SOCIAL_COMMENT_GENERIC_PRIVATE_REPLIES = new Set([
  "تم الرد على حضرتك خاص",
  "تم الرد على حضرتك في الخاص",
  "تم الرد على حضرتك في الخاص ✅",
  "تم إرسال التفاصيل في رسالة خاصة",
  "تم إرسال التفاصيل في رسالة خاصة ",
]);

const isGenericSocialCommentPublicReply = (value = "") => {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return SOCIAL_COMMENT_GENERIC_PUBLIC_REPLIES.has(normalized);
};

const isGenericSocialCommentPrivateReply = (value = "") => {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return SOCIAL_COMMENT_GENERIC_PRIVATE_REPLIES.has(normalized);
};

const buildProductAwarePublicReply = ({ salesContext = {}, intent = "generic_interest" } = {}) => {
  const productName = text(salesContext.product_name || "");
  const priceLabel = buildSalesPriceLabel(salesContext);
  const sizesLabel = buildArabicListLabel(salesContext.sizes || []);
  const colorsLabel = buildArabicListLabel(salesContext.colors || []);
  const productLink = firstNonEmptyText(salesContext.product_url, salesContext.storefront_url);
  const parts = [];
  if (productName) parts.push(productName);
  if (priceLabel) parts.push(`السعر ${priceLabel}`);
  if (sizesLabel && ["generic_interest", "price_question", "size_question", "order_intent", "availability_question"].includes(intent)) {
    parts.push(`المقاسات المتاحة ${sizesLabel}`);
  }
  if (colorsLabel && ["generic_interest", "color_question", "order_intent"].includes(intent)) {
    parts.push(`الألوان المتاحة ${colorsLabel}`);
  }
  if (productLink) parts.push(`لينك المنتج ${productLink}`);
  return text(parts.join(" - ").replace(/\s+/g, " ").trim());
};

const buildProductAwarePrivateReply = ({ salesContext = {}, customerName = "" } = {}) => {
  const productName = text(salesContext.product_name || "");
  const priceLabel = buildSalesPriceLabel(salesContext);
  const sizesLabel = buildArabicListLabel(salesContext.sizes || []);
  const colorsLabel = buildArabicListLabel(salesContext.colors || []);
  const productLink = firstNonEmptyText(salesContext.product_url, salesContext.storefront_url);
  const lines = [];
  lines.push(customerName ? `أهلاً بحضرتك يا ${customerName}` : "أهلاً بحضرتك");
  if (productName) lines.push(`المنتج: ${productName}`);
  if (priceLabel) lines.push(`السعر: ${priceLabel}`);
  if (sizesLabel) lines.push(`المقاسات المتاحة: ${sizesLabel}`);
  if (colorsLabel) lines.push(`الألوان المتاحة: ${colorsLabel}`);
  if (productLink) lines.push(`لينك المنتج: ${productLink}`);
  lines.push("لو تحب أساعدك في المقاس أو إتمام الطلب ابعتلي.");
  return text(lines.join("\n").trim());
};

const buildSocialCommentProductContextResolvedLog = ({ productContext = null, row = {} } = {}) => {
  const mappedProducts = asArray(productContext?.mapped_products || []);
  const productIds = mappedProducts
    .map((item) => Number(item?.product_id || item?.id || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const primaryProductId = Number(
    productContext?.primary_product?.product_id ||
    productContext?.primary_product?.id ||
    productContext?.product_id ||
    0
  ) || null;
  return {
    post_id: text(productContext?.post_id || row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    product_ids: productIds,
    primary_product_id: primaryProductId,
    product_name: text(productContext?.product_name || productContext?.primary_product?.name || ""),
    price: text(productContext?.price || productContext?.sale_price || productContext?.selling_price || ""),
    has_product_context: Boolean(productContext?.found),
  };
};

const buildPrivateReplyEnqueuePayloadLog = ({ row = {}, productContext = null } = {}) => {
  const privateReplyPayload = row?.automation_state?.private_reply || null;
  const messagePreview = text(
    privateReplyPayload?.rendered_reply ||
    privateReplyPayload?.message ||
    ""
  );
  return {
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
    has_message: Boolean(text(privateReplyPayload?.message || "")),
    has_rendered_reply: Boolean(text(privateReplyPayload?.rendered_reply || "")),
    has_private_reply_payload: Boolean(privateReplyPayload),
    message_preview: messagePreview,
    product_ids: Array.isArray(productContext?.product_ids)
      ? productContext.product_ids
      : asArray(productContext?.mapped_products || [])
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    primary_product_id: Number(
      productContext?.primary_product?.product_id ||
      productContext?.primary_product?.id ||
      productContext?.product_id ||
      0
    ) || null,
  };
};

const COMMENT_INTENT_RULES = [
  {
    label: "lead_inbox",
    score: 0.98,
    patterns: [
      /\binbox\b/i,
      /\bdm\b/i,
      /\bmsg\b/i,
      /\bmessage\b/i,
      /\bprivate\b/i,
      "خاص",
      "برايفت",
      "رساله خاصه",
      "رسالة خاصة",
    ],
  },
  {
    label: "lead_price",
    score: 0.97,
    patterns: [
      /\bprice\b/i,
      "السعر",
      "السعر كام",
      "بكام",
      "بكم",
      "bkam",
      "bkam",
      "sa3r",
      "s3er",
      "s3r",
      "es3r",
      "kam",
    ],
  },
  {
    label: "lead_availability",
    score: 0.96,
    patterns: [
      /\bavailable\b/i,
      /\bavailability\b/i,
      /\bin\s*stock\b/i,
      /\bstock\b/i,
      "متاح",
      "موجود",
      "موجوده",
      "موجودة",
      "mawjood",
      "mwjod",
      "mawgood",
      "mwgood",
    ],
  },
  {
    label: "lead_size",
    score: 0.95,
    patterns: [
      /\bsize\b/i,
      /\bsizes\b/i,
      "مقاس",
      "مقاسات",
      "سايز",
      "السايز",
      /\bfit\b/i,
    ],
  },
  {
    label: "lead_shipping",
    score: 0.95,
    patterns: [
      /\bshipping\b/i,
      /\bship\b/i,
      /\bshipment\b/i,
      /\bdelivery\b/i,
      /\bdeliver(y|ies)\b/i,
      "شحن",
      "شحنه",
      "شحنة",
      "توصيل",
      "دليفري",
    ],
  },
  {
    label: "lead_details",
    score: 0.94,
    patterns: [
      /\bdetails\b/i,
      /\bdetail\b/i,
      /\binfo\b/i,
      /\binformation\b/i,
      "تفاصيل",
      "معلومات",
      "ابعت",
      "ابعتلي",
      "ابعتي",
      /\bsend\b/i,
      /\bmore\b/i,
      /\bshow\b/i,
      /\btell\s*me\b/i,
    ],
  },
];

const LOW_VALUE_PATTERNS = [
  /^(?:حلو|حلوه|حلوة|جامد|nice|wow|great|awesome|perfect|amazing|super|cool|love\s*it)$/i,
  /^(?:👍|👎|👌|👏|🔥|❤️|❤|😍|🥰|😘|💯|✨)+$/u,
];

const patternMatches = (pattern, { original = "", normalized = "", compact = "" } = {}) => {
  if (!pattern) return false;
  if (typeof pattern === "string") {
    const needle = normalizeCommentText(pattern);
    return Boolean(
      needle &&
      (normalized.includes(needle) || compact.includes(needle.replace(/\s+/g, "")) || original.toLowerCase().includes(pattern.toLowerCase()))
    );
  }
  if (pattern instanceof RegExp) {
    return pattern.test(original) || pattern.test(normalized) || pattern.test(compact);
  }
  return false;
};

export const classifySocialCommentIntent = (commentText = "") => {
  const original = text(commentText);
  const normalized = normalizeCommentText(original);
  const normalizedCompact = normalized.replace(/\s+/g, "");

  if (!original || !normalized) {
    return { label: "ignore", score: 0.99, reason: "empty_comment" };
  }

  if (EMOJI_ONLY_RE.test(original)) {
    return { label: "ignore", score: 0.99, reason: "emoji_only" };
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(normalizedCompact))) {
    return { label: "engagement_only", score: 0.93, reason: "low_value_engagement" };
  }

  const matchedLabels = [];
  for (const rule of COMMENT_INTENT_RULES) {
    if (rule.patterns.some((pattern) => patternMatches(pattern, { original, normalized, compact: normalizedCompact }))) {
      matchedLabels.push(rule.label);
    }
  }

  if (!matchedLabels.length) {
    return { label: "human_review", score: 0.6, reason: "ambiguous_comment" };
  }

  if (matchedLabels.includes("lead_inbox")) {
    return { label: "lead_inbox", score: 0.98, reason: "explicit_inbox_request" };
  }

  if (matchedLabels.length === 2 && matchedLabels.includes("lead_availability")) {
    const primary = matchedLabels.find((label) => label !== "lead_availability");
    const primaryRule = COMMENT_INTENT_RULES.find((rule) => rule.label === primary);
    if (primaryRule) {
      return {
        label: primaryRule.label,
        score: primaryRule.score,
        reason: "availability_modifier",
      };
    }
  }

  if (matchedLabels.length > 1) {
    return { label: "human_review", score: 0.66, reason: "multiple_lead_intents" };
  }

  const matchedRule = COMMENT_INTENT_RULES.find((rule) => rule.label === matchedLabels[0]);
  return {
    label: matchedRule?.label || "human_review",
    score: matchedRule?.score || 0.6,
    reason: matchedRule?.label || "ambiguous_comment",
  };
};

const COMMENT_LEAD_SCORE = {
  lead_price: 70,
  lead_size: 80,
  lead_shipping: 60,
  lead_details: 70,
  lead_inbox: 90,
};

const COMMENT_LEAD_TEMPERATURE = {
  lead_price: "hot",
  lead_size: "warm",
  lead_shipping: "warm",
  lead_details: "hot",
  lead_inbox: "ready_to_buy",
};

const COMMENT_THREAD_LABELS = new Set(Object.keys(COMMENT_LEAD_SCORE));
const COMMENT_AUTOMATION_ELIGIBLE_LABELS = new Set(Object.keys(COMMENT_LEAD_SCORE));
const COMMENT_AUTOMATION_MIN_SCORE = 0.9;
const COMMENT_AUTOMATION_PUBLIC_REPLY_TEXT = "تم إرسال التفاصيل في رسالة خاصة ";

const featureFlagEnabled = (value = "") => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const socialCommentsDebugEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  featureFlagEnabled(process.env.SOCIAL_COMMENTS_DEBUG || process.env.AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || "");
const socialCommentsLog = (...args) => {
  if (socialCommentsDebugEnabled()) console.info(...args);
};
const socialCommentsError = (...args) => {
  if (socialCommentsDebugEnabled()) console.error(...args);
};

const getSocialCommentAutomationFlags = () => ({
  like: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_LIKE || "false"),
  publicReply: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY || "false"),
  privateMessage: featureFlagEnabled(process.env.SOCIAL_COMMENTS_AUTO_PRIVATE_MESSAGE || "false"),
});

const parseSocialAutomationEnvSwitch = (value = "") => {
  const normalized = text(value).toLowerCase();
  if (!normalized) {
    return { enabled: null, explicitlyDisabled: false, raw: "" };
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return { enabled: false, explicitlyDisabled: true, raw: normalized };
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return { enabled: true, explicitlyDisabled: false, raw: normalized };
  }
  return { enabled: null, explicitlyDisabled: false, raw: normalized };
};

const getSocialCommentAutomationEnvFlags = () => ({
  like: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_LIKE || ""),
  publicReply: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY || ""),
  privateMessage: parseSocialAutomationEnvSwitch(process.env.SOCIAL_COMMENTS_AUTO_PRIVATE_MESSAGE || ""),
});

const normalizeSocialAutomationSettings = (settings = {}) => ({
  ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  ...(settings && typeof settings === "object" ? settings : {}),
});

const isSocialAutomationEnvDisabled = (flag) =>
  flag === false || flag?.enabled === false || flag?.explicitlyDisabled === true;

const socialCommentAutomationChannelForPlatform = (platform = "") => (text(platform) === "instagram" ? "instagram" : "facebook_messenger");

const socialCommentAutomationStepFinal = (value = "") => ["sent", "failed", "skipped"].includes(text(value).toLowerCase());

const socialCommentAutomationTone = (status = "") => {
  const normalized = text(status).toLowerCase();
  if (normalized === "sent") return "emerald";
  if (normalized === "failed") return "rose";
  if (normalized === "skipped") return "zinc";
  return "amber";
};

const socialCommentAutomationLabel = (messageType = "") => {
  const key = text(messageType);
  if (key === "comment_like") return "Like";
  if (key === "comment_public_reply") return "Public reply";
  if (key === "comment_private_reply") return "Private message";
  if (key === "automation_error") return "Automation error";
  return key || "";
};

export const buildSocialCommentSuggestedReply = ({ classificationLabel = "", commenterName = "", originalCommentText = "", postPermalink = "" } = {}) => {
  const name = text(commenterName) || "العميل";
  const linkHint = postPermalink ? ` لو تحب تراجع المنشور: ${postPermalink}` : "";
  if (classificationLabel === "lead_price") return `تم تجهيز السعر والتفاصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_size") return `تم تجهيز المقاسات المتاحة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_shipping") return `تم تجهيز تفاصيل الشحن والتوصيل يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_details") return `تم تجهيز التفاصيل الكاملة يا ${name}.${linkHint}`;
  if (classificationLabel === "lead_inbox") return `تم تجهيز رسالة خاصة تحتوي على التفاصيل المطلوبة يا ${name}.${linkHint}`;
  return `رد مقترح: ${text(originalCommentText) || "تم استلام تعليقك."}${linkHint}`;
};

const isSupportedWebhookCommentTrigger = (event = {}) => {
  const rawPayload = event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : {};
  const value = rawPayload.value && typeof rawPayload.value === "object" ? rawPayload.value : {};
  const field = text(rawPayload.field || "").toLowerCase();
  const item = text(value.item || "").toLowerCase();
  const verb = text(value.verb || "").toLowerCase();
  const platform = text(event.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const allowedVerb = ["add", "created", "edited", "edit", ""].includes(verb);
  const source = text(rawPayload.source || "");
  const isFacebookFeedComment = platform === "facebook" && field === "feed" && item === "comment" && allowedVerb;
  const isInstagramComment = platform === "instagram" && ["comments", "mentions"].includes(field) && item === "comment" && allowedVerb;
  return source === "meta_webhook" && (isFacebookFeedComment || isInstagramComment);
};

const buildSocialCommentPrivateReplyMessage = ({ row = {}, settings = {} } = {}) => {
  const template = text(settings.private_message_template || "");
  if (template) {
    return template;
  }
  return buildSocialCommentSuggestedReply({
    classificationLabel: row.classification_label || "",
    commenterName: row.commenter_name || "",
    originalCommentText: row.original_comment_text || "",
    postPermalink: row.post_permalink || row.post_permalink_url || "",
  });
};

const renderSocialCommentTemplateText = (templateText = "", context = {}) =>
  text(templateText).replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return text(context[key] ?? context[key.toLowerCase()] ?? "");
  });

const renderAutomationTemplate = (templateText = "", context = {}) => renderSocialCommentTemplateText(templateText, context);

const buildAutomationPublicUrl = (path = "") => {
  const safePath = text(path || "");
  const base = text(getPublicAppUrl() || "");
  if (!safePath) return base || "";
  if (/^https?:\/\//i.test(safePath)) return safePath;
  const normalizedPath = safePath.startsWith("/") ? safePath : `/${safePath}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
};

const extractTemplatePlaceholders = (templateText = "") => {
  const placeholders = new Set();
  const pattern = /\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g;
  String(templateText || "").replace(pattern, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    if (key) placeholders.add(key);
    return _match;
  });
  return Array.from(placeholders);
};

const detectMissingTemplatePlaceholders = (templateText = "", context = {}) => {
  const placeholders = extractTemplatePlaceholders(templateText);
  return placeholders.filter((key) => !text(context[key] ?? context[key.toLowerCase()] ?? ""));
};

const summarizeAutomationStepResults = (stepResults = []) => {
  const normalized = asArray(stepResults).map((item) => ({
    step: text(item?.step || ""),
    status: text(item?.status || "skipped") || "skipped",
    reason: text(item?.reason || ""),
    message: text(item?.message || ""),
    meta: item?.meta && typeof item.meta === "object" ? item.meta : {},
  }));
  if (!normalized.length) {
    return { status: "skipped", errorMessage: "", normalized };
  }
  const hasFailed = normalized.some((item) => item.status === "failed");
  const hasSent = normalized.some((item) => ["sent", "queued", "created", "linked", "success"].includes(item.status));
  const hasExecuted = normalized.some((item) => ["sent", "queued", "failed", "created", "linked", "success"].includes(item.status));
  const allSkipped = normalized.every((item) => item.status === "skipped");
  const status = allSkipped
    ? "skipped"
    : hasFailed
      ? (hasSent ? "partial_success" : "failed")
      : hasExecuted && normalized.some((item) => item.status === "queued")
        ? "partial_success"
        : "success";
  const errorMessage = normalized.find((item) => item.status === "failed")?.reason || "";
  return { status, errorMessage, normalized };
};

export const upsertSocialCommentAutomationRunSummary = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  configId = null,
  customerName = "",
  status = "skipped",
  stepResults = [],
  errorMessage = "",
  diagnostics = {},
  row = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  await ensureSocialCommentAutomationSchema();
  const summary = summarizeAutomationStepResults(stepResults);
  const finalStatus = text(status || summary.status || "skipped") || "skipped";
  const finalErrorMessage = text(errorMessage || summary.errorMessage || "");
  const safeDiagnostics = buildAutomationRunDiagnostics({
    row,
    skippedReason: diagnostics?.skipped_reason || row.skipped_reason || row.metadata?.skipped_reason || "",
    duplicateReason: diagnostics?.duplicate_reason || row.duplicate_reason || row.metadata?.duplicate_reason || "",
    rawRuntimeContext: diagnostics?.raw_runtime_context || {},
    config: diagnostics?.config || null,
    productContext: diagnostics?.product_context || null,
  });
  const rawRuntimeContext = safeDiagnostics.raw_runtime_context && typeof safeDiagnostics.raw_runtime_context === "object" && !Array.isArray(safeDiagnostics.raw_runtime_context)
    ? safeDiagnostics.raw_runtime_context
    : {};
  const runtimeAiSales = rawRuntimeContext.ai_sales && typeof rawRuntimeContext.ai_sales === "object" && !Array.isArray(rawRuntimeContext.ai_sales)
    ? rawRuntimeContext.ai_sales
    : {};
  const result = await db.query(
    `
    INSERT INTO social_comment_automation_runs (
      tenant_id,
      platform,
      channel,
      post_id,
      comment_id,
      commenter_name,
      action_taken,
      public_reply_status,
      dm_status,
      like_status,
      automation_state,
      status,
      step_results,
      config_id,
      skipped_reason,
      matched_config_key,
      resolved_post_id,
      resolved_platform_post_id,
      resolved_product_id,
      duplicate_reason,
      config_found,
      config_enabled,
      error_message,
      processed_at,
      created_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::text,
      $10::text,
      $11::jsonb,
      $12::text,
      $13::jsonb,
      $14::bigint,
      $15::text,
      $16::text,
      $17::text,
      $18::text,
      $19::bigint,
      $20::text,
      $21::boolean,
      $22::boolean,
      $23::text,
      CURRENT_TIMESTAMP,
      COALESCE($24::timestamp, CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
      post_id = COALESCE(NULLIF(EXCLUDED.post_id, ''), social_comment_automation_runs.post_id),
      commenter_name = COALESCE(NULLIF(EXCLUDED.commenter_name, ''), social_comment_automation_runs.commenter_name),
      action_taken = COALESCE(NULLIF(EXCLUDED.action_taken, ''), social_comment_automation_runs.action_taken),
      public_reply_status = COALESCE(NULLIF(EXCLUDED.public_reply_status, ''), social_comment_automation_runs.public_reply_status),
      dm_status = COALESCE(NULLIF(EXCLUDED.dm_status, ''), social_comment_automation_runs.dm_status),
      like_status = COALESCE(NULLIF(EXCLUDED.like_status, ''), social_comment_automation_runs.like_status),
      automation_state = COALESCE(social_comment_automation_runs.automation_state, '{}'::jsonb) || COALESCE(EXCLUDED.automation_state, '{}'::jsonb),
      status = COALESCE(NULLIF(EXCLUDED.status, ''), social_comment_automation_runs.status),
      step_results = COALESCE(EXCLUDED.step_results, social_comment_automation_runs.step_results),
      config_id = COALESCE(EXCLUDED.config_id, social_comment_automation_runs.config_id),
      skipped_reason = COALESCE(NULLIF(EXCLUDED.skipped_reason, ''), social_comment_automation_runs.skipped_reason),
      matched_config_key = COALESCE(NULLIF(EXCLUDED.matched_config_key, ''), social_comment_automation_runs.matched_config_key),
      resolved_post_id = COALESCE(NULLIF(EXCLUDED.resolved_post_id, ''), social_comment_automation_runs.resolved_post_id),
      resolved_platform_post_id = COALESCE(NULLIF(EXCLUDED.resolved_platform_post_id, ''), social_comment_automation_runs.resolved_platform_post_id),
      resolved_product_id = COALESCE(EXCLUDED.resolved_product_id, social_comment_automation_runs.resolved_product_id),
      duplicate_reason = COALESCE(NULLIF(EXCLUDED.duplicate_reason, ''), social_comment_automation_runs.duplicate_reason),
      config_found = EXCLUDED.config_found,
      config_enabled = EXCLUDED.config_enabled,
      error_message = COALESCE(NULLIF(EXCLUDED.error_message, ''), social_comment_automation_runs.error_message),
      processed_at = COALESCE(social_comment_automation_runs.processed_at, EXCLUDED.processed_at),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *, (xmax = 0) AS inserted
    `,
    [
      safeTenantId,
      text(platform || row.platform || "facebook"),
      text(row.channel || (text(platform || row.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment")),
      safePostId,
      safeCommentId,
      text(customerName || row.commenter_name || row.customer_name || ""),
      text(summary.status === "skipped" ? "automation_skipped" : `automation_${summary.status}`),
      text(row.public_reply_status || row.automation_state?.public_reply_status || ""),
      text(row.dm_status || row.automation_state?.dm_status || ""),
      text(row.like_status || row.automation_state?.like_status || ""),
      JSON.stringify({
        ...(row.automation_state || {}),
        runtime_monitor: {
          post_id: safePostId,
          comment_id: safeCommentId,
          config_id: configId ?? null,
          status: finalStatus,
          step_results: summary.normalized,
          error_message: finalErrorMessage,
          skipped_reason: safeDiagnostics.skipped_reason,
          matched_config_key: safeDiagnostics.matched_config_key,
          resolved_post_id: safeDiagnostics.resolved_post_id,
          resolved_platform_post_id: safeDiagnostics.resolved_platform_post_id,
          resolved_product_id: safeDiagnostics.resolved_product_id,
          duplicate_reason: safeDiagnostics.duplicate_reason,
          config_found: safeDiagnostics.config_found,
          config_enabled: safeDiagnostics.config_enabled,
          product_link: text(row.product_link || row.metadata?.product_link || row.metadata?.website_product_link || ""),
          checkout_link: text(row.checkout_link || row.metadata?.checkout_link || ""),
          guidance_mode: text(row.guidance_mode || row.metadata?.guidance_mode || "website_checkout") || "website_checkout",
          detected_intent: text(runtimeAiSales.intent || ""),
          generated_public_reply: text(runtimeAiSales.public_reply || ""),
          generated_private_reply: text(runtimeAiSales.private_reply || ""),
          approval_status: text(runtimeAiSales.approval_status || ""),
          ai_sales: runtimeAiSales,
          raw_runtime_context: safeDiagnostics.raw_runtime_context,
          updated_at: new Date().toISOString(),
        },
      }),
      finalStatus,
      JSON.stringify(summary.normalized),
      configId ?? null,
      safeDiagnostics.skipped_reason,
      safeDiagnostics.matched_config_key,
      safeDiagnostics.resolved_post_id,
      safeDiagnostics.resolved_platform_post_id,
      safeDiagnostics.resolved_product_id,
      safeDiagnostics.duplicate_reason,
      safeDiagnostics.config_found,
      safeDiagnostics.config_enabled,
      finalErrorMessage,
      row.created_at || null,
    ]
  );
  return result.rows?.[0] || null;
};

const upsertSocialCommentAutomationRunAudit = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  status = "duplicate_skipped",
  skippedReason = "",
  stepResults = [],
  productLink = "",
  checkoutLink = "",
  diagnostics = {},
  row = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  await ensureSocialCommentAutomationSchema();
  const safeDiagnostics = buildAutomationRunDiagnostics({
    row,
    skippedReason,
    duplicateReason: diagnostics?.duplicate_reason || skippedReason || "duplicate_comment_automation",
    rawRuntimeContext: diagnostics?.raw_runtime_context || {},
    config: diagnostics?.config || null,
    productContext: diagnostics?.product_context || null,
  });
  try {
    const result = await db.query(
      `
      INSERT INTO social_comment_automation_run_audits (
        tenant_id,
        platform,
        post_id,
        comment_id,
        status,
        skipped_reason,
        matched_config_key,
        resolved_post_id,
        resolved_platform_post_id,
        resolved_product_id,
        duplicate_reason,
        config_found,
        config_enabled,
        step_results,
        product_link,
        checkout_link,
        guidance_mode,
        created_at
      )
      VALUES (
        $1::bigint,
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::bigint,
        $11::text,
        $12::boolean,
        $13::boolean,
        $14::jsonb,
        $15::text,
        $16::text,
        $17::text,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        safeTenantId,
        text(platform || row.platform || "facebook"),
        safePostId,
        safeCommentId,
        text(status || "duplicate_skipped") || "duplicate_skipped",
        safeDiagnostics.skipped_reason || text(skippedReason || ""),
        safeDiagnostics.matched_config_key,
        safeDiagnostics.resolved_post_id || safePostId,
        safeDiagnostics.resolved_platform_post_id || safePostId,
        safeDiagnostics.resolved_product_id,
        safeDiagnostics.duplicate_reason || text(skippedReason || "duplicate_comment_automation"),
        safeDiagnostics.config_found,
        safeDiagnostics.config_enabled,
        JSON.stringify(asArray(stepResults)),
        text(productLink || row.product_link || row.metadata?.product_link || ""),
        text(checkoutLink || row.checkout_link || row.metadata?.checkout_link || ""),
        text(row.guidance_mode || "website_checkout") || "website_checkout",
      ]
    );
    return result.rows?.[0] || null;
  } catch (error) {
    debugSocialCommentsWarn("SOCIAL_COMMENT_AUTOMATION_RUN_AUDIT_WRITE_FAILED", {
      tenant_id: safeTenantId,
      platform: text(platform || row.platform || "facebook"),
      post_id: safePostId,
      comment_id: safeCommentId,
      status: text(status || "duplicate_skipped") || "duplicate_skipped",
      message: error?.message || "",
    });
    return null;
  }
};

const findSocialCommentAutomationRunByKey = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  currentRunId = null,
  currentCreatedAt = null,
} = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const safeCommentId = text(commentId || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId || !safePostId) return null;
  await ensureSocialCommentAutomationSchema();
  const safeCurrentRunId = Number(currentRunId || 0) || null;
  const safeCurrentCreatedAt = text(currentCreatedAt || "");
  const duplicateStatuses = ["processing", "queued", "success", "partial_success", "failed"];
  const conditions = [
    `tenant_id = $1::bigint`,
    `platform = $2::text`,
    `comment_id = $3::text`,
    `post_id = $4::text`,
    `COALESCE(NULLIF(status, ''), 'skipped') = ANY($5::text[])`,
  ];
  const params = [safeTenantId, text(platform || "facebook"), safeCommentId, safePostId, duplicateStatuses];
  if (safeCurrentRunId) {
    conditions.push(`id <> $6::bigint`);
    params.push(safeCurrentRunId);
  }
  const currentCreatedAtClause = safeCurrentCreatedAt ? `AND created_at < $${params.length + 1}::timestamp` : "";
  if (safeCurrentRunId && safeCurrentCreatedAt) {
    params.push(safeCurrentCreatedAt);
  } else if (safeCurrentCreatedAt) {
    params.push(safeCurrentCreatedAt);
  }
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE ${conditions.join(" AND ")}
      ${currentCreatedAtClause}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    params
  );
  return result.rows?.[0] || null;
};

const loadPostAutomationConfig = async ({ tenantId = null, platform = "", postId = "", row = {} } = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safePostId = text(postId || row.post_id || row.metadata?.post_id || row.raw_payload?.post_id || "");
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!safeTenantId || !safePostId || normalizedPlatform !== "facebook") {
    return null;
  }
  const safeRow = metadataObject(row);
  const loadedPost = await loadSocialCommentPost({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }).catch(() => null);
  const rawPayload = metadataObject(safeRow.raw_payload || {});
  const rawValue = metadataObject(rawPayload.value || {});
  const loadedPostMetadata = metadataObject(loadedPost?.metadata || {});
  const lookupRow = {
    ...safeRow,
    ...metadataObject(loadedPost || {}),
    post_id: safePostId,
    platform_post_id: safeRow.platform_post_id || loadedPost?.platform_post_id || rawPayload.platform_post_id || rawPayload.external_post_id || rawValue.post_id || rawValue.post?.id || rawValue.post?.post_id || rawPayload.entry?.id || "",
    wrapper_post_id: safeRow.wrapper_post_id || loadedPost?.wrapper_post_id || loadedPostMetadata.wrapper_post_id || rawPayload.wrapper_post_id || "",
    internal_post_id: safeRow.internal_post_id || loadedPost?.internal_post_id || loadedPostMetadata.internal_post_id || rawPayload.internal_post_id || "",
    source_post_id: safeRow.source_post_id || loadedPost?.source_post_id || loadedPostMetadata.source_post_id || rawPayload.source_post_id || rawPayload.post_id || "",
    metadata: {
      ...loadedPostMetadata,
      ...metadataObject(safeRow.metadata || {}),
      post_id: safeRow.metadata?.post_id || loadedPostMetadata.post_id || loadedPost?.automation_run_post_id || rawPayload.post_id || rawValue.post_id || rawValue.post?.id || rawValue.post?.post_id || "",
      platform_post_id: safeRow.metadata?.platform_post_id || loadedPostMetadata.platform_post_id || loadedPost?.automation_run_post_id || rawPayload.platform_post_id || rawPayload.external_post_id || rawValue.post_id || rawValue.post?.id || rawValue.post?.post_id || rawPayload.entry?.id || "",
      external_post_id: safeRow.metadata?.external_post_id || loadedPostMetadata.external_post_id || rawPayload.external_post_id || "",
      wrapper_post_id: safeRow.metadata?.wrapper_post_id || loadedPostMetadata.wrapper_post_id || rawPayload.wrapper_post_id || "",
      internal_post_id: safeRow.metadata?.internal_post_id || loadedPostMetadata.internal_post_id || rawPayload.internal_post_id || "",
    },
    raw_payload: {
      ...rawPayload,
      ...metadataObject(loadedPost?.automation_run_raw_payload || {}),
      post_id: rawPayload.post_id || rawValue.post_id || rawValue.post?.id || rawValue.post?.post_id || "",
      platform_post_id: rawPayload.platform_post_id || rawPayload.external_post_id || rawValue.post_id || rawValue.post?.id || rawValue.post?.post_id || rawPayload.entry?.id || loadedPost?.automation_run_post_id || "",
      external_post_id: rawPayload.external_post_id || loadedPostMetadata.external_post_id || "",
      wrapper_post_id: rawPayload.wrapper_post_id || loadedPostMetadata.wrapper_post_id || "",
      internal_post_id: rawPayload.internal_post_id || loadedPostMetadata.internal_post_id || "",
    },
  };
  const config = await getSocialCommentAutomationConfig({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    row: lookupRow,
    post: {
      ...lookupRow,
      metadata: lookupRow.metadata,
      post_id: lookupRow.post_id,
      platform_post_id: lookupRow.platform_post_id,
      wrapper_post_id: lookupRow.wrapper_post_id,
      internal_post_id: lookupRow.internal_post_id,
      source_post_id: lookupRow.source_post_id,
      raw_payload: lookupRow.raw_payload,
    },
  }).catch(() => null);
  return config?.persisted ? config : null;
};

const buildAutomationTemplateContext = ({ row = {}, productContext = {}, websiteLinks = {} } = {}) => {
  const customerName = text(row.commenter_name || row.customer_name || row.from?.name || row.metadata?.from?.name || "");
  const productName = text(productContext?.product_name || row.product_name || row.metadata?.product_name || "");
  const price = text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || row.sale_price || row.price || "");
  const finalPrice = text(productContext?.final_price || row.final_price || row.metadata?.final_price || "");
  const salePrice = text(productContext?.sale_price || row.sale_price || row.product_sale_price || "");
  const sellingPrice = text(productContext?.selling_price || row.selling_price || row.product_selling_price || "");
  const availableSizesList = asArray(productContext?.sizes || row.sizes || row.product_sizes || [])
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  const availableSizes = availableSizesList.join(", ");
  const availableColorsList = asArray(productContext?.colors || productContext?.available_colors || row.colors || row.product_colors || [])
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  const availableColors = availableColorsList.join(", ");
  const color = text(productContext?.color || availableColorsList[0] || row.color || "");
  const stockStatus = text(productContext?.stock_status || row.stock_status || (availableSizesList.length ? "in_stock" : "") || "");
  const productLink = text(
    websiteLinks?.product_link ||
      productContext?.product_url ||
      row.product_url ||
      row.metadata?.website_product_link ||
      row.metadata?.product_url ||
      row.post_permalink_url ||
      row.post_permalink ||
      ""
  );
  const checkoutLink = text(
    websiteLinks?.checkout_link ||
      productContext?.checkout_link ||
      row.checkout_link ||
      row.metadata?.checkout_link ||
      buildAutomationPublicUrl("/shop/checkout")
  );
  const productUrl = productLink;
  return {
    customerName,
    customer_name: customerName,
    commenterName: customerName,
    commenter_name: customerName,
    productName,
    product_name: productName,
    price,
    finalPrice,
    final_price: finalPrice,
    salePrice,
    sale_price: salePrice,
    sellingPrice,
    selling_price: sellingPrice,
    size: text(productContext?.size || row.size || ""),
    color,
    colors: availableColors,
    available_colors: availableColors,
    available_colors_list: availableColorsList,
    productUrl,
    product_url: productUrl,
    product_link: productLink,
    checkout_link: checkoutLink,
    checkoutLink,
    postPermalink: text(row.post_permalink || row.post_permalink_url || ""),
    post_permalink: text(row.post_permalink || row.post_permalink_url || ""),
    originalCommentText: text(row.original_comment_text || row.comment_text || ""),
    original_comment_text: text(row.original_comment_text || row.comment_text || ""),
    sizes: availableSizes,
    available_sizes: availableSizes,
    availableSizes,
    available_sizes_list: availableSizesList,
    variants: availableSizes,
    stock_status: stockStatus,
    stockStatus,
    product_id: text(productContext?.product_id || row.product_id || ""),
  };
};

const buildFallbackSocialCommentProductContext = ({ row = {} } = {}) => {
  const fallbackProductLink = buildAutomationPublicUrl("/shop") || buildAutomationPublicUrl("/shop/products");
  return {
    found: false,
    source: "fallback",
    platform: text(row.platform || "facebook") || "facebook",
    post_id: text(row.post_id || row.metadata?.post_id || ""),
    product_id: null,
    product_name: "المنتج",
    price: text(row.product_price || row.price || ""),
    sale_price: text(row.sale_price || row.product_sale_price || ""),
    selling_price: text(row.selling_price || row.product_selling_price || row.product_price || row.price || ""),
    sizes: [],
    available_sizes: [],
    colors: [],
    stock_status: "يرجى مراجعة التوفر من الموقع",
    product_url: fallbackProductLink,
    product_link: fallbackProductLink,
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    variant_id: "",
    color: "",
    size: "",
    candidate_post_ids: [],
  };
};

const hasLinkedProductForAutomation = ({ row = {}, productContext = null } = {}) => {
  const safeRow = row && typeof row === "object" ? row : {};
  const metadata = safeRow.metadata && typeof safeRow.metadata === "object" && !Array.isArray(safeRow.metadata) ? safeRow.metadata : {};
  const mappingSummary = safeRow.mapping_summary && typeof safeRow.mapping_summary === "object" && !Array.isArray(safeRow.mapping_summary) ? safeRow.mapping_summary : {};
  const linkedCount = Number(
    safeRow.linked_products_count ??
    safeRow.product_links_count ??
    mappingSummary.count ??
    metadata.linked_products_count ??
    metadata.product_links_count ??
    0
  ) || 0;
  const productId = Number(
    productContext?.product_id ??
    safeRow.product_id ??
    safeRow.primary_product?.product_id ??
    safeRow.primary_product?.id ??
    safeRow.primary_linked_product?.product_id ??
    safeRow.primary_linked_product?.id ??
    mappingSummary.primary_product?.product_id ??
    mappingSummary.primary_product?.id ??
    metadata.product_id ??
    null
  );
  return Boolean(productContext?.found) || linkedCount > 0 || (Number.isFinite(productId) && productId > 0);
};

const buildRuntimeProductContextRow = ({
  row = {},
  event = {},
  selectedPostId = "",
  selectedCommentId = "",
  runtimePostId = "",
  runtimeCommentId = "",
  postId = "",
  commentId = "",
} = {}) => {
  const safeRow = row && typeof row === "object" ? row : {};
  const safeEvent = event && typeof event === "object" ? event : {};
  const comment = safeEvent.comment && typeof safeEvent.comment === "object"
    ? safeEvent.comment
    : safeRow.comment && typeof safeRow.comment === "object"
      ? safeRow.comment
      : {};
  const conversation = safeEvent.conversation && typeof safeEvent.conversation === "object"
    ? safeEvent.conversation
    : safeRow.conversation && typeof safeRow.conversation === "object"
      ? safeRow.conversation
      : {};
  const finalPostId = text(
    selectedPostId ||
    safeEvent.post_id ||
    comment.post_id ||
    conversation.post_id ||
    runtimePostId ||
    postId ||
    ""
  );
  const finalCommentId = text(
    selectedCommentId ||
    safeEvent.comment_id ||
    comment.comment_id ||
    runtimeCommentId ||
    commentId ||
    ""
  );

  return {
    finalPostId,
    finalCommentId,
    row: {
      ...safeEvent,
      ...safeRow,
      post_id: finalPostId,
      comment_id: finalCommentId,
    },
  };
};

const buildSocialCommentProductResolutionPathPayload = ({ row = {}, productContext = null } = {}) => {
  const safeRow = row && typeof row === "object" ? row : {};
  const directProductIdsCount = Number(
    productContext?.direct_product_ids_count ??
    safeRow.direct_product_ids_count ??
    0
  ) || 0;
  const siblingProductIdsCount = Number(
    productContext?.sibling_product_ids_count ??
    safeRow.sibling_product_ids_count ??
    0
  ) || 0;
  const finalProductIdsCount = Number(
    productContext?.final_product_ids_count ??
    productContext?.linked_products_count ??
    safeRow.linked_products_count ??
    0
  ) || 0;
  return {
    post_id: text(safeRow.post_id || productContext?.post_id || ""),
    comment_id: text(safeRow.comment_id || ""),
    direct_product_ids_count: directProductIdsCount,
    tried_sibling_lookup: Boolean(
      productContext?.tried_sibling_lookup ??
      safeRow.tried_sibling_lookup ??
      directProductIdsCount === 0
    ),
    sibling_product_ids_count: siblingProductIdsCount,
    final_product_ids_count: finalProductIdsCount,
    path: text(
      productContext?.path ||
      productContext?.source ||
      safeRow.product_resolution_path ||
      (finalProductIdsCount > 0 ? "resolved" : "no_linked_product")
    ),
  };
};

const resolveAutomationCommenterIdentity = (row = {}) => {
  const candidateName = resolveSocialCommentCustomerName(row) || text(row.customer_name || row.commenter_name || row.from?.name || "");
  const commenterName = isGenericSocialCommentDisplayName(candidateName) ? "" : candidateName;
  const commenterAvatarUrl = resolveSocialCommentAvatarUrl(row);
  const commenterId = text(
    row.commenter_id ||
      row.external_customer_id ||
      row.customer_external_id ||
      row.from?.id ||
      row.raw_payload?.value?.from?.id ||
      row.raw_payload?.from?.id ||
      row.metadata?.commenter_id ||
      row.comment_id ||
      ""
  );
  return {
    commenterName,
    commenterAvatarUrl,
    commenterId,
  };
};

const resolveAutomationWebsiteLinks = async ({ tenantId = null, row = {}, productContext = {} } = {}) => {
  const directUrl = text(
    productContext?.product_url ||
      row.product_url ||
      row.metadata?.website_product_link ||
      row.metadata?.product_url ||
      ""
  );
  try {
    const resolved = await resolveStorefrontProductLink({
      tenantId,
      product: {
        id: productContext?.product_id || row.product_id || row.metadata?.product_id || "",
        product_id: productContext?.product_id || row.product_id || row.metadata?.product_id || "",
        name: productContext?.product_name || row.product_name || row.metadata?.product_name || "",
        slug: productContext?.slug || row.product_slug || row.metadata?.product_slug || "",
        canonical_slug: productContext?.canonical_slug || row.product_slug || row.metadata?.product_slug || "",
      },
    }).catch(() => null);
    const resolvedUrl = text(directUrl || resolved?.url || resolved?.product_url || "");
    const selection = [
      ["variant", text(productContext?.variant_id || row.variant_id || row.selected_variant_id || row.matched_variant_id || "")],
      ["color", text(productContext?.color || row.color || row.product_color || "")],
      ["size", text(productContext?.size || row.size || row.product_size || "")],
    ].filter(([, value]) => Boolean(value));
    const appendedUrl = selection.length
      ? `${resolvedUrl || buildAutomationPublicUrl("/shop/products")}${(resolvedUrl || buildAutomationPublicUrl("/shop/products")).includes("?") ? "&" : "?"}${new URLSearchParams(selection).toString().replace(/\+/g, "%20")}`
      : resolvedUrl || buildAutomationPublicUrl("/shop/products");
    return {
      product_link: appendedUrl,
      product_url: appendedUrl,
      checkout_link: buildAutomationPublicUrl("/shop/checkout"),
      checkout_url: buildAutomationPublicUrl("/shop/checkout"),
      available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
      stock_status: text(productContext?.stock_status || row.stock_status || (asArray(productContext?.sizes || row.sizes || row.product_sizes || []).length ? "in_stock" : "")),
    };
  } catch {
    const fallback = buildAutomationPublicUrl("/shop/products");
    return {
      product_link: fallback,
      product_url: fallback,
      checkout_link: buildAutomationPublicUrl("/shop/checkout"),
      checkout_url: buildAutomationPublicUrl("/shop/checkout"),
      available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
      stock_status: text(productContext?.stock_status || row.stock_status || ""),
    };
  }
};

const upsertAutomationInboxConversation = async ({
  tenantId = null,
  platform = "facebook",
  row = {},
  productContext = {},
  websiteProductLink = "",
  checkoutLink = "",
  aiHandling = false,
  leadStatus = "new",
  customerProfileId = null,
  customerName = "",
  customerAvatarUrl = "",
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const channel = text(row.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"));
  const externalConversationId = text(row.inbox_conversation_id || row.session_id || row.conversation_id || socialCommentConversationId({
    platform: normalizedPlatform,
    postId: row.post_id,
    rootCommentId: row.root_comment_id,
    commentId: row.comment_id,
  }));
  const externalCustomerId = text(resolveAutomationCommenterIdentity(row).commenterId || row.commenter_id || row.external_customer_id || row.comment_id || "");
  const resolvedCustomerName = text(customerName || resolveAutomationCommenterIdentity(row).commenterName || row.customer_name || "");
  const resolvedAvatarUrl = text(customerAvatarUrl || resolveAutomationCommenterIdentity(row).commenterAvatarUrl || row.customer_avatar_url || "");
  if (!safeTenantId || !externalConversationId) return null;
  const metadata = {
    ...(row.metadata || {}),
    source: "comment_automation",
    source_type: "comment_automation",
    platform: normalizedPlatform,
    channel,
    post_id: text(row.post_id || row.metadata?.post_id || ""),
    comment_id: text(row.comment_id || row.metadata?.comment_id || ""),
    product_id: text(productContext?.product_id || row.product_id || row.metadata?.product_id || ""),
    product_name: text(productContext?.product_name || row.product_name || row.metadata?.product_name || ""),
    product_price: text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || row.price || ""),
    product_sale_price: text(productContext?.sale_price || row.product_sale_price || ""),
    product_url: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    website_product_link: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    product_link: websiteProductLink || text(productContext?.product_url || row.product_url || ""),
    checkout_link: text(checkoutLink || productContext?.checkout_link || row.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    available_sizes: asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean),
    stock_status: text(productContext?.stock_status || row.stock_status || ""),
    guidance_mode: "website_checkout",
    ai_follow_up: aiHandling,
    lead_state: aiHandling ? "ai_handling" : "new_lead",
    lead_status: aiHandling ? "ai_handling" : "new_lead",
    customer_name: resolvedCustomerName,
    customer_avatar_url: resolvedAvatarUrl,
  };
  const result = await db.query(
    `
    INSERT INTO ai_channel_conversations (
      tenant_id,
      channel,
      external_conversation_id,
      external_customer_id,
      thread_kind,
      lead_status,
      customer_name,
      customer_avatar_url,
      last_message,
      customer_profile_id,
      metadata,
      last_message_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_channel_conversations.thread_kind),
      lead_status = COALESCE(NULLIF(EXCLUDED.lead_status, ''), ai_channel_conversations.lead_status),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_name, ''), '') = ''
          OR LOWER(ai_channel_conversations.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name)
        ELSE ai_channel_conversations.customer_name
      END,
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url)
        ELSE ai_channel_conversations.customer_avatar_url
      END,
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      last_message_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [
      safeTenantId,
      channel,
      externalConversationId,
      externalCustomerId,
      text(row.thread_kind || "comment"),
      text(leadStatus || "new"),
      resolvedCustomerName,
      resolvedAvatarUrl,
      text(row.original_comment_text || row.comment_text || row.last_message || row.comment_id || ""),
      customerProfileId ? Number(customerProfileId) : null,
      JSON.stringify(metadata),
    ]
  );
  const savedRow = result.rows[0] || null;
  if (savedRow) {
    emitSocialCommentUpdated(savedRow);
  }
  return savedRow;
};

const buildAutomationProfileMetadata = ({ row = {}, productContext = {}, templateContext = {}, websiteLinks = {} } = {}) => {
  const commenter = resolveAutomationCommenterIdentity(row);
  const availableSizes = asArray(productContext?.sizes || row.sizes || row.product_sizes || []).map((value) => text(value)).filter(Boolean);
  return {
    channel: text(row.channel || (text(row.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
    customer_phone: text(row.phone || row.customer_phone || ""),
    external_customer_id: commenter.commenterId || text(row.external_customer_id || row.comment_id || ""),
    customer_name: commenter.commenterName || text(row.customer_name || row.commenter_name || ""),
    full_name: commenter.commenterName || text(row.customer_name || row.commenter_name || ""),
    sender_name: commenter.commenterName || text(row.commenter_name || ""),
    contact_name: commenter.commenterName || text(row.commenter_name || ""),
    profile_name: commenter.commenterName || text(row.commenter_name || ""),
    product_name: text(productContext?.product_name || row.product_name || ""),
    product_url: text(productContext?.product_url || row.product_url || ""),
    product_price: text(productContext?.price || productContext?.sale_price || productContext?.selling_price || row.product_price || ""),
    product_link: text(websiteLinks?.product_link || productContext?.product_url || row.product_url || ""),
    checkout_link: text(websiteLinks?.checkout_link || productContext?.checkout_link || row.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    available_sizes: availableSizes,
    stock_status: text(productContext?.stock_status || row.stock_status || (availableSizes.length ? "in_stock" : "")),
    guidance_mode: "website_checkout",
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    post_permalink_url: text(row.post_permalink_url || row.post_permalink || ""),
    conversation_summary: templateContext?.productName ? `Comment automation for ${templateContext.productName}` : text(row.original_comment_text || row.comment_text || ""),
    source_type: "comment_automation",
    source_channel: text(row.channel || (text(row.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
    messenger_profile: {
      id: commenter.commenterId || "",
      name: commenter.commenterName || "",
      profile_pic: commenter.commenterAvatarUrl || "",
      profile_pic_url: commenter.commenterAvatarUrl || "",
    },
    resolved_customer_id: commenter.commenterId || "",
    website_product_link: text(websiteLinks?.product_link || productContext?.product_url || row.product_url || ""),
  };
};

const executeAutomationStep = async ({
  step = "",
  enabled = false,
  statusField = "",
  run = async () => null,
  onSkipped = "",
  stepResults = [],
  stepData = {},
  persistState = async () => null,
} = {}) => {
  const result = { step, status: "skipped", reason: "", ...stepData };
  if (!enabled) {
    result.reason = onSkipped || "disabled";
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    return result;
  }
  try {
    const response = await run();
    result.status = text(response?.status || response?.step_status || stepData?.status || "sent") || "sent";
    result.reason = text(response?.reason || "");
    result.meta = response?.meta && typeof response.meta === "object" ? response.meta : response || null;
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    return result;
  } catch (error) {
    const message = error?.message || `${step} failed`;
    result.status = "failed";
    result.reason = message;
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    if (statusField) {
      await persistState?.(statusField, "failed", message).catch(() => {});
    }
    return result;
  }
};

const executeSocialCommentAutomationRuntime = async ({
  tenantId = null,
  platform = "",
  postId = "",
  commentId = "",
  row = {},
  currentRunId = null,
  productContext = null,
  config = null,
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const normalizedPlatform = text(platform || row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const safePostId = text(postId || row.post_id || "");
  const safeCommentId = text(commentId || row.comment_id || "");
  const safeRow = row || {};
  const safeCurrentRunId = (() => {
    const candidateId = Number(currentRunId || safeRow.id || 0);
    if (!Number.isFinite(candidateId) || candidateId <= 0) return null;
    const looksLikeAutomationRun = Boolean(
      safeRow &&
      typeof safeRow === "object" &&
      (
        Object.prototype.hasOwnProperty.call(safeRow, "status") ||
        Object.prototype.hasOwnProperty.call(safeRow, "step_results") ||
        Object.prototype.hasOwnProperty.call(safeRow, "skipped_reason") ||
        Object.prototype.hasOwnProperty.call(safeRow, "automation_state")
      )
    );
    return looksLikeAutomationRun ? candidateId : null;
  })();
  const safeCurrentCreatedAt = text(safeRow.created_at || safeRow.processed_at || "");
  const runtimeSource = text(safeRow.raw_payload?.source || safeRow.source || "");
  const stepResults = [];
  const currentPrivateReplyStatus = text(safeRow.dm_status || safeRow.automation_state?.private_reply?.status || "").toLowerCase();
  const buildCurrentDiagnostics = ({ skippedReason = "", duplicateReason = "", rawRuntimeContext = null, configOverride = config, productContextOverride = productContext } = {}) =>
    buildAutomationRunDiagnostics({
      row: safeRow,
      config: configOverride || null,
      productContext: productContextOverride || null,
      skippedReason,
      duplicateReason,
      rawRuntimeContext: rawRuntimeContext || buildRuntimeContextSnapshot({
        row: safeRow,
        config: configOverride || null,
        productContext: productContextOverride || null,
        stepResults,
      }),
    });

  if (!safeTenantId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "invalid_tenant" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "invalid_tenant" }],
      errorMessage: "invalid_tenant",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "invalid_tenant",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: null,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "invalid_tenant",
    });
    return { applied: false, skipped: true, reason: "invalid_tenant", row: safeRow, step_results: stepResults };
  }
  if (!safePostId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "post_mismatch" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "post_mismatch" }],
      errorMessage: "post_mismatch",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "post_mismatch",
      comment_id: safeCommentId,
      post_id: null,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || ""),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: null,
      comment_id: safeCommentId,
      reason: "missing_post_id",
    });
    return { applied: false, skipped: true, reason: "missing_post_id", row: safeRow, step_results: stepResults };
  }
  if (!safeCommentId) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "missing_comment_id" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "missing_comment_id" }],
      errorMessage: "missing_comment_id",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "missing_comment_id",
      comment_id: null,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: null,
      reason: "missing_comment_id",
    });
    return { applied: false, skipped: true, reason: "missing_comment_id", row: safeRow, step_results: stepResults };
  }
  if (normalizedPlatform !== "facebook") {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "unsupported_platform" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "unsupported_platform" }],
      errorMessage: "unsupported_platform",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "unsupported_platform",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "unsupported_platform",
    });
    return { applied: false, skipped: true, reason: "unsupported_platform", row: safeRow, step_results: stepResults };
  }

  const existingDuplicateRun = await findSocialCommentAutomationRunByKey({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    commentId: safeCommentId,
    currentRunId: safeCurrentRunId,
    currentCreatedAt: safeCurrentCreatedAt,
  }).catch(() => null);
  const existingDuplicateStatus = text(existingDuplicateRun?.status || "").toLowerCase();
  const isDuplicateCandidate = ["processing", "queued", "success", "partial_success", "failed"].includes(existingDuplicateStatus);
  const isDuplicateRun = Boolean(existingDuplicateRun && isDuplicateCandidate && (!safeCurrentRunId || Number(existingDuplicateRun.id || 0) !== safeCurrentRunId));
  console.info("SOCIAL_COMMENT_AUTOMATION_DEDUPE_CHECK", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    current_run_id: safeCurrentRunId,
    existing_run_id: existingDuplicateRun?.id || null,
    existing_status: existingDuplicateStatus,
    created_at: text(existingDuplicateRun?.created_at || ""),
    private_reply_status: currentPrivateReplyStatus || text(existingDuplicateRun?.dm_status || existingDuplicateRun?.automation_state?.private_reply?.status || ""),
    source: runtimeSource || text(existingDuplicateRun?.raw_payload?.source || existingDuplicateRun?.source || ""),
    is_current_run: Boolean(safeCurrentRunId && existingDuplicateRun && Number(existingDuplicateRun.id || 0) === safeCurrentRunId),
  });
  if (isDuplicateRun) {
    const duplicateStepResults = [{
      step: "automation",
      status: "skipped",
      reason: "duplicate_comment_automation",
      meta: {
        post_id: safePostId,
        comment_id: safeCommentId,
      },
    }];
    await upsertSocialCommentAutomationRunAudit({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "duplicate_skipped",
      skippedReason: "duplicate_comment_automation",
      stepResults: duplicateStepResults,
      productLink: text(existingDuplicateRun.metadata?.product_link || existingDuplicateRun.metadata?.website_product_link || ""),
      checkoutLink: text(existingDuplicateRun.metadata?.checkout_link || ""),
      diagnostics: {
        duplicate_reason: "duplicate_comment_automation",
        skipped_reason: "duplicate_comment_automation",
      },
      row: existingDuplicateRun,
    }).catch(() => {});
    const duplicateDiagnostics = buildAutomationRunDiagnostics({
      row: existingDuplicateRun,
      skippedReason: "duplicate_comment_automation",
      duplicateReason: "duplicate_comment_automation",
      rawRuntimeContext: buildRuntimeContextSnapshot({
        row: existingDuplicateRun,
        config: null,
        productContext: null,
        stepResults: duplicateStepResults,
      }),
    });
    logAutomationSkipReason({
      skipped_reason: "duplicate_comment_automation",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(existingDuplicateRun.post_id || existingDuplicateRun.metadata?.post_id || safePostId),
      config_found: duplicateDiagnostics.config_found,
      config_enabled: duplicateDiagnostics.config_enabled,
      resolved_product_id: duplicateDiagnostics.resolved_product_id,
      duplicate_reason: duplicateDiagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "duplicate_comment_automation",
      duplicate_run_id: existingDuplicateRun.id || null,
    });
    debugSocialCommentsWarn("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "duplicate_comment_automation",
    });
    return {
      applied: false,
      skipped: true,
      duplicate_skipped: true,
      reason: "duplicate_comment_automation",
      row: existingDuplicateRun,
      step_results: duplicateStepResults,
    };
  }

  if (!config) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "no_config" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "no_config" }],
      errorMessage: "no_config",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "no_config",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "no_config",
    });
    return { applied: false, skipped: true, reason: "no_config", row: safeRow, step_results: stepResults };
  }

  if (!config.enabled) {
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "config_disabled" });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      configId: config.id ?? null,
      customerName: safeRow.commenter_name || safeRow.customer_name || "",
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "config_disabled" }],
      errorMessage: "config_disabled",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "config_disabled",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "config_disabled",
    });
    return { applied: false, skipped: true, reason: "config_disabled", row: safeRow, step_results: stepResults };
  }

  if (config.lookup_matched_key && config.lookup_matched_key !== "post_id") {
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_LOOKUP_MATCH", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "post_id_mismatch",
      matched_key: config.lookup_matched_key,
      matched_post_id: config.lookup_matched_post_id || text(config.post_id || ""),
      candidate_post_ids: asArray(config.lookup_candidate_post_ids || []),
    });
  }

  console.log("SOCIAL_POST_IDENTITY_SOURCE_TRACE", {
    ui_post_id: text(config?.post_id || config?.lookup_matched_post_id || ""),
    runtime_post_id: safePostId,
    graph_post_id: text(
      safeRow.raw_graph_post_id ||
      safeRow.raw_payload?.graph_post_id ||
      safeRow.raw_payload?.post?.id ||
      safeRow.raw_payload?.value?.post?.id ||
      safeRow.raw_payload?.value?.graph_post_id ||
      ""
    ),
    permalink: text(
      safeRow.post_permalink_url ||
      safeRow.post_permalink ||
      safeRow.permalink_url ||
      safeRow.raw_payload?.post_permalink_url ||
      safeRow.raw_payload?.post_permalink ||
      safeRow.raw_payload?.permalink_url ||
      safeRow.raw_payload?.post_url ||
      ""
    ),
    endpoint_source: text(
      safeRow.raw_payload?.source ||
      safeRow.source ||
      ""
    ),
  });

  const hasProductContext = hasLinkedProductForAutomation({ row: safeRow, productContext });
  if (hasProductContext && productContext?.source === "sibling_post_mapping") {
    console.log("SOCIAL_COMMENT_AUTOMATION_PRODUCT_RESOLVED_FROM_SIBLING", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      sibling_post_id: text(productContext?.sibling_post_id || ""),
      product_ids: asArray(productContext?.mapped_products || [])
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
      reason: text(productContext?.sibling_match_reason || productContext?.reason || ""),
    });
  }
  const effectiveProductContext = Boolean(productContext?.found) ? productContext : buildFallbackSocialCommentProductContext({ row: safeRow });
  if (!hasProductContext) {
    console.log("SOCIAL_COMMENT_PRODUCT_RESOLUTION_PATH", buildSocialCommentProductResolutionPathPayload({
      row: safeRow,
      productContext,
    }));
    console.log("SOCIAL_COMMENT_SKIPPED_NO_LINKED_PRODUCT", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
    });
    const diagnostics = buildCurrentDiagnostics({ skippedReason: "no_linked_product", productContextOverride: null });
    await upsertSocialCommentAutomationRunSummary({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      configId: config.id ?? null,
      customerName: safeRow.commenter_name || safeRow.customer_name || "",
      status: "skipped",
      stepResults: [{ step: "automation", status: "skipped", reason: "no_linked_product" }],
      errorMessage: "no_linked_product",
      diagnostics,
      row: safeRow,
    }).catch(() => {});
    logAutomationSkipReason({
      skipped_reason: "no_linked_product",
      comment_id: safeCommentId,
      post_id: safePostId,
      platform_post_id: text(safeRow.post_id || safeRow.metadata?.post_id || safeRow.raw_payload?.post_id || safePostId),
      config_found: diagnostics.config_found,
      config_enabled: diagnostics.config_enabled,
      resolved_product_id: diagnostics.resolved_product_id,
      duplicate_reason: diagnostics.duplicate_reason,
    });
    debugSocialCommentsLog("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: safePostId,
      comment_id: safeCommentId,
      reason: "no_linked_product",
    });
    return { applied: false, skipped: true, reason: "no_linked_product", row: safeRow, step_results: stepResults };
  }

  const websiteLinks = await resolveAutomationWebsiteLinks({
    tenantId: safeTenantId,
    row: safeRow,
    productContext: effectiveProductContext || {},
  }).catch(() => ({
    product_link: effectiveProductContext?.product_link || buildAutomationPublicUrl("/shop"),
    product_url: effectiveProductContext?.product_url || buildAutomationPublicUrl("/shop"),
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    available_sizes: asArray(effectiveProductContext?.sizes || safeRow.sizes || safeRow.product_sizes || []).map((value) => text(value)).filter(Boolean),
    stock_status: text(effectiveProductContext?.stock_status || safeRow.stock_status || ""),
  }));
  const templateContext = buildAutomationTemplateContext({ row: safeRow, productContext: effectiveProductContext || {}, websiteLinks });
  const publicReplyTemplate = text(config.message_templates?.publicReplyTemplate || "");
  const privateReplyTemplate = text(config.message_templates?.privateReplyTemplate || "");
  const aiOpeningPrompt = text(config.message_templates?.aiOpeningPrompt || "");
  const renderedAiOpeningPrompt = renderAutomationTemplate(aiOpeningPrompt, templateContext).trim();
  const renderedPublicReply = renderAutomationTemplate(publicReplyTemplate || "تم الرد على حضرتك في الخاص ✅", templateContext).trim() || "تم الرد على حضرتك في الخاص ✅";
  const renderedPrivateReply = renderSocialCommentTemplateText(privateReplyTemplate || buildSocialCommentSuggestedReply({
    classificationLabel: safeRow.classification_label || "",
    commenterName: templateContext.customerName || "",
    originalCommentText: safeRow.original_comment_text || "",
    postPermalink: templateContext.postPermalink || "",
  }), templateContext).trim();
  const salesContext = buildSocialCommentSalesContext({
    row: safeRow,
    productContext: effectiveProductContext || {},
    websiteLinks,
    templateContext,
  });
  console.log("SOCIAL_COMMENT_AI_SALES_CONTEXT", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    product_id: salesContext.product_id ?? null,
    product_name: salesContext.product_name || "",
    brand: salesContext.brand || "",
    price: buildSalesPriceLabel(salesContext),
    stock_status: salesContext.stock_status || "",
    sizes_count: asArray(salesContext.sizes || []).length,
    colors_count: asArray(salesContext.colors || []).length,
    product_url: salesContext.product_url || "",
  });
  const detectedIntent = detectSocialCommentSalesIntent({
    commentText: safeRow.original_comment_text || safeRow.comment_text || "",
  });
  console.log("SOCIAL_COMMENT_AI_INTENT_DETECTED", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    intent: detectedIntent.intent,
    confidence: detectedIntent.confidence,
    matched_pattern: detectedIntent.matched_pattern,
  });
  const salesReplies = buildSocialCommentSalesReplies({
    salesContext,
    intent: detectedIntent.intent,
    fallbackPublicReply: renderedPublicReply,
    fallbackPrivateReply: renderedPrivateReply,
    customerName: templateContext.customerName || "",
  });
  const productAwarePublicReply = buildProductAwarePublicReply({
    salesContext,
    intent: detectedIntent.intent,
  });
  const initialRenderedPublicReply = text(salesReplies.public_reply || renderedPublicReply);
  if (hasProductContext && isGenericSocialCommentPublicReply(initialRenderedPublicReply)) {
    console.warn("SOCIAL_COMMENT_AUTO_REPLY_PRODUCT_CONTEXT_DROPPED", {
      post_id: safePostId,
      comment_id: safeCommentId,
      product_ids: asArray(effectiveProductContext?.mapped_products || [])
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
      reply_preview: initialRenderedPublicReply,
    });
  }
  const effectiveRenderedPublicReply = text(
    hasProductContext && isGenericSocialCommentPublicReply(initialRenderedPublicReply) && productAwarePublicReply
      ? productAwarePublicReply
      : initialRenderedPublicReply
  );
  const effectiveRenderedPrivateReply = text(salesReplies.private_reply || renderedPrivateReply);
  const aiSalesRuntime = {
    intent: detectedIntent.intent,
    confidence: detectedIntent.confidence,
    matched_pattern: detectedIntent.matched_pattern,
    public_reply: effectiveRenderedPublicReply,
    private_reply: effectiveRenderedPrivateReply,
    approval_status: "generated",
    delivery_status: "generated",
    used_fallback: Boolean(salesReplies.used_fallback),
  };
  console.log("SOCIAL_COMMENT_AI_REPLY_GENERATED", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    intent: aiSalesRuntime.intent,
    used_fallback: aiSalesRuntime.used_fallback,
    public_reply: effectiveRenderedPublicReply,
    private_reply: effectiveRenderedPrivateReply,
  });
  console.log("SOCIAL_COMMENT_AUTO_REPLY_CONTEXT_USED", {
    post_id: safePostId,
    comment_id: safeCommentId,
    reply_channel: "public_comment",
    has_product_context: hasProductContext,
    product_ids: asArray(effectiveProductContext?.mapped_products || [])
      .map((item) => Number(item?.product_id || item?.id || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
    reply_preview: effectiveRenderedPublicReply,
  });
  const automationCommenter = resolveAutomationCommenterIdentity(safeRow);
  const automationWebsiteProductLink = text(websiteLinks?.product_link || templateContext.product_link || templateContext.productUrl || "");
  const automationWebsiteCheckoutLink = text(websiteLinks?.checkout_link || templateContext.checkout_link || "");
  const websiteCheckoutGuidance = renderAutomationTemplate(
    "أهلًا {{customer_name}}\n{{product_name}} متاح بسعر {{price}}.\nالمقاسات المتاحة: {{available_sizes}}\nاطلبه مباشرة من هنا: {{product_link}}",
    templateContext
  ).trim();
  const automationRuntimeContext = {
    conversation: null,
    profile: null,
    lead: null,
    websiteProductLink: automationWebsiteProductLink || templateContext.productUrl || "",
  };

  console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_START", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    enabled: true,
    config_enabled: Boolean(config.enabled),
    template_key: text(config.template_key || ""),
    product_id: config.product_id || null,
    product_found: hasProductContext,
    matched_key: config.lookup_matched_key || "post_id",
  });

  const persistedRuntimeState = {
    ...(safeRow.automation_state || {}),
    social_comment_runtime: {
      enabled: true,
      template_key: text(config.template_key || ""),
      product_id: config.product_id || null,
      product_found: hasProductContext,
      post_id: safePostId,
      platform: normalizedPlatform,
      ai_opening_prompt: renderedAiOpeningPrompt || aiOpeningPrompt,
      sales_context: salesContext,
      ai_sales: aiSalesRuntime,
      message_templates: {
        publicReplyTemplate,
        privateReplyTemplate,
        aiOpeningPrompt,
      },
      updated_at: new Date().toISOString(),
    },
    public_reply: {
      ...(safeRow.automation_state?.public_reply || {}),
      template: publicReplyTemplate,
      rendered_reply: effectiveRenderedPublicReply,
      intent: aiSalesRuntime.intent,
    },
    private_reply: {
      ...(safeRow.automation_state?.private_reply || {}),
      template: privateReplyTemplate,
      rendered_reply: effectiveRenderedPrivateReply,
      intent: aiSalesRuntime.intent,
    },
  };

  const persistRuntimeState = async (statePatch = {}) => persistSocialCommentAutomationState({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    commentId: safeCommentId,
    sessionId: text(safeRow.inbox_conversation_id || ""),
    channel: text(safeRow.channel || ""),
    dmStatus: statePatch.dmStatus || "",
    likeStatus: statePatch.likeStatus || "",
    publicReplyStatus: statePatch.publicReplyStatus || "",
    errorCode: statePatch.errorCode || "",
    automationState: statePatch.automationState || {},
  });

  let workingRow = {
    ...safeRow,
    automation_state: persistedRuntimeState,
  };

  const likeEnabled = Boolean(config.settings?.likeComment);
  const publicReplyEnabled = Boolean(config.settings?.publicReply);
  const privateReplyEnabled = Boolean(config.settings?.privateReply);
  const aiFollowUpEnabled = Boolean(config.settings?.aiFollowUp);
  const createLeadEnabled = Boolean(config.settings?.createLead);

  if (likeEnabled) {
    await executeAutomationStep({
      step: "likeComment",
      enabled: true,
      stepResults,
      stepData: { status: "sent" },
      persistState: async () => persistRuntimeState({
        likeStatus: "sent",
        automationState: {
          ...persistedRuntimeState,
          like_status: "sent",
        },
      }),
      run: async () => {
        await likeComment(normalizedPlatform, safeCommentId, safeTenantId);
        workingRow.like_status = "sent";
        persistedRuntimeState.like_status = "sent";
        await persistRuntimeState({
          likeStatus: "sent",
          automationState: {
            ...persistedRuntimeState,
            like_status: "sent",
          },
        }).catch(() => {});
        return { ok: true };
      },
    });
  } else {
    const result = { step: "likeComment", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  }

  if (publicReplyEnabled) {
    await executeAutomationStep({
      step: "publicReply",
      enabled: true,
      stepResults,
      run: async () => {
        await replyToComment(normalizedPlatform, safeCommentId, effectiveRenderedPublicReply, safeTenantId);
        workingRow.public_reply_status = "sent";
        persistedRuntimeState.public_reply = {
          ...(persistedRuntimeState.public_reply || {}),
          status: "sent",
          rendered_reply: effectiveRenderedPublicReply,
          sent_at: new Date().toISOString(),
        };
        aiSalesRuntime.approval_status = "sent";
        aiSalesRuntime.delivery_status = "sent_public_reply";
        persistedRuntimeState.social_comment_runtime.ai_sales = aiSalesRuntime;
        await persistRuntimeState({
          publicReplyStatus: "sent",
          automationState: persistedRuntimeState,
        }).catch(() => {});
        return { ok: true };
      },
    });
  } else {
    const result = { step: "publicReply", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  }

  const privateReplySkippedReason = ["queued", "sending"].includes(currentPrivateReplyStatus)
    ? `private_reply_status_${currentPrivateReplyStatus}`
    : "";
  if (!privateReplyEnabled) {
    const result = { step: "privateReply", status: "skipped", reason: "disabled" };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
  } else if (privateReplySkippedReason) {
    const result = { step: "privateReply", status: "skipped", reason: privateReplySkippedReason };
    stepResults.push(result);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", result);
    } else {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_BEFORE", {
        tenant_id: safeTenantId,
        platform: normalizedPlatform,
        post_id: safePostId,
        comment_id: safeCommentId,
        loaded_template: privateReplyTemplate,
        rendered_template: effectiveRenderedPrivateReply,
        enqueue_template: effectiveRenderedPrivateReply,
      });
      const queuedAt = new Date().toISOString();
      workingRow.dm_status = "queued";
      persistedRuntimeState.private_reply = {
        ...(persistedRuntimeState.private_reply || {}),
        status: "queued",
        queued_at: queuedAt,
        template: privateReplyTemplate,
        message: effectiveRenderedPrivateReply,
        rendered_reply: effectiveRenderedPrivateReply,
      };
    workingRow.product_context = effectiveProductContext || {};
    workingRow.raw_payload = {
      ...(workingRow.raw_payload || {}),
      product_context: effectiveProductContext || {},
    };
    workingRow.automation_state = persistedRuntimeState;
    aiSalesRuntime.approval_status = "queued";
    aiSalesRuntime.delivery_status = "pending_private_reply";
    persistedRuntimeState.social_comment_runtime.ai_sales = aiSalesRuntime;
    await persistRuntimeState({
      dmStatus: "queued",
      automationState: persistedRuntimeState,
    }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_PAYLOAD", buildPrivateReplyEnqueuePayloadLog({
        row: workingRow,
        productContext: effectiveProductContext || {},
      }));
      await enqueueSocialCommentPrivateReplyJob({
        tenantId: safeTenantId,
        platform: normalizedPlatform,
        commentId: safeCommentId,
        postId: safePostId,
        row: workingRow,
      }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_AFTER", {
        tenant_id: safeTenantId,
        platform: normalizedPlatform,
        post_id: safePostId,
        comment_id: safeCommentId,
        enqueue_template: effectiveRenderedPrivateReply,
      });
      stepResults.push({
        step: "privateReply",
        status: "queued",
        reason: "enqueued_to_worker",
      message: effectiveRenderedPrivateReply,
    });
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", {
      step: "privateReply",
      status: "queued",
      reason: "enqueued_to_worker",
      message: effectiveRenderedPrivateReply,
    });
  }

  if (aiFollowUpEnabled) {
    const aiFollowUpResult = await executeAutomationStep({
      step: "aiFollowUp",
      enabled: true,
      stepResults,
      stepData: { status: "linked" },
      run: async () => {
        const profileMetadata = buildAutomationProfileMetadata({
          row: {
            ...safeRow,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          productContext: effectiveProductContext || {},
          templateContext,
          websiteLinks,
        });
        const aiProfile = await upsertAiCustomerProfile({
          tenantId: safeTenantId,
          sessionId: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          metadata: profileMetadata,
          message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.commenter_name || ""),
          response: {
            answer: text(websiteCheckoutGuidance),
            detected_intent: "comment_automation_follow_up",
            confidence: 0.92,
            suggested_products: hasProductContext ? [productContext] : [],
            ai_order: null,
          },
        });
        const conversationRow = await upsertAutomationInboxConversation({
          tenantId: safeTenantId,
          platform: normalizedPlatform,
          row: {
            ...safeRow,
            channel: text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
            last_message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
            thread_kind: "comment",
            comment_id: safeCommentId,
            post_id: safePostId,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
            product_id: effectiveProductContext?.product_id || safeRow.product_id || "",
            product_name: effectiveProductContext?.product_name || safeRow.product_name || "",
            product_url: automationWebsiteProductLink || templateContext.productUrl || "",
          },
          productContext: effectiveProductContext || {},
          websiteProductLink: automationWebsiteProductLink || templateContext.productUrl || "",
          checkoutLink: automationWebsiteCheckoutLink || "",
          aiHandling: true,
          leadStatus: "new",
          customerProfileId: aiProfile?.id || null,
          customerName: automationCommenter.commenterName || safeRow.commenter_name || "",
          customerAvatarUrl: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
        });
        automationRuntimeContext.profile = aiProfile || null;
        automationRuntimeContext.conversation = conversationRow || null;
        if (conversationRow?.customer_profile_id && aiProfile?.id && Number(conversationRow.customer_profile_id) !== Number(aiProfile.id)) {
          await db.query(
            `
            UPDATE ai_channel_conversations
            SET customer_profile_id = $4::bigint,
                metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                updated_at = NOW()
            WHERE tenant_id = $1::bigint
              AND channel = $2::text
              AND external_conversation_id = $3::text
            `,
            [
              safeTenantId,
              text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
              text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
                platform: normalizedPlatform,
                postId: safePostId,
                rootCommentId: safeRow.root_comment_id || safeCommentId,
                commentId: safeCommentId,
              })),
              aiProfile.id,
              JSON.stringify({
                ai_follow_up: true,
                ai_follow_up_status: "linked",
                ai_follow_up_conversation_id: text(conversationRow?.external_conversation_id || ""),
                website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
              }),
            ]
          ).catch(() => {});
        }
        return {
          status: conversationRow?.inserted ? "created" : "linked",
          reason: conversationRow?.inserted ? "conversation_created" : "conversation_linked",
          meta: {
            conversation_id: text(conversationRow?.external_conversation_id || ""),
            conversation_db_id: conversationRow?.id || null,
            customer_profile_id: aiProfile?.id || conversationRow?.customer_profile_id || null,
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          },
        };
      },
    });
  } else {
    const aiFollowUpResult = { step: "aiFollowUp", status: "skipped", reason: "disabled" };
    stepResults.push(aiFollowUpResult);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", aiFollowUpResult);
  }

  if (createLeadEnabled) {
    const createLeadResult = await executeAutomationStep({
      step: "createLead",
      enabled: true,
      stepResults,
      stepData: { status: "created" },
      run: async () => {
        const profileMetadata = buildAutomationProfileMetadata({
          row: {
            ...safeRow,
            commenter_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            commenter_name: automationCommenter.commenterName || safeRow.commenter_name || "",
            commenter_profile_picture_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          productContext: effectiveProductContext || {},
          templateContext,
          websiteLinks,
        });
        const leadProfile = automationRuntimeContext.profile || await upsertAiCustomerProfile({
          tenantId: safeTenantId,
          sessionId: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          metadata: profileMetadata,
          message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.commenter_name || ""),
          response: {
            answer: text(websiteCheckoutGuidance),
            detected_intent: "comment_automation_lead",
            confidence: 0.91,
            suggested_products: hasProductContext ? [productContext] : [],
            ai_order: null,
          },
        });
        const conversationForLead = automationRuntimeContext.conversation || {
          tenant_id: safeTenantId,
          channel: text(safeRow.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
          session_id: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          external_conversation_id: text(safeRow.inbox_conversation_id || safeRow.session_id || socialCommentConversationId({
            platform: normalizedPlatform,
            postId: safePostId,
            rootCommentId: safeRow.root_comment_id || safeCommentId,
            commentId: safeCommentId,
          })),
          external_customer_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
          customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          customer_avatar_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          customer_profile: {
            id: leadProfile?.id || null,
            name: automationCommenter.commenterName || safeRow.commenter_name || "",
            external_customer_id: automationCommenter.commenterId || safeRow.commenter_id || safeCommentId,
            avatar_url: automationCommenter.commenterAvatarUrl || safeRow.commenter_profile_picture_url || "",
          },
          latest_message_preview: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
          last_message: text(safeRow.original_comment_text || safeRow.comment_text || safeRow.last_message || ""),
          lead_status: "new_lead",
          channel_metadata: {
            ...(safeRow.metadata || {}),
            source_type: "comment_automation",
            source: "comment_automation",
            platform: normalizedPlatform,
            post_id: safePostId,
            comment_id: safeCommentId,
            product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            checkout_link: automationWebsiteCheckoutLink || "",
            available_sizes: websiteLinks?.available_sizes || [],
            stock_status: websiteLinks?.stock_status || "",
            guidance_mode: "website_checkout",
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            lead_state: "new_lead",
            lead_status: "new_lead",
          },
        };
        const leadOpportunity = await createOrUpdateLeadOpportunity({
          tenantId: safeTenantId,
          conversation: conversationForLead,
          profile: leadProfile,
        });
        await db.query(
          `
          UPDATE ai_channel_conversations
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
              lead_status = COALESCE(NULLIF($5::text, ''), lead_status),
              customer_profile_id = COALESCE($6::bigint, customer_profile_id),
              updated_at = NOW()
          WHERE tenant_id = $1::bigint
            AND channel = $2::text
            AND external_conversation_id = $3::text
          `,
          [
            safeTenantId,
            text(conversationForLead.channel || (normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment")),
            text(conversationForLead.external_conversation_id || ""),
            JSON.stringify({
              lead_opportunity_id: leadOpportunity?.id || null,
              lead_opportunity_status: leadOpportunity?.status || "open",
              lead_status: "new_lead",
              ai_follow_up: Boolean(aiFollowUpEnabled),
              create_lead: true,
              product_link: automationWebsiteProductLink || templateContext.productUrl || "",
              checkout_link: automationWebsiteCheckoutLink || "",
              website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            }),
            "new",
            leadProfile?.id || null,
          ]
        ).catch(() => {});
        automationRuntimeContext.profile = leadProfile || automationRuntimeContext.profile || null;
        automationRuntimeContext.lead = leadOpportunity || null;
        return {
          status: leadOpportunity?.id ? "created" : "linked",
          reason: leadOpportunity?.id ? "lead_created" : "lead_linked",
          meta: {
            lead_id: leadOpportunity?.id || null,
            profile_id: leadProfile?.id || null,
            conversation_id: text(conversationForLead.external_conversation_id || ""),
            lead_status: leadOpportunity?.status || "open",
            website_product_link: automationWebsiteProductLink || templateContext.productUrl || "",
            customer_name: automationCommenter.commenterName || safeRow.commenter_name || "",
          },
        };
      },
    });
  } else {
    const createLeadResult = { step: "createLead", status: "skipped", reason: "disabled" };
    stepResults.push(createLeadResult);
    console.log("SOCIAL_COMMENT_AUTOMATION_STEP_RESULT", createLeadResult);
  }

  const summary = summarizeAutomationStepResults(stepResults);
  const hasExecutedStep = stepResults.some((item) => ["sent", "queued", "failed", "created", "linked", "success"].includes(text(item?.status || "")));
  const finalStatus = !hasProductContext && hasExecutedStep && summary.status === "success"
    ? "partial_success"
    : summary.status;
  await upsertSocialCommentAutomationRunSummary({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    commentId: safeCommentId,
    configId: config.id ?? null,
    customerName: templateContext.customerName || safeRow.commenter_name || safeRow.customer_name || "",
    status: finalStatus,
    stepResults,
    errorMessage: summary.errorMessage,
    diagnostics: {
      config,
      product_context: effectiveProductContext,
      raw_runtime_context: buildRuntimeContextSnapshot({
        row: safeRow,
        config,
        productContext: effectiveProductContext,
        stepResults,
        summary,
        salesContext,
        aiSales: aiSalesRuntime,
      }),
    },
    row: {
      ...safeRow,
      automation_state: persistedRuntimeState,
      status: finalStatus,
      error_message: summary.errorMessage,
      product_link: automationWebsiteProductLink || templateContext.productUrl || "",
      checkout_link: automationWebsiteCheckoutLink || "",
      guidance_mode: "website_checkout",
      skipped_reason: finalStatus === "skipped" ? text(safeRow.skipped_reason || "") : "",
    },
  }).catch(() => {});

  console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_DONE", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    step_results: stepResults,
  });
  console.log("SOCIAL_COMMENT_AI_REPLY_APPLIED", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    comment_id: safeCommentId,
    intent: aiSalesRuntime.intent,
    approval_status: aiSalesRuntime.approval_status,
    delivery_status: aiSalesRuntime.delivery_status,
    public_reply_status: workingRow.public_reply_status || "",
    private_reply_status: workingRow.dm_status || "",
  });

  return {
    applied: true,
    skipped: false,
    row: workingRow,
    step_results: stepResults,
    config,
  };
};

export const resolveSocialCommentPublishedProductContext = async ({ tenantId = null, row = {} } = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const platform = text(row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const initialPostId = text(
    row.post_id ||
    row.metadata?.post_id ||
    row.raw_payload?.post_id ||
    row.raw_payload?.value?.post_id ||
    row.raw_payload?.value?.media_id ||
    row.raw_payload?.value?.post?.id ||
    row.raw_payload?.value?.post?.post_id ||
    row.raw_payload?.value?.id ||
    ""
  );
  let directProductIdsCount = 0;
  let siblingProductIdsCount = 0;
  let triedSiblingLookup = false;
  console.log("SOCIAL_COMMENT_CONTEXT_ENTER", {
    tenant_id: safeTenantId,
    platform,
    post_id: initialPostId,
    comment_id: text(row.comment_id || ""),
  });
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || platform !== "facebook") {
    console.log("SOCIAL_COMMENT_CONTEXT_EARLY_RETURN", {
      reason: !Number.isFinite(safeTenantId) || safeTenantId <= 0 ? "invalid_tenant" : "non_facebook_platform",
      tenant_id: safeTenantId,
      platform,
      post_id: initialPostId,
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: triedSiblingLookup,
    });
    return {
      found: false,
      source: "unsupported",
      reason: !Number.isFinite(safeTenantId) || safeTenantId <= 0 ? "invalid_tenant" : "non_facebook_platform",
      platform,
      candidate_post_ids: [],
      direct_product_ids_count: 0,
      tried_sibling_lookup: false,
      sibling_product_ids_count: 0,
      final_product_ids_count: 0,
      path: "unsupported",
    };
  }

  const candidatePostIds = [...new Set([
    row.post_id,
    row.metadata?.post_id,
    row.raw_payload?.post_id,
    row.raw_payload?.value?.post_id,
    row.raw_payload?.value?.media_id,
    row.raw_payload?.value?.post?.id,
    row.raw_payload?.value?.post?.post_id,
    row.raw_payload?.value?.id,
  ].map(text).filter(Boolean))];

  if (!candidatePostIds.length) {
    console.log("SOCIAL_COMMENT_CONTEXT_EARLY_RETURN", {
      reason: "missing_post_id",
      tenant_id: safeTenantId,
      platform,
      post_id: initialPostId,
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: triedSiblingLookup,
    });
    return {
      found: false,
      source: "missing_post_id",
      reason: "missing_post_id",
      platform,
      candidate_post_ids: [],
      direct_product_ids_count: 0,
      tried_sibling_lookup: false,
      sibling_product_ids_count: 0,
      final_product_ids_count: 0,
      path: "missing_post_id",
    };
  }

  const mappedProducts = await resolveMappedProductsV2({
    tenantId: safeTenantId,
    platform,
    postId: candidatePostIds[0] || "",
    row,
    post: row,
  }).catch(() => []);
  directProductIdsCount = mappedProducts.length;
  if (mappedProducts.length) {
    const primaryMappedProduct = await resolvePrimaryProductV2({
      tenantId: safeTenantId,
      platform,
      postId: candidatePostIds[0] || "",
      row,
      post: row,
    }).catch(() => null) || mappedProducts[0];
    const directProductIds = [...new Set(mappedProducts
      .map((item) => Number(item?.product_id || item?.id || 0))
      .filter((value) => Number.isFinite(value) && value > 0))];
    const normalizedMappedProducts = mappedProducts.map((item) => ({
      ...item,
      product_id: text(item?.product_id || item?.id || ""),
      name: text(item?.name || item?.product_name || item?.title || ""),
      title: text(item?.title || item?.name || item?.product_name || ""),
      product_name: text(item?.product_name || item?.name || item?.title || ""),
      final_price: text(item?.final_price || item?.sale_price || item?.selling_price || item?.price || ""),
      sale_price: text(item?.sale_price || ""),
      selling_price: text(item?.selling_price || item?.price || ""),
      price: text(item?.price || item?.sale_price || item?.selling_price || ""),
      available_sizes: Array.isArray(item?.available_sizes) ? item.available_sizes : [],
      available_colors: Array.isArray(item?.available_colors) ? item.available_colors : [],
      product_url: text(item?.product_url || item?.storefront_url || ""),
      storefront_url: text(item?.storefront_url || item?.product_url || ""),
      product_link: text(item?.product_link || item?.product_url || item?.storefront_url || ""),
    }));
    const primaryLink = await resolveStorefrontProductLink({
      tenantId: safeTenantId,
      product: {
        id: primaryMappedProduct?.product_id || primaryMappedProduct?.id || null,
        product_id: primaryMappedProduct?.product_id || primaryMappedProduct?.id || null,
        name: primaryMappedProduct?.name || primaryMappedProduct?.product_name || "",
        price: primaryMappedProduct?.price || "",
        sale_price: primaryMappedProduct?.sale_price || "",
        selling_price: primaryMappedProduct?.selling_price || "",
        slug: primaryMappedProduct?.slug || "",
        canonical_slug: primaryMappedProduct?.canonical_slug || "",
      },
    }).catch(() => ({ product_url: "" }));
    const directProductContext = {
      found: true,
      has_product_context: true,
      source: "social_post_product_links_v2",
      reason: "mapped_products",
      platform,
      post_id: text(primaryMappedProduct?.platform_post_id || candidatePostIds[0] || ""),
      product_id: text(primaryMappedProduct?.product_id || primaryMappedProduct?.id || ""),
      product_ids: directProductIds,
      product_name: text(primaryMappedProduct?.name || primaryMappedProduct?.product_name || primaryMappedProduct?.title || ""),
      name: text(primaryMappedProduct?.name || primaryMappedProduct?.product_name || primaryMappedProduct?.title || ""),
      title: text(primaryMappedProduct?.title || primaryMappedProduct?.name || primaryMappedProduct?.product_name || ""),
      final_price: text(primaryMappedProduct?.final_price || primaryMappedProduct?.sale_price || primaryMappedProduct?.selling_price || primaryMappedProduct?.price || ""),
      price: text(primaryMappedProduct?.price || primaryMappedProduct?.sale_price || primaryMappedProduct?.selling_price || ""),
      sale_price: text(primaryMappedProduct?.sale_price || ""),
      selling_price: text(primaryMappedProduct?.selling_price || primaryMappedProduct?.price || ""),
      sizes: Array.isArray(primaryMappedProduct?.available_sizes) ? primaryMappedProduct.available_sizes : [],
      available_sizes: Array.isArray(primaryMappedProduct?.available_sizes) ? primaryMappedProduct.available_sizes : [],
      colors: Array.isArray(primaryMappedProduct?.available_colors) ? primaryMappedProduct.available_colors : [],
      available_colors: Array.isArray(primaryMappedProduct?.available_colors) ? primaryMappedProduct.available_colors : [],
      stock_status: text(primaryMappedProduct?.stock_status || (Number(primaryMappedProduct?.stock || 0) > 0 ? "in_stock" : "out_of_stock")),
      product_link: text(primaryMappedProduct?.product_link || primaryLink?.product_url || primaryLink?.url || primaryMappedProduct?.product_url || primaryMappedProduct?.storefront_url || ""),
      product_url: text(primaryMappedProduct?.product_url || primaryLink?.product_url || primaryLink?.url || primaryMappedProduct?.storefront_url || ""),
      storefront_url: text(primaryMappedProduct?.storefront_url || primaryMappedProduct?.product_url || primaryLink?.product_url || primaryLink?.url || ""),
      variant_id: "",
      color: "",
      size: "",
      mapped_media_id: "",
      candidate_post_ids: candidatePostIds,
      mapped_products: normalizedMappedProducts,
      linked_products_count: normalizedMappedProducts.length,
      primary_product: {
        ...primaryMappedProduct,
        product_id: text(primaryMappedProduct?.product_id || primaryMappedProduct?.id || ""),
        name: text(primaryMappedProduct?.name || primaryMappedProduct?.product_name || primaryMappedProduct?.title || ""),
        title: text(primaryMappedProduct?.title || primaryMappedProduct?.name || primaryMappedProduct?.product_name || ""),
        product_name: text(primaryMappedProduct?.product_name || primaryMappedProduct?.name || primaryMappedProduct?.title || ""),
        final_price: text(primaryMappedProduct?.final_price || primaryMappedProduct?.sale_price || primaryMappedProduct?.selling_price || primaryMappedProduct?.price || ""),
        price: text(primaryMappedProduct?.price || primaryMappedProduct?.sale_price || primaryMappedProduct?.selling_price || ""),
        sale_price: text(primaryMappedProduct?.sale_price || ""),
        selling_price: text(primaryMappedProduct?.selling_price || primaryMappedProduct?.price || ""),
        available_sizes: Array.isArray(primaryMappedProduct?.available_sizes) ? primaryMappedProduct.available_sizes : [],
        available_colors: Array.isArray(primaryMappedProduct?.available_colors) ? primaryMappedProduct.available_colors : [],
        product_link: text(primaryMappedProduct?.product_link || primaryLink?.product_url || primaryLink?.url || primaryMappedProduct?.product_url || primaryMappedProduct?.storefront_url || ""),
        product_url: text(primaryMappedProduct?.product_url || primaryLink?.product_url || primaryLink?.url || primaryMappedProduct?.storefront_url || ""),
        storefront_url: text(primaryMappedProduct?.storefront_url || primaryMappedProduct?.product_url || primaryLink?.product_url || primaryLink?.url || ""),
      },
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: false,
      sibling_product_ids_count: 0,
      final_product_ids_count: normalizedMappedProducts.length,
      path: "direct_mapped_products",
    };
    console.log("SOCIAL_COMMENT_CONTEXT_EARLY_RETURN", {
      reason: "mapped_products",
      tenant_id: safeTenantId,
      platform,
      post_id: text(candidatePostIds[0] || initialPostId),
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: triedSiblingLookup,
    });
    return directProductContext;
  }

  triedSiblingLookup = true;
  console.log("POST_PRODUCT_LINKS_SIBLING_LOOKUP_START", {
    tenant_id: safeTenantId,
    platform,
    post_id: text(candidatePostIds[0] || ""),
    comment_id: text(row.comment_id || ""),
    direct_product_ids_count: directProductIdsCount,
  });
  const siblingMappings = null;
  siblingProductIdsCount = Array.isArray(siblingMappings?.linked_products) ? siblingMappings.linked_products.length : 0;
  if (siblingMappings?.linked_products?.length) {
    const primaryMappedProduct = siblingMappings.primary_product || siblingMappings.linked_products[0] || null;
    return {
      found: true,
      source: "sibling_post_mapping",
      reason: text(siblingMappings.sibling_match_reason || "sibling_mapping"),
      platform,
      post_id: text(siblingMappings.sibling_post_id || primaryMappedProduct?.platform_post_id || candidatePostIds[0] || ""),
      product_id: text(primaryMappedProduct?.product_id || primaryMappedProduct?.id || ""),
      product_name: text(primaryMappedProduct?.name || ""),
      price: text(primaryMappedProduct?.sale_price || primaryMappedProduct?.price || ""),
      sale_price: text(primaryMappedProduct?.sale_price || ""),
      selling_price: text(primaryMappedProduct?.selling_price || primaryMappedProduct?.price || ""),
      sizes: Array.isArray(primaryMappedProduct?.available_sizes) ? primaryMappedProduct.available_sizes : [],
      available_sizes: Array.isArray(primaryMappedProduct?.available_sizes) ? primaryMappedProduct.available_sizes : [],
      colors: Array.isArray(primaryMappedProduct?.available_colors) ? primaryMappedProduct.available_colors : [],
      available_colors: Array.isArray(primaryMappedProduct?.available_colors) ? primaryMappedProduct.available_colors : [],
      stock_status: text(primaryMappedProduct?.stock_status || (Number(primaryMappedProduct?.stock || 0) > 0 ? "in_stock" : "out_of_stock")),
      product_url: text(primaryMappedProduct?.product_url || primaryMappedProduct?.storefront_url || ""),
      storefront_url: text(primaryMappedProduct?.storefront_url || primaryMappedProduct?.product_url || ""),
      image_url: text(primaryMappedProduct?.image_url || ""),
      candidate_post_ids: candidatePostIds,
      mapped_products: siblingMappings.linked_products,
      linked_products_count: siblingMappings.linked_products.length,
      primary_product: primaryMappedProduct,
      sibling_post_id: text(siblingMappings.sibling_post_id || ""),
      sibling_match_reason: text(siblingMappings.sibling_match_reason || ""),
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: triedSiblingLookup,
      sibling_product_ids_count: siblingProductIdsCount,
      final_product_ids_count: siblingProductIdsCount,
      path: "sibling_post_mapping",
    };
  }

  const buildProductContext = async (productRow = {}, source = "") => {
    if (!productRow) return null;
    const product = {
      id: productRow.product_id || null,
      product_id: productRow.product_id || null,
      name: productRow.product_name || "",
      price: productRow.product_price || "",
      sale_price: productRow.product_sale_price || "",
      selling_price: productRow.product_selling_price || "",
      slug: productRow.product_slug || "",
      canonical_slug: productRow.product_canonical_slug || "",
    };
    const link = await resolveStorefrontProductLink({ tenantId: safeTenantId, product }).catch(() => ({ product_url: "" }));
    const stockCount = Number(productRow.product_stock || 0);
    const sizes = text(productRow.product_sizes || "")
      .split(",")
      .map((value) => text(value))
      .filter(Boolean);
    const colors = text(productRow.product_colors || "")
      .split(",")
      .map((value) => text(value))
      .filter(Boolean);
    return {
      found: true,
      source,
      platform,
      post_id: text(productRow.mapped_post_id || candidatePostIds[0] || ""),
      product_id: text(productRow.product_id || ""),
      product_name: text(productRow.product_name || ""),
      price: text(productRow.product_sale_price || productRow.product_price || ""),
      sale_price: text(productRow.product_sale_price || ""),
      selling_price: text(productRow.product_selling_price || productRow.product_price || ""),
      sizes,
      available_sizes: sizes,
      colors,
      stock_status: stockCount > 0 ? "in_stock" : "out_of_stock",
      product_url: text(link?.product_url || link?.url || ""),
      variant_id: text(productRow.variant_id || row.raw_payload?.variant_id || row.variant_id || ""),
      color: text(productRow.color || row.raw_payload?.color || row.color || ""),
      size: text(productRow.size || row.raw_payload?.size || row.size || ""),
      mapped_media_id: text(productRow.mapped_media_id || ""),
      candidate_post_ids: candidatePostIds,
      direct_product_ids_count: directProductIdsCount,
      tried_sibling_lookup: triedSiblingLookup,
      sibling_product_ids_count: siblingProductIdsCount,
      final_product_ids_count: 1,
      path: source,
    };
  };

  const linkResult = await db.query(
    `
    SELECT
      ppl.product_id,
      ppl.post_id AS mapped_post_id,
      NULL::text AS mapped_media_id,
      p.name AS product_name,
      p.price AS product_price,
      p.sale_price AS product_sale_price,
      p.selling_price AS product_selling_price,
      COALESCE(p.stock, 0) AS product_stock,
      p.slug AS product_slug,
      p.canonical_slug AS product_canonical_slug,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
        FROM product_variants v
        WHERE v.tenant_id = ppl.business_id
          AND v.product_id = ppl.product_id
      ), '') AS product_sizes,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
        FROM product_variants v
        WHERE v.tenant_id = ppl.business_id
          AND v.product_id = ppl.product_id
      ), '') AS product_colors
    FROM social_post_product_links_v2 ppl
    LEFT JOIN products p ON p.id = ppl.product_id
    WHERE ppl.business_id = $1::bigint
      AND ppl.platform = $2::text
      AND ppl.post_link_key = ANY($3::text[])
    ORDER BY ppl.created_at DESC, ppl.id DESC
    LIMIT 1
    `,
    [safeTenantId, platform, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  const linkedContext = await buildProductContext(linkResult.rows?.[0] || null, "social_post_product_links_v2");
  if (linkedContext) return linkedContext;

  const postResult = await db.query(
    `
    SELECT
      mp.product_id,
      COALESCE(NULLIF(mp.platform_post_id, ''), NULLIF(mp.external_post_id, '')) AS mapped_post_id,
      COALESCE(NULLIF(mp.platform_post_id, ''), NULLIF(mp.external_post_id, '')) AS mapped_media_id,
      p.name AS product_name,
      p.price AS product_price,
      p.sale_price AS product_sale_price,
      p.selling_price AS product_selling_price,
      COALESCE(p.stock, 0) AS product_stock,
      p.slug AS product_slug,
      p.canonical_slug AS product_canonical_slug,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
        FROM product_variants v
        WHERE v.tenant_id = mp.tenant_id
          AND v.product_id = mp.product_id
      ), '') AS product_sizes,
      COALESCE((
        SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
        FROM product_variants v
        WHERE v.tenant_id = mp.tenant_id
          AND v.product_id = mp.product_id
      ), '') AS product_colors,
      NULL::bigint AS variant_id,
      NULL::text AS color,
      NULL::text AS size
    FROM marketing_posts mp
    LEFT JOIN products p ON p.id = mp.product_id
    WHERE mp.tenant_id = $1::bigint
      AND mp.product_id IS NOT NULL
      AND (
        mp.platform_post_id = ANY($2::text[])
        OR mp.external_post_id = ANY($2::text[])
      )
    ORDER BY mp.updated_at DESC, mp.created_at DESC, mp.id DESC
    LIMIT 1
    `,
    [safeTenantId, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  const postContext = await buildProductContext(postResult.rows?.[0] || null, "marketing_posts");
  if (postContext) return postContext;

  return {
    found: false,
    source: "social_post_product_links_v2",
    reason: "product_not_found",
    platform,
    candidate_post_ids: candidatePostIds,
    direct_product_ids_count: directProductIdsCount,
    tried_sibling_lookup: triedSiblingLookup,
    sibling_product_ids_count: siblingProductIdsCount,
    final_product_ids_count: 0,
    path: "product_not_found",
  };
};

export const enqueueSocialCommentPrivateReplyJob = async ({ tenantId = null, platform = "", commentId = "", postId = "", row = {} } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeCommentId = text(commentId || row.comment_id || "");
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  const safePlatform = text(platform || row.platform || "facebook") === "instagram" ? "instagram" : "facebook";
  const dedupeKey = `social-comment-private-reply:${safeTenantId}:${safePlatform}:${safeCommentId}`;
  debugSocialCommentsLog("[social-comments][private-reply] queued", {
    tenant_id: safeTenantId,
    platform: safePlatform,
    post_id: text(postId || row.post_id || ""),
    comment_id: safeCommentId,
    dedupe_key: dedupeKey,
  });
  return enqueueJob(
    "social.comment.private_reply",
    {
      tenantId: safeTenantId,
      platform: safePlatform,
      postId: text(postId || row.post_id || ""),
      commentId: safeCommentId,
      row,
    },
    {
      dedupeKey,
      maxAttempts: 4,
      backoffMs: 2000,
      maxBackoffMs: 30000,
      context: {
        tenantId: safeTenantId,
        platform: safePlatform,
        commentId: safeCommentId,
        postId: text(postId || row.post_id || ""),
      },
    }
  );
};

const parseCommentTimestamp = (row = {}) => {
  const candidates = [
    row.created_at,
    row.processed_at,
    row.updated_at,
    row.raw_payload?.received_at,
    row.raw_payload?.entry?.[0]?.time,
    row.raw_payload?.entry?.[0]?.changes?.[0]?.value?.created_time,
    row.comment_created_time,
  ];
  for (const candidate of candidates) {
    const value = text(candidate || "");
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const debugParseCommentTimestamp = (row = {}) => {
  const candidates = [
    { key: "created_at", value: row.created_at },
    { key: "processed_at", value: row.processed_at },
    { key: "updated_at", value: row.updated_at },
    { key: "raw_payload.received_at", value: row.raw_payload?.received_at },
    { key: "raw_payload.entry[0].time", value: row.raw_payload?.entry?.[0]?.time },
    { key: "raw_payload.entry[0].changes[0].value.created_time", value: row.raw_payload?.entry?.[0]?.changes?.[0]?.value?.created_time },
    { key: "comment_created_time", value: row.comment_created_time },
  ];
  for (const candidate of candidates) {
    const raw = text(candidate.value || "");
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        raw_created_time: raw,
        parsed_created_time: parsed.toISOString(),
        source_key: candidate.key,
        parse_error: "",
      };
    }
    return {
      raw_created_time: raw,
      parsed_created_time: null,
      source_key: candidate.key,
      parse_error: `invalid_date:${candidate.key}`,
    };
  }
  return {
    raw_created_time: "",
    parsed_created_time: null,
    source_key: "",
    parse_error: "missing_created_time",
  };
};

export const PRIVATE_REPLY_REQUIRES_WEBHOOK_COMMENT_CONTEXT = ({ row = {} } = {}) => {
  const platform = text(row.platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  const source = text(row.raw_payload?.source || row.automation_source || row.source || "").toLowerCase();
  const commentId = text(row.comment_id || "");
  const dmStatus = text(row.dm_status || row.automation_state?.private_reply?.status || "").toLowerCase();
  const hasSendingOrSent = ["sending", "sent"].includes(dmStatus);
  const isPollComment = source === "meta_comment_poll";
  const compositeCommentId = Boolean(commentId && commentId.includes("_"));
  const commentTimestampDebug = debugParseCommentTimestamp(row);
  const commentTimestamp = commentTimestampDebug.parsed_created_time ? new Date(commentTimestampDebug.parsed_created_time) : null;
  const ageMs = commentTimestamp ? Date.now() - commentTimestamp.getTime() : Number.POSITIVE_INFINITY;
  const recentEnough = ageMs <= 15 * 60 * 1000;
  const justSavedThisRun = Boolean(Number(row.id || 0)) && recentEnough;
  const allowFromPoll = platform === "facebook" && isPollComment && compositeCommentId && (recentEnough || justSavedThisRun) && !hasSendingOrSent;
  debugSocialCommentsLog("POLL_COMMENT_AGE_DEBUG", {
    comment_id: commentId,
    created_time_raw: commentTimestampDebug.raw_created_time || "",
    parsed_created_time: commentTimestampDebug.parsed_created_time || "",
    now: new Date().toISOString(),
    age_ms: Number.isFinite(ageMs) ? ageMs : null,
    age_seconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null,
    allowed_max_age_seconds: 15 * 60,
    decision: allowFromPoll ? "allowed" : "rejected",
    source,
    parse_error: commentTimestampDebug.parse_error || "",
    source_key: commentTimestampDebug.source_key || "",
  });
  return {
    platform,
    source,
    commentId,
    dmStatus,
    compositeCommentId,
    recentEnough,
    justSavedThisRun,
    allowFromPoll,
    rejectReason: !isPollComment
      ? "not_poll_comment"
      : platform !== "facebook"
        ? "non_facebook_platform"
      : !compositeCommentId
          ? "non_composite_comment_id"
          : !recentEnough && !justSavedThisRun
            ? "poll_comment_too_old"
            : hasSendingOrSent
              ? "private_reply_already_sending_or_sent"
              : "allowed",
  };
};

export const socialCommentConversationId = ({
  platform = "",
  postId = "",
  commenterId = "",
  rootCommentId = "",
  commentId = "",
} = {}) => {
  const normalizedPlatform = text(platform) === "instagram" ? "instagram" : "facebook";
  const safePostId = text(postId || "");
  if (safePostId) {
    return `${normalizedPlatform}_post:${safePostId}`;
  }
  const fallbackRoot = text(rootCommentId || commentId);
  return `social_comment:${normalizedPlatform}:${fallbackRoot}`;
};

const socialCommentLeadTemperature = (classificationLabel = "") => COMMENT_LEAD_TEMPERATURE[classificationLabel] || "cold";

const isGenericSocialCommentDisplayName = (value = "") => {
  const name = text(value).toLowerCase();
  return !name || ["customer", "unknown", "guest", "anonymous", "عميل", "العميل"].includes(name);
};

const resolveSocialCommentCustomerName = (event = {}) => {
  const candidates = [
    event.commenter_name,
    event.from?.name,
    event.from?.full_name,
    event.raw_payload?.value?.from?.name,
    event.raw_payload?.value?.from?.full_name,
    event.raw_payload?.value?.commenter_name,
    event.raw_payload?.value?.author_name,
    event.raw_payload?.comment?.from?.name,
    event.raw_payload?.comment?.from?.full_name,
    event.raw_payload?.value?.from?.name,
    event.raw_payload?.from?.name,
    event.raw_payload?.value?.comment?.from?.name,
    event.metadata?.commenter_name,
    event.username,
    event.profile_name,
    event.contact_name,
    event.author_name,
  ];
  const preferred = candidates.map(text).find((value) => value && !isGenericSocialCommentDisplayName(value));
  if (preferred) return preferred;
  const fallback = candidates.map(text).find(Boolean);
  return fallback || "";
};

const resolveSocialCommentAvatarUrl = (event = {}) =>
  text(
    event.commenter_profile_picture_url ||
      event.profile_pic_url ||
      event.profile_picture_url ||
      event.avatar_url ||
      event.from?.picture?.data?.url ||
      event.from?.picture?.url ||
      event.from?.picture ||
      event.from?.profile_pic ||
      event.metadata?.commenter_profile_picture_url ||
      event.raw_payload?.value?.from?.picture?.data?.url ||
      event.raw_payload?.value?.from?.picture?.url ||
      event.raw_payload?.value?.from?.profile_pic ||
      event.raw_payload?.value?.from?.picture ||
      event.raw_payload?.value?.comment?.from?.profile_pic ||
      event.raw_payload?.value?.comment?.from?.picture ||
      event.raw_payload?.comment?.from?.profile_pic ||
      event.raw_payload?.comment?.from?.picture ||
      event.raw_payload?.from?.profile_pic ||
      event.raw_payload?.from?.picture ||
      ""
  );

const resolveSocialCommentPostMessage = (event = {}) =>
  text(
    event.post_message ||
      event.post_caption ||
      event.raw_payload?.post?.message ||
      event.raw_payload?.post?.caption ||
      event.raw_payload?.post?.post_message ||
      event.raw_payload?.post?.post_caption ||
      event.raw_payload?.post?.caption ||
      event.raw_payload?.value?.post?.message ||
      event.raw_payload?.value?.post?.caption ||
      ""
  );

const resolveSocialCommentPostFullPicture = (event = {}) =>
  text(
    event.post_full_picture ||
      event.full_picture ||
      event.attachment_image ||
      event.post_thumbnail ||
      event.raw_payload?.post?.full_picture ||
      event.raw_payload?.post?.attachment_image ||
      event.raw_payload?.post?.post_thumbnail ||
      event.raw_payload?.value?.post?.full_picture ||
      event.raw_payload?.value?.post?.attachment_image ||
      event.raw_payload?.value?.post?.post_thumbnail ||
      ""
  );

const resolveSocialCommentPostCreatedTime = (event = {}) =>
  text(
    event.post_created_time ||
      event.raw_payload?.post?.created_time ||
      event.raw_payload?.value?.post?.created_time ||
      event.raw_payload?.post?.updated_time ||
      event.raw_payload?.value?.post?.updated_time ||
      event.comment_created_time ||
      event.raw_payload?.comment?.created_time ||
      event.raw_payload?.value?.created_time ||
      event.processed_at ||
      ""
  );

const resolveSocialCommentPostPermalink = (event = {}) =>
  text(
    event.post_permalink ||
      event.post_permalink_url ||
      event.permalink_url ||
      event.post_url ||
      event.comment_url ||
      event.raw_payload?.post_permalink ||
      event.raw_payload?.post_permalink_url ||
      event.raw_payload?.permalink_url ||
      event.raw_payload?.post_url ||
      event.raw_payload?.comment_url ||
      event.raw_payload?.permalink ||
      ""
  );

const fetchSocialCommentWebhookPostMedia = async ({ tenantId = null, event = {} } = {}) => {
  const postId = text(
    event.post_id ||
    event.metadata?.post_id ||
    event.raw_payload?.post_id ||
    event.raw_payload?.value?.post_id ||
    event.raw_payload?.value?.media_id ||
    ""
  );
  if (!postId) return null;

  const pageId = text(
    event.page_id ||
    event.metadata?.page_id ||
    event.raw_payload?.entry?.id ||
    event.raw_payload?.value?.page_id ||
    event.raw_payload?.value?.metadata?.page_id ||
    ""
  );
  const permalinkUrl = text(event.post_permalink_url || event.post_permalink || event.raw_payload?.post_permalink_url || event.raw_payload?.post_permalink || event.raw_payload?.permalink_url || event.raw_payload?.post_url || event.raw_payload?.comment_url || "");

  try {
    const fetchMetaPostPreviewDetails = await loadFetchMetaPostPreviewDetails();
    const preview = fetchMetaPostPreviewDetails
      ? await fetchMetaPostPreviewDetails({ tenantId, postId, pageId, permalinkUrl }).catch((error) => ({
          error_message: text(error?.message || "Graph fetch failed"),
          thumbnail_url: "",
          post_full_picture: "",
          full_picture: "",
          picture: "",
          media_url: "",
          media_type: "",
          attachments: [],
          post_permalink_url: permalinkUrl,
          media_enrichment_status: "failed",
        }))
      : null;
    const savedThumbnail = text(preview?.thumbnail_url || preview?.post_full_picture || preview?.full_picture || preview?.picture || "");
    const graphMediaFound = Boolean(savedThumbnail);
    const result = {
      post_id: postId,
      thumbnail_url: savedThumbnail,
      post_full_picture: text(preview?.post_full_picture || preview?.full_picture || savedThumbnail || ""),
      full_picture: text(preview?.full_picture || preview?.post_full_picture || savedThumbnail || ""),
      picture: text(preview?.picture || ""),
      media_url: text(preview?.media_url || ""),
      media_type: text(preview?.media_type || ""),
      attachments: asArray(preview?.attachments || []),
      post_permalink_url: text(preview?.post_permalink_url || preview?.permalink_url || permalinkUrl || ""),
      media_enrichment_status: graphMediaFound ? "success" : "failed",
      media_enrichment_error: text(preview?.error_message || preview?.reason_if_missing || (!graphMediaFound ? "no_media_found" : "")),
    };
    console.log("[social-comments:webhook-media-persist]", {
      post_id: postId,
      graph_media_found: graphMediaFound,
      thumbnail_url_saved: result.thumbnail_url,
      status: result.media_enrichment_status,
    });
    return result;
  } catch (error) {
    const result = {
      post_id: postId,
      thumbnail_url: "",
      post_full_picture: "",
      full_picture: "",
      picture: "",
      media_url: "",
      media_type: "",
      attachments: [],
      post_permalink_url: permalinkUrl,
      media_enrichment_status: "failed",
      media_enrichment_error: text(error?.message || "Graph fetch failed"),
    };
    console.log("[social-comments:webhook-media-persist]", {
      post_id: postId,
      graph_media_found: false,
      thumbnail_url_saved: "",
      status: result.media_enrichment_status,
    });
    return result;
  }
};

const applyWebhookPostMediaToEvent = (event = {}, media = null) => {
  if (!media || typeof media !== "object") return event;
  const thumbnailUrl = text(media.thumbnail_url || "");
  const postFullPicture = text(media.post_full_picture || media.full_picture || thumbnailUrl || "");
  const fullPicture = text(media.full_picture || media.post_full_picture || thumbnailUrl || "");
  const picture = text(media.picture || "");
  const mediaUrl = text(media.media_url || "");
  const mediaType = text(media.media_type || "");
  const attachments = asArray(media.attachments || []);
  const postPermalinkUrl = text(media.post_permalink_url || event.post_permalink_url || event.post_permalink || "");
  const mediaEnrichmentStatus = text(media.media_enrichment_status || event.media_enrichment_status || "");
  const mediaEnrichmentError = text(media.media_enrichment_error || event.media_enrichment_error || "");
  const rawPayload = {
    ...(event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : {}),
    post_id: text(media.post_id || event.post_id || ""),
    thumbnail_url: thumbnailUrl,
    post_thumbnail: thumbnailUrl,
    post_full_picture: postFullPicture,
    full_picture: fullPicture,
    picture,
    media_url: mediaUrl,
    media_type: mediaType,
    attachments,
    post_permalink_url: postPermalinkUrl,
    media_enrichment_status: mediaEnrichmentStatus,
    media_enrichment_error: mediaEnrichmentError,
  };
  return {
    ...event,
    post_id: text(media.post_id || event.post_id || ""),
    thumbnail_url: thumbnailUrl || text(event.thumbnail_url || ""),
    post_thumbnail: thumbnailUrl || text(event.post_thumbnail || ""),
    post_full_picture: postFullPicture || text(event.post_full_picture || ""),
    full_picture: fullPicture || text(event.full_picture || ""),
    picture: picture || text(event.picture || ""),
    media_url: mediaUrl || text(event.media_url || ""),
    media_type: mediaType || text(event.media_type || ""),
    attachments: attachments.length ? attachments : asArray(event.attachments || []),
    post_permalink_url: postPermalinkUrl || text(event.post_permalink_url || event.post_permalink || ""),
    media_enrichment_status: mediaEnrichmentStatus || text(event.media_enrichment_status || ""),
    media_enrichment_error: mediaEnrichmentError || text(event.media_enrichment_error || ""),
    raw_payload: rawPayload,
  };
};

const resolveSocialCommentCustomerProfileId = async ({ tenantId = null, event = {} } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;

  const commenterId = text(
    event.commenter_id ||
      event.from?.id ||
      event.raw_payload?.value?.from?.id ||
      event.raw_payload?.comment?.from?.id ||
      event.raw_payload?.value?.comment?.from?.id ||
      event.metadata?.commenter_id ||
      ""
  );
  if (!commenterId) return null;

  try {
    await ensureAiSalesAgentSchema();
  } catch (error) {
    socialCommentsError("[social-comments] ensure sales schema failed", {
      tenant_id: safeTenantId,
      commenter_id: commenterId,
      message: error?.message || "",
    });
  }

  const existing = await db.query(
    `
    SELECT id
    FROM ai_customer_profiles
    WHERE tenant_id = $1::bigint
      AND COALESCE(external_customer_id, '') = $2::text
    ORDER BY id ASC
    LIMIT 1
    `,
    [safeTenantId, commenterId]
  ).catch(() => ({ rows: [] }));
  if (existing.rows?.[0]?.id) return existing.rows[0].id;

  const commenterName = resolveSocialCommentCustomerName(event);
  const nameParts = commenterName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || commenterName || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  const inserted = await db.query(
    `
    INSERT INTO ai_customer_profiles (
      tenant_id,
      first_name,
      last_name,
      source_channel,
      external_customer_id,
      display_name,
      facebook_name,
      messenger_name,
      customer_name,
      last_seen_at,
      updated_at
    )
    VALUES ($1, $2, $3, 'facebook', $4, $5, $5, $5, $5, NOW(), NOW())
    RETURNING id
    `,
    [
      safeTenantId,
      firstName,
      lastName,
      commenterId,
      commenterName,
    ]
  ).catch((error) => {
    socialCommentsError("[social-comments] profile upsert failed", {
      tenant_id: safeTenantId,
      commenter_id: commenterId,
      message: error?.message || "",
    });
    return { rows: [] };
  });
  return inserted.rows?.[0]?.id || null;
};

const upsertSocialCommentLeadConversation = async ({ tenantId = null, event = {}, suggestedReply = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  await ensureAiSupportLogSchema();
  await ensureAiChannelAdapterSchema();

  try {
    const platform = text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook";
    const channel = platform === "instagram" ? "instagram_comment" : "facebook_comment";
    const sessionId = socialCommentConversationId({
      platform,
      postId: event.post_id,
      commenterId: event.commenter_id,
      rootCommentId: event.root_comment_id,
      commentId: event.comment_id,
    });
    const threadKind = "comment";
    const commentText = text(event.original_comment_text);
    const commenterName = resolveSocialCommentCustomerName(event);
    const commenterId = text(
      event.commenter_id ||
        event.from?.id ||
        event.raw_payload?.value?.from?.id ||
        event.raw_payload?.comment?.from?.id ||
        event.raw_payload?.value?.comment?.from?.id ||
        event.metadata?.commenter_id ||
        ""
    );
    const commenterProfilePictureUrl = resolveSocialCommentAvatarUrl(event);
    const customerProfileId = bigintOrNull(await resolveSocialCommentCustomerProfileId({ tenantId: safeTenantId, event }));
    const postPermalink = resolveSocialCommentPostPermalink(event);
    const postId = text(event.post_id || "");
    const postMessage = resolveSocialCommentPostMessage(event);
    const postFullPicture = resolveSocialCommentPostFullPicture(event);
    const postCreatedTime = text(resolveSocialCommentPostCreatedTime(event) || "");
    const commentCreatedTime = text(
      event.comment_created_time ||
      event.raw_payload?.comment?.created_time ||
      event.raw_payload?.value?.created_time ||
      event.processed_at ||
      ""
    );
    const commentUrl = text(event.comment_url || event.raw_payload?.comment_url || "");
    const productContext = metadataObject(event.product_context || event.raw_payload?.product_context || {});
    const metadata = {
      thread_kind: threadKind,
      platform,
      channel,
      thread_kind_label: threadKind,
      post_id: postId,
      post_permalink_url: postPermalink,
      post_permalink: postPermalink,
      post_url: postPermalink,
      post_message: postMessage,
      post_caption: text(event.post_caption || ""),
      thumbnail_url: text(event.thumbnail_url || event.post_thumbnail || event.post_full_picture || event.full_picture || event.picture || ""),
      post_thumbnail: text(event.post_thumbnail || event.thumbnail_url || event.post_full_picture || event.full_picture || event.picture || ""),
      post_full_picture: text(event.post_full_picture || event.full_picture || event.thumbnail_url || event.post_thumbnail || ""),
      full_picture: text(event.full_picture || event.post_full_picture || event.thumbnail_url || event.post_thumbnail || ""),
      picture: text(event.picture || ""),
      media_url: text(event.media_url || ""),
      media_type: text(event.media_type || ""),
      attachments: asArray(event.attachments || []),
      post_created_time: postCreatedTime,
      comment_id: text(event.comment_id || ""),
      comment_url: commentUrl || (postPermalink && event.comment_id ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(text(event.comment_id || ""))}` : ""),
      comment_created_time: commentCreatedTime,
      root_comment_id: text(event.root_comment_id || event.comment_id || ""),
      parent_comment_id: text(event.parent_comment_id || ""),
      commenter_id: commenterId,
      commenter_name: commenterName,
      commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
      customer_profile_id: customerProfileId,
      original_comment_text: commentText,
      media_enrichment_status: text(event.media_enrichment_status || ""),
      media_enrichment_error: text(event.media_enrichment_error || ""),
      product_context: productContext,
      product_id: text(productContext.product_id || event.product_id || ""),
      product_name: text(productContext.product_name || ""),
      product_price: text(productContext.price || ""),
      product_sale_price: text(productContext.sale_price || ""),
      product_url: text(productContext.product_url || ""),
      product_sizes: asArray(productContext.sizes || []),
      product_colors: asArray(productContext.colors || []),
      product_variant_id: text(productContext.variant_id || ""),
      product_color: text(productContext.color || ""),
      product_size: text(productContext.size || ""),
      classification_label: text(event.classification_label || ""),
      classification_score: Number(event.classification_score || 0),
      lead: {
        lead_score: Number(COMMENT_LEAD_SCORE[event.classification_label] || 0),
        lead_temperature: socialCommentLeadTemperature(event.classification_label),
        lead_reasons: [text(event.classification_label || "")].filter(Boolean),
        recommended_sales_action: "continue_conversation",
        suggested_reply: text(suggestedReply || ""),
      },
      automation_state: {
        like_status: text(event.like_status || "skipped") || "skipped",
        public_reply_status: text(event.public_reply_status || "skipped") || "skipped",
        dm_status: text(event.dm_status || "skipped") || "skipped",
        overall_status: text(event.action_taken || "classified_only") || "classified_only",
        updated_at: new Date().toISOString(),
      },
    };

    console.log("META_COMMENT_INBOX_SAVE_START", {
      tenant_id: safeTenantId,
      platform,
      channel,
      post_id: postId,
      post_permalink_url: postPermalink,
      comment_permalink_url: text(
        event.comment_permalink_url ||
        event.comment_url ||
        event.raw_payload?.comment_permalink_url ||
        event.raw_payload?.value?.comment_permalink_url ||
        ""
      ),
      comment_id: text(event.comment_id || ""),
      commenter_id: commenterId,
      conversation_id: sessionId,
    });

    const sessionResult = await db.query(
      `
      INSERT INTO ai_support_sessions (
        tenant_id,
      session_id,
      source,
      channel,
      thread_kind,
      customer_name,
      external_customer_id,
      customer_avatar_url,
      last_message,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = EXCLUDED.source,
      channel = EXCLUDED.channel,
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_support_sessions.thread_kind),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_support_sessions.customer_name, ''), '') = ''
          OR LOWER(ai_support_sessions.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name)
        ELSE ai_support_sessions.customer_name
      END,
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_support_sessions.external_customer_id),
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_support_sessions.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_support_sessions.customer_avatar_url)
        ELSE ai_support_sessions.customer_avatar_url
      END,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
      updated_at = NOW()
    RETURNING id
    `,
      [safeTenantId, sessionId, channel, channel, threadKind, commenterName, commenterId, commenterProfilePictureUrl, commentText]
    );

    console.log("META_COMMENT_INBOX_CONVERSATION_UPSERTED", {
      tenant_id: safeTenantId,
      platform,
      channel,
      post_id: postId,
      comment_id: text(event.comment_id || ""),
      commenter_id: commenterId,
      conversation_id: sessionId,
      session_ref_id: bigintOrNull(sessionResult.rows[0]?.id),
    });

    debugSocialCommentsLog("[social-comments:conversation-upsert-param-debug]", {
      tenant_id: safeTenantId,
      channel,
      external_conversation_id: sessionId,
      external_customer_id: commenterId,
      thread_kind: threadKind,
      customer_name: commenterName,
      customer_avatar_url: commenterProfilePictureUrl,
      last_message: commentText,
      customer_profile_id: customerProfileId,
      metadata_keys: Object.keys(metadata || {}).slice(0, 20),
      metadata_preview: {
        post_id: metadata.post_id,
        comment_id: metadata.comment_id,
        platform: metadata.platform,
        channel: metadata.channel,
        product_id: metadata.product_id,
        product_name: metadata.product_name,
        media_enrichment_status: metadata.media_enrichment_status,
        classification_label: metadata.classification_label,
      },
    });
    await db.query(
      `
      INSERT INTO ai_channel_conversations (
        tenant_id,
        channel,
      external_conversation_id,
      external_customer_id,
      thread_kind,
      customer_name,
      customer_avatar_url,
      last_message,
      customer_profile_id,
      metadata,
      last_message_at,
      updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      thread_kind = COALESCE(NULLIF(EXCLUDED.thread_kind, ''), ai_channel_conversations.thread_kind),
      customer_name = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_name, ''), '') = ''
          OR LOWER(ai_channel_conversations.customer_name) IN ('customer', 'unknown', 'guest', 'anonymous', 'عميل', 'العميل')
          THEN COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name)
        ELSE ai_channel_conversations.customer_name
      END,
      customer_avatar_url = CASE
        WHEN COALESCE(NULLIF(ai_channel_conversations.customer_avatar_url, ''), '') = ''
          THEN COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url)
        ELSE ai_channel_conversations.customer_avatar_url
      END,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message_at = NOW(),
      updated_at = NOW()
      `,
      [
        safeTenantId,
        channel,
        sessionId,
        commenterId,
        threadKind,
        commenterName,
        commenterProfilePictureUrl,
        commentText,
        customerProfileId,
        JSON.stringify({
          thread_kind: metadata.thread_kind,
          platform: metadata.platform,
          channel: metadata.channel,
          post_id: metadata.post_id,
          comment_id: metadata.comment_id,
          customer_profile_id: metadata.customer_profile_id ? "[bigint]" : null,
          media_enrichment_status: metadata.media_enrichment_status,
          classification_label: metadata.classification_label,
        }),
      ]
    );

    const inboundMessage = await db.query(
      `
      INSERT INTO ai_support_messages (
        session_ref_id,
        tenant_id,
        session_id,
        channel,
        customer_name,
        customer_avatar_url,
        last_message,
        message_text,
        customer_message,
        ai_answer,
        confidence,
        needs_human_support,
        sources_used,
        suggested_products,
        visual_attachments,
        suggested_actions,
        detected_intent,
        fallback_reason,
        message_type,
        staff_message,
        sender_type,
        manual_message,
        external_message_id,
        dedupe_key,
        source_path,
        insert_source,
        post_id,
        post_permalink_url,
        post_message,
        post_caption,
        post_full_picture,
        post_created_time,
        comment_id,
        parent_comment_id,
        root_comment_id,
        commenter_id,
        commenter_name,
        commenter_profile_picture_url,
        comment_created_time,
        comment_url,
        platform,
        thread_kind
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, '', 0.98, TRUE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $8, '', 'comment_inbound', '', 'customer', FALSE, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING *
      `,
      [
        bigintOrNull(sessionResult.rows[0]?.id),
        safeTenantId,
        sessionId,
        channel,
        commenterName,
        commenterProfilePictureUrl,
        commentText,
        text(event.classification_label || ""),
        text(event.comment_id || ""),
        text(event.comment_id || ""),
        "social_comment_automation",
        "social_comment_lead",
      postId,
        postPermalink,
        postMessage,
        text(event.post_caption || ""),
        resolveSocialCommentPostFullPicture(event),
        postCreatedTime,
        text(event.comment_id || ""),
        text(event.parent_comment_id || ""),
        text(event.root_comment_id || event.comment_id || ""),
        commenterId,
        commenterName,
        commenterProfilePictureUrl,
        commentCreatedTime,
        commentUrl || (postPermalink && event.comment_id ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(text(event.comment_id || ""))}` : ""),
        platform,
        threadKind,
      ]
    );

    if (inboundMessage.rows[0]) {
      console.log("META_COMMENT_INBOX_MESSAGE_SAVED", {
        tenant_id: safeTenantId,
        platform,
        channel,
        post_id: postId,
        comment_id: text(event.comment_id || ""),
        commenter_id: commenterId,
        conversation_id: sessionId,
        message_id: inboundMessage.rows[0]?.id || null,
      });
    } else {
      console.log("META_COMMENT_INBOX_DUPLICATE", {
        tenant_id: safeTenantId,
        platform,
        channel,
        post_id: postId,
        comment_id: text(event.comment_id || ""),
        commenter_id: commenterId,
        conversation_id: sessionId,
      });
    }

    debugSocialCommentsLog("[social-comments:new-comment-ingest-debug]", {
      source: text(event.raw_payload?.source || "") === "meta_comment_poll" ? "poller" : "webhook",
      post_id: postId,
      comment_id: text(event.comment_id || ""),
      message: commentText,
      inserted_run: Boolean(sessionResult.rows[0]),
      inserted_message: Boolean(inboundMessage.rows[0]),
      conversation_id: sessionId,
    });

    const insertedRun = Boolean(sessionResult.rows[0]);
    let savedRunRow = sessionResult.rows[0] || null;
    const selectedPostId = text(postId || "");
    const selectedCommentId = text(event.comment_id || savedRunRow?.comment_id || "");
    const runtimePostId = text(savedRunRow?.post_id || event.post_id || "");
    const runtimeCommentId = text(savedRunRow?.comment_id || event.comment_id || "");
    const runtimeProductContextInput = buildRuntimeProductContextRow({
      row: savedRunRow || {},
      event,
      selectedPostId,
      selectedCommentId,
      runtimePostId,
      runtimeCommentId,
      postId,
      commentId: text(event.comment_id || ""),
    });
    console.log("SOCIAL_COMMENT_PRODUCT_CONTEXT_CALL_INPUT", {
      runtime_post_id: runtimePostId,
      runtime_comment_id: runtimeCommentId,
      selected_post_id: selectedPostId,
      selected_comment_id: selectedCommentId,
      final_post_id: runtimeProductContextInput.finalPostId,
      final_comment_id: runtimeProductContextInput.finalCommentId,
    });
    const runtimeProductContext = await resolveSocialCommentPublishedProductContext({
      tenantId: safeTenantId,
      row: {
        ...runtimeProductContextInput.row,
        tenant_id: safeTenantId,
      },
    }).catch(() => null);
    console.log("SOCIAL_COMMENT_PRODUCT_CONTEXT_RESOLVED", buildSocialCommentProductContextResolvedLog({
      productContext: runtimeProductContext,
      row: {
        ...runtimeProductContextInput.row,
        tenant_id: safeTenantId,
      },
    }));
    const automationConfig = await loadPostAutomationConfig({
      tenantId: safeTenantId,
      platform,
      postId,
      row: savedRunRow || {},
    }).catch(() => null);
    console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_BEFORE", {
      tenant_id: safeTenantId,
      platform,
      post_id: postId,
      comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
      config_enabled: Boolean(automationConfig?.enabled),
      matched_key: text(automationConfig?.lookup_matched_key || ""),
    });
    console.info("SOCIAL_COMMENT_RUNTIME_SELECTED_POST", {
      tenant_id: safeTenantId,
      platform,
      selected_post_id: postId,
      selected_comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
      selected_post_permalink: text(savedRunRow?.post_permalink || savedRunRow?.post_permalink_url || event.post_permalink || event.post_permalink_url || ""),
    });
    const automationRuntimeResult = hasLinkedProductForAutomation({ row: savedRunRow || event || {}, productContext: runtimeProductContext })
      ? await executeSocialCommentAutomationRuntime({
        tenantId: safeTenantId,
        platform,
        postId,
        commentId: text(event.comment_id || savedRunRow?.comment_id || ""),
        row: savedRunRow || {},
        currentRunId: savedRunRow?.id || null,
        productContext: runtimeProductContext,
        config: automationConfig,
      }).catch((error) => {
        console.warn("SOCIAL_COMMENT_AUTOMATION_RUNTIME_SKIPPED", {
          tenant_id: safeTenantId,
          platform,
          post_id: postId,
          comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
          reason: "runtime_error",
          message: error?.message || "",
        });
        return null;
      })
      : (console.log("SOCIAL_COMMENT_PRODUCT_RESOLUTION_PATH", buildSocialCommentProductResolutionPathPayload({
        row: savedRunRow || event || {},
        productContext: runtimeProductContext,
      })), console.log("SOCIAL_COMMENT_SKIPPED_NO_LINKED_PRODUCT", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
      }), { applied: false, skipped: true, reason: "no_linked_product", row: savedRunRow || event || {}, step_results: [] });
    console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_AFTER", {
      tenant_id: safeTenantId,
      platform,
      post_id: postId,
      comment_id: text(event.comment_id || savedRunRow?.comment_id || ""),
      applied: Boolean(automationRuntimeResult?.applied),
      skipped: Boolean(automationRuntimeResult?.skipped),
      reason: text(automationRuntimeResult?.reason || ""),
    });
    if (automationRuntimeResult?.row) {
      savedRunRow = automationRuntimeResult.row;
    }
    const automationRuntimeApplied = Boolean(automationRuntimeResult?.applied);
    const privateReplyStatus = text(
      savedRunRow?.dm_status ||
      savedRunRow?.automation_state?.private_reply?.status ||
      event.dm_status ||
      event.automation_state?.private_reply?.status ||
      ""
    ).toLowerCase();
    const privateReplyCommentId = text(event.comment_id || savedRunRow?.comment_id || "");
    const privateReplySource = text(event.raw_payload?.source || savedRunRow?.raw_payload?.source || "").toLowerCase();
    const legacyPathEnabled = !automationConfig?.enabled && hasLinkedProductForAutomation({ row: savedRunRow || event || {}, productContext: runtimeProductContext });
    console.log("SOCIAL_COMMENT_LEGACY_PATH_ENTERED", {
      tenant_id: safeTenantId,
      platform,
      post_id: postId,
      comment_id: privateReplyCommentId,
      automation_config_enabled: Boolean(automationConfig?.enabled),
      runtime_applied: automationRuntimeApplied,
      inserted_run: insertedRun,
    });
    const shouldEnqueuePrivateReply =
      text(platform || "").toLowerCase() === "facebook" &&
      Boolean(privateReplyCommentId) &&
      insertedRun &&
      !automationRuntimeApplied &&
      legacyPathEnabled &&
      !["queued", "sending", "sent"].includes(privateReplyStatus);

    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_REACHED", {
      tenant_id: safeTenantId,
      platform,
      post_id: postId,
      comment_id: privateReplyCommentId,
      inserted_run: insertedRun,
      saved_run_row: Boolean(savedRunRow),
      private_reply_status: privateReplyStatus || "empty",
      source: privateReplySource,
    });

    if (!legacyPathEnabled) {
      console.log("SOCIAL_COMMENT_LEGACY_PATH_SKIPPED_AUTOMATION_ENABLED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        automation_config_enabled: true,
        runtime_applied: automationRuntimeApplied,
      });
    } else if (shouldEnqueuePrivateReply) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLING", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
      });
      await enqueueSocialCommentPrivateReplyJob({
        tenantId: safeTenantId,
        platform,
        commentId: privateReplyCommentId,
        postId,
        row: savedRunRow || {
          tenant_id: safeTenantId,
          platform,
          comment_id: privateReplyCommentId,
          post_id: postId,
          raw_payload: event.raw_payload || {},
        },
      }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
      });
    } else {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_SKIPPED", {
        tenant_id: safeTenantId,
        platform,
        post_id: postId,
        comment_id: privateReplyCommentId,
        inserted_run: insertedRun,
        saved_run_row: Boolean(savedRunRow),
        private_reply_status: privateReplyStatus || "empty",
        source: privateReplySource,
        reason: text(platform || "").toLowerCase() !== "facebook"
          ? "not_facebook"
          : !privateReplyCommentId
            ? "missing_comment_id"
            : !legacyPathEnabled
              ? "automation_enabled"
              : automationRuntimeApplied
              ? "runtime_already_enqueued"
            : !insertedRun
              ? "missing_saved_run"
              : `private_reply_status_${privateReplyStatus || "empty"}`,
      });
    }

    const commentsCountResult = await db.query(
      `
      SELECT COUNT(*)::int AS total_comments
      FROM ai_support_messages
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
        AND message_type = 'comment_inbound'
      `,
      [safeTenantId, sessionId]
    ).catch(() => ({ rows: [] }));
    const commentsCount = Number(commentsCountResult.rows?.[0]?.total_comments || 0);
    await db.query(
      `
      UPDATE ai_channel_conversations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND channel = $2::text
        AND external_conversation_id = $3::text
      `,
      [
        safeTenantId,
        channel,
        sessionId,
        JSON.stringify({
          comments_count: commentsCount,
          last_comment_text: commentText,
          last_comment_at: commentCreatedTime,
          last_comment_id: text(event.comment_id || ""),
          last_commenter_name: commenterName,
          last_commenter_id: commenterId,
          post_full_picture: postFullPicture,
        }),
      ]
    ).catch(() => {});

    const suggestedMessage = text(suggestedReply || "");

    let suggestionResult = { rows: [] };
    if (suggestedMessage) {
      suggestionResult = await db.query(
        `
        INSERT INTO ai_support_messages (
          session_ref_id,
          tenant_id,
          session_id,
        channel,
        customer_name,
        customer_avatar_url,
        last_message,
        message_text,
        customer_message,
          ai_answer,
          confidence,
          needs_human_support,
          sources_used,
          suggested_products,
          visual_attachments,
          suggested_actions,
          detected_intent,
          fallback_reason,
          message_type,
          staff_message,
          sender_type,
          manual_message,
          external_message_id,
          dedupe_key,
          source_path,
          insert_source,
          delivery_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, '', $8, 0.88, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'comment_suggestion', '', 'comment_suggestion', '', 'ai', FALSE, $9, $10, $11, $12, 'draft')
        ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO UPDATE SET
          ai_answer = COALESCE(NULLIF(EXCLUDED.ai_answer, ''), ai_support_messages.ai_answer),
          last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_messages.last_message),
          message_text = COALESCE(NULLIF(EXCLUDED.message_text, ''), ai_support_messages.message_text)
        RETURNING *
        `,
        [
          bigintOrNull(sessionResult.rows[0]?.id),
          safeTenantId,
          sessionId,
          channel,
          commenterName,
          commenterProfilePictureUrl,
          commentText,
          suggestedMessage,
          `${text(event.comment_id || "")}:suggested`,
          `${text(event.comment_id || "")}:suggested`,
          "social_comment_automation",
          "social_comment_suggestion",
        ]
      );
    }

    await db.query(
      `
      UPDATE ai_support_sessions
      SET
        last_message = $3,
        channel = $4,
        thread_kind = $5,
        updated_at = NOW()
      WHERE tenant_id = $1 AND session_id = $2
      `,
      [safeTenantId, sessionId, commentText, channel, threadKind]
    );

    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:message", {
      tenant_id: safeTenantId,
      session_id: sessionId,
      message: inboundMessage.rows[0] || suggestionResult.rows[0] || null,
      at: new Date().toISOString(),
    });
    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", {
      tenant_id: safeTenantId,
      session_id: sessionId,
      at: new Date().toISOString(),
    });

    return {
      session_id: sessionId,
      thread_kind: threadKind,
      channel,
      lead_score: Number(COMMENT_LEAD_SCORE[event.classification_label] || 0),
      suggested_reply: suggestedMessage,
      message: inboundMessage.rows[0] || null,
      suggested_message: suggestionResult.rows[0] || null,
      duplicate: !inboundMessage.rows[0],
      metadata,
    };
  } catch (error) {
    console.error("META_COMMENT_INBOX_SAVE_ERROR", {
      tenant_id: safeTenantId,
      platform: text(event.platform || "facebook"),
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
      post_id: text(event.post_id || ""),
      comment_id: text(event.comment_id || ""),
      commenter_id: text(event.commenter_id || ""),
      conversation_id: text(
        socialCommentConversationId({
          platform: event.platform,
          postId: event.post_id,
          commenterId: event.commenter_id,
          rootCommentId: event.root_comment_id,
          commentId: event.comment_id,
        })
      ),
      message: error?.message || String(error),
    });
    debugSocialCommentsLog("META_COMMENT_INBOX_SAVE_CONTINUED", {
      tenant_id: safeTenantId,
      platform: text(event.platform || "facebook"),
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")),
      post_id: text(event.post_id || ""),
      comment_id: text(event.comment_id || ""),
      reason: "inbox_save_failed_but_automation_continues",
      message: error?.message || String(error),
    });
    return null;
  }
};

const resolveSocialCommentInboxMaterializationState = async ({ tenantId = null, sessionId = "", commentId = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  const safeCommentId = text(commentId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeSessionId || !safeCommentId) {
    return {
      tenant_id: safeTenantId || null,
      session_id: safeSessionId,
      comment_id: safeCommentId,
      message_exists: false,
      session_exists: false,
      conversation_exists: false,
      fully_materialized: false,
      last_message: "",
    };
  }

  const [messageResult, sessionResult, conversationResult] = await Promise.all([
    db.query(
      `
      SELECT id, session_id, message_text, customer_message, last_message
      FROM ai_support_messages
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
        AND (
          external_message_id = $3::text
          OR dedupe_key = $3::text
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeSessionId, safeCommentId]
    ),
    db.query(
      `
      SELECT session_id, last_message
      FROM ai_support_sessions
      WHERE tenant_id = $1::bigint
        AND session_id = $2::text
      LIMIT 1
      `,
      [safeTenantId, safeSessionId]
    ),
    db.query(
      `
      SELECT external_conversation_id, last_message
      FROM ai_channel_conversations
      WHERE tenant_id = $1::bigint
        AND external_conversation_id = $2::text
      LIMIT 1
      `,
      [safeTenantId, safeSessionId]
    ),
  ]);

  const messageRow = messageResult.rows[0] || null;
  const sessionRow = sessionResult.rows[0] || null;
  const conversationRow = conversationResult.rows[0] || null;
  return {
    tenant_id: safeTenantId,
    session_id: safeSessionId,
    comment_id: safeCommentId,
    message_exists: Boolean(messageRow),
    session_exists: Boolean(sessionRow),
    conversation_exists: Boolean(conversationRow),
    fully_materialized: Boolean(messageRow && sessionRow && conversationRow),
    last_message:
      messageRow?.message_text ||
      messageRow?.customer_message ||
      messageRow?.last_message ||
      sessionRow?.last_message ||
      conversationRow?.last_message ||
      "",
  };
};

export const materializeSocialCommentInboxConversation = async ({
  tenantId = null,
  event = {},
  suggestedReply = "",
  updateRunLink = true,
} = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return {
      tenant_id: null,
      session_id: "",
      comment_id: text(event.comment_id || ""),
      platform: text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook",
      channel: text(event.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment",
      already_materialized: false,
      materialized: false,
      wrote_inbox: false,
      run_link_updated: false,
      reason: "invalid_tenant",
    };
  }

  const platform = text(event.platform || "facebook") === "instagram" ? "instagram" : "facebook";
  const channel = platform === "instagram" ? "instagram_comment" : "facebook_comment";
  const sessionId = socialCommentConversationId({
    platform,
    postId: event.post_id,
    commenterId: event.commenter_id,
    rootCommentId: event.root_comment_id,
    commentId: event.comment_id,
  });
  const commentId = text(event.comment_id || "");
  const state = await resolveSocialCommentInboxMaterializationState({
    tenantId: safeTenantId,
    sessionId,
    commentId,
  });
  const shouldUpsert = true;
  let conversation = null;
  if (shouldUpsert) {
    conversation = await upsertSocialCommentLeadConversation({
      tenantId: safeTenantId,
      event,
      suggestedReply,
    });
  }

  const resolvedSessionId = conversation?.session_id || sessionId;
  let runLinkUpdated = false;
  if (updateRunLink && resolvedSessionId && commentId) {
    const runLinkResult = await db.query(
      `
      UPDATE social_comment_automation_runs
      SET inbox_conversation_id = COALESCE(NULLIF(inbox_conversation_id, ''), $3::text),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND comment_id = $4::text
      `,
      [safeTenantId, platform, resolvedSessionId, commentId]
    );
    runLinkUpdated = Number(runLinkResult.rowCount || 0) > 0;
  }

  return {
    ...state,
    tenant_id: safeTenantId,
    session_id: resolvedSessionId,
    platform,
    channel,
    already_materialized: state.fully_materialized,
    materialized: Boolean(shouldUpsert && !state.fully_materialized && conversation?.session_id),
    wrote_inbox: Boolean(shouldUpsert),
    run_link_updated: runLinkUpdated,
    conversation,
    suggested_reply: text(suggestedReply || ""),
  };
};

const resolveSocialCommentTenantAutomationSettings = async ({ tenantId = null } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    return {
      tenant_id: null,
      source: "invalid_tenant",
      persisted: false,
      ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
    };
  }

  const settings = await getSocialAutomationSettings(safeTenantId).catch(() => ({ ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS, persisted: false }));
  return {
    tenant_id: safeTenantId,
    ...normalizeSocialAutomationSettings(settings),
    source: settings.persisted === false ? "social_automation_fallback" : "social_automation_settings",
  };
};

const buildSocialCommentAutomationState = ({
  row = {},
  featureFlags = {},
  automationSettings = {},
  overallStatus = "skipped",
  reason = "",
  likeStatus = row.like_status || "skipped",
  publicReplyStatus = row.public_reply_status || "skipped",
  dmStatus = row.dm_status || "skipped",
  errorCode = row.error_code || "",
  commentId = "",
  sessionId = "",
} = {}) => ({
  eligible: COMMENT_AUTOMATION_ELIGIBLE_LABELS.has(text(row.classification_label || "")) && Number(row.classification_score || 0) >= confidenceFrom(automationSettings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence),
  overall_status: overallStatus,
  reason: text(reason),
  feature_flags: {
    like: Boolean(featureFlags.like?.enabled ?? featureFlags.like),
    public_reply: Boolean(featureFlags.publicReply?.enabled ?? featureFlags.publicReply),
    private_message: Boolean(featureFlags.privateMessage?.enabled ?? featureFlags.privateMessage),
  },
  tenant_settings: {
    auto_like_enabled: Boolean(automationSettings.auto_like_enabled),
    auto_public_reply_enabled: Boolean(automationSettings.auto_public_reply_enabled),
    auto_private_message_enabled: Boolean(automationSettings.auto_private_message_enabled),
    min_confidence: confidenceFrom(automationSettings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence),
  },
  like_status: text(likeStatus || "skipped") || "skipped",
  public_reply_status: text(publicReplyStatus || "skipped") || "skipped",
  dm_status: text(dmStatus || "skipped") || "skipped",
  error_code: text(errorCode || ""),
  comment_id: text(commentId || row.comment_id || ""),
  session_id: text(sessionId || row.inbox_conversation_id || ""),
  updated_at: new Date().toISOString(),
});

export const persistSocialCommentAutomationState = async ({
  tenantId = null,
  platform = "",
  commentId = "",
  sessionId = "",
  channel = "",
  actionTaken = "",
  publicReplyStatus = "",
  dmStatus = "",
  likeStatus = "",
  errorCode = "",
  automationState = null,
} = {}) => {
  const safeTenantId = Number(tenantId);
  const safeCommentId = text(commentId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeCommentId) return null;
  const safeSessionId = text(sessionId);
  const safeChannel = text(channel);
  const safeActionTaken = text(actionTaken);
  const safeAutomationState = automationState && typeof automationState === "object" ? automationState : null;
  const result = await db.query(
    `
    UPDATE social_comment_automation_runs
    SET action_taken = COALESCE(NULLIF($4::text, ''), action_taken),
        public_reply_status = COALESCE(NULLIF($5::text, ''), public_reply_status),
        dm_status = COALESCE(NULLIF($6::text, ''), dm_status),
        like_status = COALESCE(NULLIF($7::text, ''), like_status),
        error_code = COALESCE(NULLIF($8::text, ''), error_code),
        automation_state = CASE
          WHEN $9::jsonb IS NULL THEN automation_state
          ELSE COALESCE(automation_state, '{}'::jsonb) || $9::jsonb
        END,
        inbox_conversation_id = COALESCE(NULLIF($10::text, ''), inbox_conversation_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
    RETURNING *
    `,
    [
      safeTenantId,
      text(platform || "facebook"),
      safeCommentId,
      safeActionTaken,
      text(publicReplyStatus || ""),
      text(dmStatus || ""),
      text(likeStatus || ""),
      text(errorCode || ""),
      safeAutomationState ? JSON.stringify(safeAutomationState) : null,
      safeSessionId,
    ]
  );

  if (safeSessionId && safeChannel && safeAutomationState) {
    await db.query(
      `
      UPDATE ai_channel_conversations
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{automation_state}',
            $4::jsonb,
            true
          ),
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND channel = $2::text
        AND external_conversation_id = $3::text
      `,
      [safeTenantId, safeChannel, safeSessionId, JSON.stringify(safeAutomationState)]
    ).catch(() => {});
  }

  const row = result.rows[0] || null;
  if (row) {
    emitSocialCommentUpdated(row);
    if (text(publicReplyStatus || dmStatus || likeStatus || "")) {
      emitSocialReplyStatus(row);
    }
  }
  return row;
};

const appendSocialCommentAutomationTranscript = async ({
  tenantId = null,
  sessionId = "",
  channel = "",
  messageType = "automation_error",
  message = "",
  deliveryStatus = "",
  deliveryError = "",
  externalMessageId = "",
  externalReplyId = "",
} = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeSessionId || !text(message)) return null;
  return appendAutomationSupportTranscript({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    message: text(message),
    messageType,
    channel,
    deliveryStatus: text(deliveryStatus),
    deliveryError: text(deliveryError),
    externalMessageId: text(externalMessageId),
    externalReplyId: text(externalReplyId),
    staffUserName: "Social Comment Automation",
    senderType: "staff",
    sourcePath: "social_comment_automation",
    insertSource: "social_comment_automation",
  }).catch((error) => {
    console.error("[social-comments][automation] transcript insert failed", {
      tenant_id: safeTenantId,
      session_id: safeSessionId,
      channel,
      message_type: messageType,
      message: error?.message || "",
    });
    return null;
  });
};

export const buildSocialCommentAutomationDecision = ({
  row = {},
  featureFlags = getSocialCommentAutomationEnvFlags(),
  automationSettings = DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
} = {}) => {
  const label = text(row.classification_label || "");
  const score = Number(row.classification_score || 0);
  const settings = normalizeSocialAutomationSettings(automationSettings);
  const minConfidence = confidenceFrom(settings.min_confidence, DEFAULT_SOCIAL_AUTOMATION_SETTINGS.min_confidence);
  const eligible = COMMENT_AUTOMATION_ELIGIBLE_LABELS.has(label) && score >= minConfidence;
  const tenantRequested = {
    like: Boolean(settings.auto_like_enabled),
    publicReply: Boolean(settings.auto_public_reply_enabled),
    privateMessage: Boolean(settings.auto_private_message_enabled),
  };
  const requested = {
    like: tenantRequested.like && !isSocialAutomationEnvDisabled(featureFlags.like),
    publicReply: tenantRequested.publicReply && !isSocialAutomationEnvDisabled(featureFlags.publicReply),
    privateMessage: tenantRequested.privateMessage && !isSocialAutomationEnvDisabled(featureFlags.privateMessage),
  };
  const requestedCount = Object.values(requested).filter(Boolean).length;
  const requestedAnyByTenant = Object.values(tenantRequested).some(Boolean);
  const requestedAnyByEnv = Object.values(featureFlags).some((flag) => !isSocialAutomationEnvDisabled(flag));
  const envDisabledAllRequested = requestedAnyByTenant && !requestedCount && Object.entries(tenantRequested).some(([key, enabled]) => enabled && isSocialAutomationEnvDisabled(featureFlags[key]));
  const enabled = eligible && requestedCount > 0;
  const reason = !eligible
    ? (score < minConfidence ? "low_confidence_comment" : "ineligible_comment")
    : !requestedAnyByTenant
      ? "tenant_automation_disabled"
      : requestedCount <= 0
        ? (envDisabledAllRequested ? "feature_flags_disabled" : "tenant_automation_disabled")
        : "";
  return {
    eligible,
    enabled,
    reason,
    requested,
    tenantRequested,
    minConfidence,
    confidenceOk: score >= minConfidence,
    featureFlags,
    automationSettings: settings,
    requestedAnyByTenant,
    requestedAnyByEnv,
  };
};

export const executeSocialCommentAutomation = async ({
  tenantId = null,
  row = {},
  conversation = null,
  featureFlags = getSocialCommentAutomationEnvFlags(),
  automationSettings = null,
  deps = {},
} = {}) => {
  const safeTenantId = Number(tenantId || row.tenant_id || 0);
  const safeRow = row || {};
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeRow.comment_id) return { skipped: true, reason: "invalid_input" };
  const effectiveSettings = automationSettings || await resolveSocialCommentTenantAutomationSettings({ tenantId: safeTenantId });
  const decision = buildSocialCommentAutomationDecision({ row: safeRow, featureFlags, automationSettings: effectiveSettings });
  const sessionId = text(safeRow.inbox_conversation_id || conversation?.session_id || `social_comment:${text(safeRow.platform || "facebook")}:${text(safeRow.root_comment_id || safeRow.comment_id)}`);
  const channel = text(safeRow.channel || (text(safeRow.platform) === "instagram" ? "instagram_comment" : "facebook_comment"));
  const appendTranscript = deps.appendTranscriptFn || appendSocialCommentAutomationTranscript;
  const persistState = deps.persistStateFn || persistSocialCommentAutomationState;
  const stageSummary = buildSocialCommentAutomationState({
    row: safeRow,
    featureFlags: decision.featureFlags,
    automationSettings: decision.automationSettings,
    overallStatus: decision.enabled ? "pending" : "skipped",
    reason: decision.reason,
    commentId: safeRow.comment_id,
    sessionId,
  });
  const hasPriorFinalState = [safeRow.like_status, safeRow.public_reply_status, safeRow.dm_status]
    .map((status) => text(status).toLowerCase())
    .some((status) => socialCommentAutomationStepFinal(status))
    || ["completed", "partial", "failed"].includes(text(safeRow.automation_state?.overall_status || safeRow.automation_state?.status || "").toLowerCase());

  if (!decision.enabled) {
    if (hasPriorFinalState) {
      return { skipped: true, reason: decision.reason || "automation_disabled", decision, row: safeRow, preserved: true };
    }
    const skippedRow = await persistState({
      tenantId: safeTenantId,
      platform: safeRow.platform,
      commentId: safeRow.comment_id,
      sessionId,
      channel,
      actionTaken: decision.eligible ? `automation_skipped_${decision.reason || "disabled"}` : "automation_skipped_ineligible",
      likeStatus: "skipped",
      publicReplyStatus: "skipped",
      dmStatus: "skipped",
      errorCode: decision.reason || "",
      automationState: stageSummary,
    });
    return { skipped: true, reason: decision.reason || "automation_disabled", decision, row: skippedRow || safeRow };
  }

  const likeFn = deps.likeCommentFn || likeComment;
  const publicReplyFn = deps.replyToCommentFn || replyToComment;
  const privateReplyFn = deps.sendPrivateReplyFn || sendPrivateReply;
  const resolvedProductContext = metadataObject(
    safeRow.product_context ||
    safeRow.raw_payload?.product_context ||
    safeRow.metadata?.product_context ||
    {}
  );
  const hasProductContext = hasLinkedProductForAutomation({ row: safeRow, productContext: resolvedProductContext });
  const websiteLinks = {
    product_link: text(
      resolvedProductContext.product_link ||
      resolvedProductContext.product_url ||
      resolvedProductContext.storefront_url ||
      safeRow.product_url ||
      safeRow.metadata?.website_product_link ||
      ""
    ),
    product_url: text(
      resolvedProductContext.product_url ||
      resolvedProductContext.storefront_url ||
      resolvedProductContext.product_link ||
      safeRow.product_url ||
      ""
    ),
    checkout_link: text(
      resolvedProductContext.checkout_link ||
      safeRow.checkout_link ||
      safeRow.metadata?.checkout_link ||
      buildAutomationPublicUrl("/shop/checkout")
    ),
  };
  const templateContext = buildAutomationTemplateContext({
    row: safeRow,
    productContext: resolvedProductContext,
    websiteLinks,
  });
  const salesContext = buildSocialCommentSalesContext({
    row: safeRow,
    productContext: resolvedProductContext,
    websiteLinks,
    templateContext,
  });
  const publicReplyText = text(decision.automationSettings?.public_reply_template || COMMENT_AUTOMATION_PUBLIC_REPLY_TEXT);
  const privateReplyTemplate = text(decision.automationSettings?.private_message_template || "");
  const initialReplyText = text(privateReplyTemplate || conversation?.suggested_reply || conversation?.metadata?.lead?.suggested_reply || safeRow.suggested_reply || buildSocialCommentSuggestedReply({
    classificationLabel: safeRow.classification_label,
    commenterName: safeRow.commenter_name,
    originalCommentText: safeRow.original_comment_text,
    postPermalink: safeRow.post_permalink,
  }));
  const productAwarePrivateReply = buildProductAwarePrivateReply({
    salesContext,
    customerName: templateContext.customerName || safeRow.commenter_name || safeRow.customer_name || "",
  });
  if (hasProductContext && isGenericSocialCommentPrivateReply(initialReplyText)) {
    console.warn("SOCIAL_COMMENT_PRIVATE_REPLY_PRODUCT_CONTEXT_DROPPED", {
      post_id: text(safeRow.post_id || ""),
      comment_id: text(safeRow.comment_id || ""),
      product_ids: asArray(resolvedProductContext.mapped_products || [])
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
      primary_product_id: Number(
        resolvedProductContext.primary_product?.product_id ||
        resolvedProductContext.primary_product?.id ||
        resolvedProductContext.product_id ||
        0
      ) || null,
      product_name: text(resolvedProductContext.product_name || resolvedProductContext.primary_product?.name || ""),
      reply_preview: initialReplyText,
    });
  }
  const replyText = text(
    hasProductContext && productAwarePrivateReply
      ? productAwarePrivateReply
      : initialReplyText
  );
  const automationState = {
    ...stageSummary,
    overall_status: "running",
    requested_steps: decision.requested,
  };
  let likeStatus = text(safeRow.like_status || "");
  let publicReplyStatus = text(safeRow.public_reply_status || "");
  let dmStatus = text(safeRow.dm_status || "");
  let errorCode = text(safeRow.error_code || "");
  const requestedAny = Object.values(decision.requested).some(Boolean);
  const currentStatuses = {
    like: likeStatus || "skipped",
    public_reply: publicReplyStatus || "skipped",
    private_message: dmStatus || "skipped",
  };

  const reportState = async ({ actionTaken = "", reason = "" } = {}) => {
    automationState.overall_status = reason ? "partial" : "completed";
    automationState.reason = reason || automationState.reason || "";
    automationState.like_status = likeStatus || automationState.like_status || "skipped";
    automationState.public_reply_status = publicReplyStatus || automationState.public_reply_status || "skipped";
    automationState.dm_status = dmStatus || automationState.dm_status || "skipped";
    automationState.error_code = errorCode || automationState.error_code || "";
    automationState.updated_at = new Date().toISOString();
    return persistState({
      tenantId: safeTenantId,
      platform: safeRow.platform,
      commentId: safeRow.comment_id,
      sessionId,
      channel,
      actionTaken,
      likeStatus,
      publicReplyStatus,
      dmStatus,
      errorCode,
      automationState,
    });
  };

  if (!requestedAny) {
    if (hasPriorFinalState) {
      return { skipped: true, reason: "feature_flags_disabled", decision, row: safeRow, preserved: true };
    }
    automationState.overall_status = "skipped";
    automationState.reason = "feature_flags_disabled";
    const skippedRow = await reportState({ actionTaken: "automation_skipped_feature_flags", reason: "feature_flags_disabled" });
    return { skipped: true, reason: "feature_flags_disabled", decision, row: skippedRow || safeRow };
  }

  const publicReplyNeeded = decision.requested.publicReply && !socialCommentAutomationStepFinal(publicReplyStatus);
  const likeNeeded = decision.requested.like && !socialCommentAutomationStepFinal(likeStatus);
  const privateMessageNeeded = decision.requested.privateMessage && !socialCommentAutomationStepFinal(dmStatus);
  const stepErrors = [];

  const runStep = async ({
    key,
    messageType,
    deliveryStatusValue,
    send,
    message,
    successLabel,
    failureLabel,
    buildExternalId,
  }) => {
    try {
      const response = await send();
      const externalReplyId = text(buildExternalId?.(response) || response?.id || response?.comment_id || response?.reply_id || "");
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType,
        message,
        deliveryStatus: deliveryStatusValue,
        deliveryError: "",
        externalMessageId: externalReplyId,
        externalReplyId,
      });
      if (key === "like") likeStatus = "sent";
      if (key === "public_reply") publicReplyStatus = "sent";
      if (key === "private_message") dmStatus = "sent";
      automationState[key === "public_reply" ? "public_reply_status" : key === "private_message" ? "dm_status" : "like_status"] = "sent";
      automationState.last_success = key;
      automationState.last_error = "";
      console.log(`[social-comments][automation] ${successLabel}`, {
        tenant_id: safeTenantId,
        comment_id: safeRow.comment_id,
        session_id: sessionId,
        channel,
      });
      return null;
    } catch (error) {
      const errorMessage = error?.message || `${key} failed`;
      const failureCode = !error?.status || /fetch failed|network|timeout|ENOTFOUND|ECONNREFUSED/i.test(errorMessage)
        ? "transport_failed"
        : "meta_reply_failed";
      if (key === "like") likeStatus = "failed";
      if (key === "public_reply") publicReplyStatus = "failed";
      if (key === "private_message") dmStatus = "failed";
      errorCode = failureCode;
      automationState[key === "public_reply" ? "public_reply_status" : key === "private_message" ? "dm_status" : "like_status"] = "failed";
      automationState.last_error = errorMessage;
      automationState.error_code = failureCode;
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType: "automation_error",
        message: errorMessage,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        externalMessageId: "",
        externalReplyId: "",
      });
      await appendTranscript({
        tenantId: safeTenantId,
        sessionId,
        channel,
        messageType,
        message,
        deliveryStatus: "failed",
        deliveryError: errorMessage,
        externalMessageId: "",
        externalReplyId: "",
      });
      stepErrors.push({ key, message: errorMessage, code: failureCode });
      console.warn(`[social-comments][automation] ${failureLabel}`, {
        tenant_id: safeTenantId,
        comment_id: safeRow.comment_id,
        session_id: sessionId,
        channel,
        code: failureCode,
        message: errorMessage,
      });
      return errorMessage;
    }
  };

  if (likeNeeded) {
    await runStep({
      key: "like",
      messageType: "comment_like",
      deliveryStatusValue: "sent",
      send: () => likeFn(safeRow.platform, safeRow.comment_id, safeTenantId),
      message: "تم عمل لايك على الكومنت",
      successLabel: "like success",
      failureLabel: "like failed",
    });
  } else if (decision.requested.like) {
    likeStatus = socialCommentAutomationStepFinal(likeStatus) ? likeStatus : "skipped";
  }

  if (publicReplyNeeded) {
    await runStep({
      key: "public_reply",
      messageType: "comment_public_reply",
      deliveryStatusValue: "sent",
      send: () => publicReplyFn(safeRow.platform, safeRow.comment_id, publicReplyText, safeTenantId),
      message: publicReplyText,
      successLabel: "public reply success",
      failureLabel: "public reply failed",
      buildExternalId: (response) => response?.id || response?.comment_id || response?.reply_id || "",
    });
  } else if (decision.requested.publicReply) {
    publicReplyStatus = socialCommentAutomationStepFinal(publicReplyStatus) ? publicReplyStatus : "skipped";
  }

  if (privateMessageNeeded) {
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_CONTEXT_USED", {
      post_id: text(safeRow.post_id || ""),
      comment_id: text(safeRow.comment_id || ""),
      has_product_context: hasProductContext,
      product_ids: asArray(resolvedProductContext.mapped_products || [])
        .map((item) => Number(item?.product_id || item?.id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
      primary_product_id: Number(
        resolvedProductContext.primary_product?.product_id ||
        resolvedProductContext.primary_product?.id ||
        resolvedProductContext.product_id ||
        0
      ) || null,
      product_name: text(resolvedProductContext.product_name || resolvedProductContext.primary_product?.name || ""),
      reply_preview: replyText || publicReplyText,
    });
    await runStep({
      key: "private_message",
      messageType: "comment_private_reply",
      deliveryStatusValue: "sent",
      send: () => privateReplyFn(safeRow.platform, safeRow.comment_id, replyText || publicReplyText, safeTenantId),
      message: replyText || publicReplyText,
      successLabel: "private message success",
      failureLabel: "private message failed",
      buildExternalId: (response) => response?.id || response?.message_id || response?.reply_id || "",
    });
  } else if (decision.requested.privateMessage) {
    dmStatus = socialCommentAutomationStepFinal(dmStatus) ? dmStatus : "skipped";
  }

  const hasAnySent = [likeStatus, publicReplyStatus, dmStatus].some((status) => text(status).toLowerCase() === "sent");
  const hasAnyFailed = [likeStatus, publicReplyStatus, dmStatus].some((status) => text(status).toLowerCase() === "failed");
  const overallStatus = stepErrors.length
    ? (hasAnySent ? "partial" : "failed")
    : (hasAnyFailed ? (hasAnySent ? "partial" : "failed") : "completed");
  automationState.overall_status = overallStatus;
  automationState.reason = stepErrors.length ? "automation_step_failed" : (hasAnyFailed ? "previous_step_failed" : "");
  automationState.error_code = errorCode || "";
  automationState.like_status = likeStatus || "skipped";
  automationState.public_reply_status = publicReplyStatus || "skipped";
  automationState.dm_status = dmStatus || "skipped";
  automationState.updated_at = new Date().toISOString();

  const finalAction = overallStatus === "completed"
    ? "automation_completed"
    : overallStatus === "partial"
      ? "automation_partial"
      : "automation_failed";
  const updatedRow = await reportState({ actionTaken: finalAction, reason: automationState.reason || "" });
  emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", {
    tenant_id: safeTenantId,
    session_id: sessionId,
    at: new Date().toISOString(),
  });

  return {
    skipped: false,
    decision,
    row: updatedRow || safeRow,
    session_id: sessionId,
    channel,
    status: overallStatus,
    like_status: likeStatus || "skipped",
    public_reply_status: publicReplyStatus || "skipped",
    dm_status: dmStatus || "skipped",
    error_code: errorCode || "",
    automation_state: automationState,
    errors: stepErrors,
  };
};

let socialCommentSchemaReadyPromise = null;
const isSocialCommentAutomationSchemaInitEnabled = () => {
  const flag = String(process.env.ENABLE_SOCIAL_COMMENT_SCHEMA_INIT || process.env.ENABLE_SCHEMA_MIGRATIONS || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) return true;
  return String(process.env.NODE_ENV || "").toLowerCase() !== "production";
};

export const ensureSocialCommentAutomationSchema = async (clientOrPool = db) => {
  if (!isSocialCommentAutomationSchemaInitEnabled()) {
    return { skipped: true, reason: "schema_init_disabled" };
  }
  if (!socialCommentSchemaReadyPromise) {
    socialCommentSchemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS social_comment_automation_runs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          channel TEXT NOT NULL,
          post_id TEXT NOT NULL DEFAULT '',
          post_permalink TEXT NOT NULL DEFAULT '',
          comment_id TEXT NOT NULL,
          parent_comment_id TEXT NOT NULL DEFAULT '',
          root_comment_id TEXT NOT NULL DEFAULT '',
          commenter_id TEXT NOT NULL DEFAULT '',
          commenter_name TEXT NOT NULL DEFAULT '',
          commenter_profile_picture_url TEXT NOT NULL DEFAULT '',
          original_comment_text TEXT NOT NULL DEFAULT '',
          classification_label TEXT NULL,
          classification_score NUMERIC(6,4) NULL,
          action_taken TEXT NULL,
          public_reply_status TEXT NULL,
          dm_status TEXT NULL,
          like_status TEXT NULL,
          inbox_conversation_id TEXT NULL,
          error_code TEXT NULL,
          automation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          skipped_reason TEXT NOT NULL DEFAULT '',
          matched_config_key TEXT NOT NULL DEFAULT '',
          resolved_post_id TEXT NOT NULL DEFAULT '',
          resolved_platform_post_id TEXT NOT NULL DEFAULT '',
          resolved_product_id BIGINT NULL,
          duplicate_reason TEXT NOT NULL DEFAULT '',
          config_found BOOLEAN NOT NULL DEFAULT FALSE,
          config_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, comment_id)
        )
      `);

      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_post_platform ON social_comment_automation_runs (tenant_id, post_id, platform, created_at DESC)`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS status TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS step_results JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS error_message TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS automation_state JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS skipped_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS matched_config_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_platform_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS resolved_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS duplicate_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_found BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_runs ADD COLUMN IF NOT EXISTS config_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS social_comment_automation_run_audits (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          post_id TEXT NOT NULL DEFAULT '',
          comment_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'duplicate_skipped',
          skipped_reason TEXT NOT NULL DEFAULT '',
          matched_config_key TEXT NOT NULL DEFAULT '',
          resolved_post_id TEXT NOT NULL DEFAULT '',
          resolved_platform_post_id TEXT NOT NULL DEFAULT '',
          resolved_product_id BIGINT NULL,
          duplicate_reason TEXT NOT NULL DEFAULT '',
          config_found BOOLEAN NOT NULL DEFAULT FALSE,
          config_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          step_results JSONB NOT NULL DEFAULT '[]'::jsonb,
          product_link TEXT NOT NULL DEFAULT '',
          checkout_link TEXT NOT NULL DEFAULT '',
          guidance_mode TEXT NOT NULL DEFAULT 'website_checkout',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS matched_config_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_platform_post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS resolved_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS duplicate_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS config_found BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE social_comment_automation_run_audits ADD COLUMN IF NOT EXISTS config_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_run_audits_tenant_created ON social_comment_automation_run_audits (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_run_audits_tenant_platform_post ON social_comment_automation_run_audits (tenant_id, platform, post_id, created_at DESC)`);
    })();
  }

  return socialCommentSchemaReadyPromise;
};

const normalizedPlatform = (body = {}) => lower(body.object) === "instagram" ? "instagram" : "facebook";
const normalizedChannel = (platform = "") => platform === "instagram" ? "instagram_comment" : "facebook_comment";

const isCommentChange = (body = {}, change = {}) => {
  const field = lower(change.field);
  const value = change.value || {};
  const item = lower(value.item);
  const verb = lower(value.verb);
  const allowedVerb = ["add", "created", "edited", "edit", ""].includes(verb);
  if (body.object === "instagram" && (field === "comments" || field === "mentions") && item === "comment" && allowedVerb) return true;
  if (field === "feed" && item === "comment" && allowedVerb) return true;
  return Boolean(value.comment_id || value.parent_id || value.post_id || value.media_id);
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";
const extractGraphPictureUrl = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return text(value);
  return firstText(value.data?.url, value.url, value.source, value.picture?.url, value.picture?.data?.url);
};
const bigintOrNull = (value) => {
  const normalized = text(value || "");
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveCommentId = ({ platform = "", postId = "", parentCommentId = "", commenterId = "", commentText = "", timestamp = "", value = {}, change = {}, entry = {}, body = {} } = {}) => {
  const explicit = firstText(
    value.comment_id,
    value.id,
    value.comment?.id,
    value.commentId,
    value.comment_id_str,
    change.comment_id,
    change.id,
    entry.comment_id,
    entry.id
  );
  if (explicit) return explicit;
  const source = [
    platform,
    postId,
    parentCommentId,
    commenterId,
    commentText,
    timestamp,
    value.permalink_url || value.permalink || value.link || "",
    body.object || "",
  ].join("|");
  return `comment:${crypto.createHash("sha256").update(source).digest("hex")}`;
};

const normalizeCommentWebhookChange = ({ body = {}, entry = {}, change = {}, tenantId = null } = {}) => {
  const value = change.value || {};
  const platform = normalizedPlatform(body);
  const channel = normalizedChannel(platform);
  const postId = firstText(value.post_id, value.media_id, value.id, entry.id);
  const postPermalink = firstText(value.permalink_url, value.post_permalink, value.permalink, value.link, value.url);
  const postMessage = firstText(value.post_message, value.post_caption, value.post?.message, value.post?.caption);
  const postCreatedTime = firstText(value.post_created_time, value.post?.created_time, value.post?.updated_time);
  const commenterId = firstText(value.from?.id, value.from?.username, value.sender_id, value.user_id, value.commenter_id, value.author_id);
  const commenterName = firstText(value.from?.name, value.from?.username, value.username, value.commenter_name, value.author_name, value.from?.full_name);
  const commenterProfilePictureUrl = firstText(
    value.from?.profile_pic,
    value.from?.profile_picture_url,
    value.profile_picture_url,
    value.profile_pic_url,
    value.user_profile_picture,
    extractGraphPictureUrl(value.from?.picture)
  );
  const originalCommentText = firstText(value.message, value.text, value.comment_text, value.caption, value.message_text);
  const timestamp = firstText(value.created_time, value.timestamp, change.created_time, change.timestamp, entry.time, entry.created_time);
  console.info("SOCIAL_COMMENT_WEBHOOK_RAW", {
    raw_post_id: firstText(value.post_id, value.media_id, value.id, entry.id),
    raw_object_id: firstText(body.object, change.object, entry.object, value.object_id, value.object),
    raw_parent_id: firstText(value.parent_id, value.parent_comment_id, value.parent?.id),
    raw_comment_id: firstText(value.comment_id, value.id, value.commentId, change.comment_id),
    post_permalink: postPermalink,
    post_message: postMessage,
  });
  const commentId = deriveCommentId({
    platform,
    postId,
    parentCommentId: firstText(value.parent_id, value.parent_comment_id, value.parent?.id),
    commenterId,
    commentText: originalCommentText,
    timestamp,
    value,
    change,
    entry,
    body,
  });
  const parentCommentId = firstText(value.parent_id, value.parent_comment_id, value.parent?.id);
  const rootCommentId = firstText(value.root_comment_id, value.root_id, value.thread_root_id, value.thread_id, value.parent_id, value.parent_comment_id) || commentId;
  const commentUrl = postPermalink && commentId ? `${postPermalink}${postPermalink.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(commentId)}` : "";
  const classification = classifySocialCommentIntent(originalCommentText);
  const pageId = firstText(entry.id, value.page_id, value.metadata?.page_id, value.account_id);
  console.log("[COMMENT_EVENT_PARSED]", {
    platform,
    page_id: pageId,
    post_id: postId,
    comment_id: commentId,
    from_id: commenterId,
    text_length: originalCommentText.length,
  });
  console.info("SOCIAL_COMMENT_POST_IDENTITY_TRACE", {
    tenant_id: tenantId,
    platform,
    post_id: postId,
    platform_post_id: firstText(value.post_id, value.media_id, value.id, entry.id),
    canonical_post_id: firstText(value.post?.id, value.post?.post_id, value.parent?.post_id, value.parent?.id, postId),
    conversation_id: firstText(value.conversation_id, value.thread_id, entry.conversation_id, entry.id, value.parent?.conversation_id),
    parent_id: parentCommentId,
    raw_webhook_post_id: firstText(value.post_id, value.media_id, value.id, entry.id),
    raw_graph_post_id: firstText(value.post?.id, value.parent?.post_id, value.parent?.id, value.post?.object_id, value.graph_post_id),
    permalink_url: postPermalink,
    comment_id: commentId,
  });

  return {
    tenant_id: tenantId,
    platform,
    channel,
    post_id: postId,
    post_permalink: postPermalink,
    post_permalink_url: postPermalink,
    post_message: postMessage,
    post_caption: firstText(value.post_caption, value.post?.caption),
    post_created_time: postCreatedTime || "",
    comment_id: commentId,
    comment_created_time: timestamp,
    comment_url: commentUrl,
    parent_comment_id: parentCommentId,
    root_comment_id: rootCommentId,
    commenter_id: commenterId,
    commenter_name: commenterName,
    commenter_profile_picture_url: commenterProfilePictureUrl,
    original_comment_text: originalCommentText,
    classification_label: classification.label,
    classification_score: classification.score,
    action_taken: "classified_only",
    public_reply_status: null,
    dm_status: null,
    like_status: null,
    inbox_conversation_id: null,
    error_code: null,
    automation_state: {},
    raw_payload: {
      source: "meta_webhook",
      body_object: body.object || "",
      entry_id: entry.id || "",
      field: change.field || "",
      item: value.item || "",
      verb: value.verb || "",
      value,
      entry,
      body,
      platform,
      channel,
      comment_id: commentId,
      post_message: postMessage,
      post_caption: firstText(value.post_caption, value.post?.caption),
      post_created_time: postCreatedTime || "",
      comment_created_time: timestamp,
      comment_url: commentUrl,
    },
    processed_at: new Date().toISOString(),
  };
};

export const extractSocialCommentWebhookEvents = ({ body = {}, tenantId = null } = {}) => {
  const events = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.changes).forEach((change) => {
      const value = change.value || {};
      console.log("[META_WEBHOOK_CHANGE_DEBUG]", {
        object: text(body.object || ""),
        field: text(change.field || ""),
        item: text(value.item || ""),
        verb: text(value.verb || ""),
        post_id: text(value.post_id || value.media_id || value.id || entry.id || ""),
        comment_id: text(value.comment_id || value.commentId || value.id || ""),
        from_id: text(value.from?.id || value.from?.user_id || value.user_id || ""),
        from_name: text(value.from?.name || value.from?.full_name || value.commenter_name || value.author_name || ""),
        message: text(value.message || value.text || value.comment_text || value.message_text || ""),
        raw_value_keys: Object.keys(value || {}),
      });
      if (!isCommentChange(body, change)) return;
      console.log("[COMMENT_WEBHOOK_HIT]", {
        platform: normalizedPlatform(body),
        field: text(change.field || ""),
        object: text(body.object || ""),
        entry_id: entry.id || "",
      });
      const normalized = normalizeCommentWebhookChange({ body, entry, change, tenantId });
      if (!normalized.comment_id) return;
      events.push(normalized);
    });
  });
  return events;
};

export const storeSocialCommentAutomationRuns = async ({ tenantId = null, events = [], deferAutomation = true } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const stored = [];
  for (const event of asArray(events)) {
    let normalized = {
      tenant_id: tenantId ?? event.tenant_id,
      platform: text(event.platform || "facebook") || "facebook",
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")) || "facebook_comment",
      post_id: text(event.post_id || ""),
      post_permalink: text(event.post_permalink || ""),
      comment_id: text(event.comment_id || ""),
      parent_comment_id: text(event.parent_comment_id || ""),
      root_comment_id: text(event.root_comment_id || ""),
      commenter_id: text(event.commenter_id || ""),
      commenter_name: text(event.commenter_name || ""),
      commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
      original_comment_text: text(event.original_comment_text || ""),
      post_message: text(event.post_message || ""),
      post_caption: text(event.post_caption || ""),
      post_full_picture: text(event.post_full_picture || event.full_picture || ""),
      post_created_time: text(event.post_created_time || ""),
      comment_created_time: text(event.comment_created_time || ""),
      comment_url: text(event.comment_url || ""),
      post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      classification_label: event.classification_label ?? null,
      classification_score: event.classification_score ?? null,
      action_taken: event.action_taken ?? "ingested",
      public_reply_status: event.public_reply_status ?? null,
      dm_status: event.dm_status ?? null,
      like_status: event.like_status ?? null,
      inbox_conversation_id: event.inbox_conversation_id ?? null,
      error_code: event.error_code ?? null,
      automation_state: event.automation_state && typeof event.automation_state === "object" ? event.automation_state : {},
      raw_payload: {
        ...(event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : { raw_payload: event.raw_payload ?? null }),
        post_message: text(event.post_message || ""),
        post_caption: text(event.post_caption || ""),
        post_full_picture: text(event.post_full_picture || event.full_picture || ""),
        post_created_time: text(event.post_created_time || ""),
        comment_created_time: text(event.comment_created_time || ""),
        comment_url: text(event.comment_url || ""),
        post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      },
      post_message: text(event.post_message || ""),
      post_caption: text(event.post_caption || ""),
      post_created_time: text(event.post_created_time || ""),
      comment_created_time: text(event.comment_created_time || ""),
      comment_url: text(event.comment_url || ""),
      post_permalink_url: text(event.post_permalink_url || event.post_permalink || ""),
      processed_at: event.processed_at ? new Date(event.processed_at).toISOString() : new Date().toISOString(),
    };

    const isJobOnly = Boolean(event.__job_only && event.row);
    let storedRow = isJobOnly ? event.row : null;
    if (!isJobOnly) {
      const insertResult = await db.query(
        `
        INSERT INTO social_comment_automation_runs (
          tenant_id, platform, channel, post_id, post_permalink, comment_id, parent_comment_id, root_comment_id,
          commenter_id, commenter_name, commenter_profile_picture_url, original_comment_text, classification_label,
          classification_score, action_taken, public_reply_status, dm_status, like_status, inbox_conversation_id,
          error_code, automation_state, raw_payload, processed_at, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          $20, $21::jsonb, $22::jsonb, $23::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
          channel = EXCLUDED.channel,
          post_id = EXCLUDED.post_id,
          post_permalink = EXCLUDED.post_permalink,
          parent_comment_id = EXCLUDED.parent_comment_id,
          root_comment_id = EXCLUDED.root_comment_id,
          commenter_id = EXCLUDED.commenter_id,
          commenter_name = COALESCE(NULLIF(EXCLUDED.commenter_name, ''), social_comment_automation_runs.commenter_name),
          commenter_profile_picture_url = COALESCE(NULLIF(EXCLUDED.commenter_profile_picture_url, ''), social_comment_automation_runs.commenter_profile_picture_url),
          original_comment_text = COALESCE(NULLIF(EXCLUDED.original_comment_text, ''), social_comment_automation_runs.original_comment_text),
          classification_label = COALESCE(social_comment_automation_runs.classification_label, EXCLUDED.classification_label),
          classification_score = COALESCE(social_comment_automation_runs.classification_score, EXCLUDED.classification_score),
          action_taken = CASE
            WHEN social_comment_automation_runs.action_taken IS NULL OR social_comment_automation_runs.action_taken = 'ingested'
              THEN EXCLUDED.action_taken
            ELSE social_comment_automation_runs.action_taken
          END,
          public_reply_status = COALESCE(social_comment_automation_runs.public_reply_status, EXCLUDED.public_reply_status),
          dm_status = COALESCE(social_comment_automation_runs.dm_status, EXCLUDED.dm_status),
          like_status = COALESCE(social_comment_automation_runs.like_status, EXCLUDED.like_status),
          inbox_conversation_id = COALESCE(social_comment_automation_runs.inbox_conversation_id, EXCLUDED.inbox_conversation_id),
          error_code = COALESCE(social_comment_automation_runs.error_code, EXCLUDED.error_code),
          automation_state = COALESCE(social_comment_automation_runs.automation_state, EXCLUDED.automation_state),
          raw_payload = EXCLUDED.raw_payload,
          processed_at = COALESCE(social_comment_automation_runs.processed_at, EXCLUDED.processed_at),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
        `,
        [
          normalized.tenant_id,
          normalized.platform,
          normalized.channel,
          normalized.post_id,
          normalized.post_permalink,
          normalized.comment_id,
          normalized.parent_comment_id,
          normalized.root_comment_id,
          normalized.commenter_id,
          normalized.commenter_name,
          normalized.commenter_profile_picture_url,
          normalized.original_comment_text,
          normalized.classification_label,
          normalized.classification_score,
          normalized.action_taken,
          normalized.public_reply_status,
          normalized.dm_status,
          normalized.like_status,
          normalized.inbox_conversation_id,
          normalized.error_code,
          JSON.stringify(normalized.automation_state || {}),
          JSON.stringify(normalized.raw_payload || {}),
          normalized.processed_at,
        ]
      );
      storedRow = insertResult.rows[0] || null;
      if (!storedRow) {
        const existingRowResult = await db.query(
          `
          SELECT *
          FROM social_comment_automation_runs
          WHERE tenant_id = $1::bigint
            AND platform = $2::text
            AND comment_id = $3::text
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
          `,
          [normalized.tenant_id, normalized.platform, normalized.comment_id]
        ).catch(() => ({ rows: [] }));
        storedRow = existingRowResult.rows[0] || {
          ...normalized,
          id: null,
          raw_payload: normalized.raw_payload || {},
        };
      }
      emitSocialCommentNew(storedRow);
    }
    if (deferAutomation) {
      const automationJob = {
        type: "social_comment_automation",
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: storedRow.post_id,
        comment_id: storedRow.comment_id,
        external_comment_id: storedRow.comment_id,
        payload: {
          row: storedRow,
        },
        created_at: new Date().toISOString(),
      };
      try {
        await enqueueSocialCommentJob(automationJob);
      } catch (error) {
        console.warn("SOCIAL_COMMENT_JOB_ENQUEUE_FALLBACK", {
          tenant_id: storedRow.tenant_id,
          platform: storedRow.platform,
          post_id: text(storedRow.post_id || ""),
          comment_id: text(storedRow.comment_id || ""),
          message: error?.message || "",
        });
        await storeSocialCommentAutomationRuns({
          tenantId: storedRow.tenant_id,
          deferAutomation: false,
          events: [
            {
              ...storedRow,
              __job_only: true,
              row: storedRow,
            },
          ],
        });
      }
      continue;
    }
    const productContext = await resolveSocialCommentPublishedProductContext({
      tenantId: storedRow.tenant_id,
      row: storedRow,
    }).catch(() => null);
    if (productContext?.found) {
      storedRow.product_context = productContext;
      storedRow.raw_payload = {
        ...(storedRow.raw_payload || {}),
        product_context: productContext,
      };
      console.log("SOCIAL_COMMENT_AUTOMATION_PRODUCT_RESOLVED", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        product_id: text(productContext.product_id || ""),
        product_name: text(productContext.product_name || ""),
        product_url: text(productContext.product_url || ""),
        sizes: asArray(productContext.sizes || []),
        source: text(productContext.source || ""),
      });
    } else {
      console.log("SOCIAL_COMMENT_AUTOMATION_PRODUCT_NOT_FOUND", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        reason: text(productContext?.reason || "product_not_found"),
      });
    }
    const automationConfig = await loadPostAutomationConfig({
      tenantId: storedRow.tenant_id,
      platform: storedRow.platform,
      postId: storedRow.post_id,
      row: storedRow,
    }).catch(() => null);
    const renderedPrivateReplyTemplate = text(automationConfig?.message_templates?.privateReplyTemplate || "");
    const renderedPrivateReplyFallback = text(storedRow.automation_state?.private_reply?.rendered_reply || "");
    const legacyWebsiteLinks = {
      product_link: text(
        productContext?.product_link ||
        productContext?.product_url ||
        productContext?.storefront_url ||
        storedRow.product_url ||
        storedRow.metadata?.website_product_link ||
        ""
      ),
      product_url: text(
        productContext?.product_url ||
        productContext?.storefront_url ||
        productContext?.product_link ||
        storedRow.product_url ||
        ""
      ),
      checkout_link: text(
        productContext?.checkout_link ||
        storedRow.checkout_link ||
        storedRow.metadata?.checkout_link ||
        buildAutomationPublicUrl("/shop/checkout")
      ),
    };
    const legacyTemplateContext = buildAutomationTemplateContext({
      row: storedRow,
      productContext: productContext || {},
      websiteLinks: legacyWebsiteLinks,
    });
    const legacySalesContext = buildSocialCommentSalesContext({
      row: storedRow,
      productContext: productContext || {},
      websiteLinks: legacyWebsiteLinks,
      templateContext: legacyTemplateContext,
    });
    const legacyProductAwarePrivateReply = buildProductAwarePrivateReply({
      salesContext: legacySalesContext,
      customerName: legacyTemplateContext.customerName || storedRow.commenter_name || storedRow.customer_name || "",
    });
    const queuedPrivateReplyText = text(
      hasLinkedProductForAutomation({ row: storedRow || {}, productContext }) && legacyProductAwarePrivateReply
        ? legacyProductAwarePrivateReply
        : (renderedPrivateReplyFallback || renderedPrivateReplyTemplate || "")
    );
    console.log("SOCIAL_COMMENT_AUTOMATION_CONFIG_LOADED", {
      tenant_id: storedRow.tenant_id,
      platform: storedRow.platform,
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      config_enabled: Boolean(automationConfig?.enabled),
      matched_key: text(automationConfig?.lookup_matched_key || ""),
      loaded_template: renderedPrivateReplyTemplate,
      fallback_reason: automationConfig?.enabled ? "" : text(automationConfig?.lookup_matched_key ? "config_disabled_or_incomplete" : "no_config"),
    });
    const privateReplyTrigger = isSupportedWebhookCommentTrigger(storedRow);
    debugSocialCommentsLog("[social-comments][private-reply] received", {
      tenant_id: storedRow.tenant_id,
      platform: storedRow.platform,
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      field: text(storedRow.raw_payload?.field || ""),
      item: text(storedRow.raw_payload?.value?.item || ""),
      verb: text(storedRow.raw_payload?.value?.verb || ""),
      source: text(storedRow.raw_payload?.source || ""),
      trigger: privateReplyTrigger,
    });
    const privateReplyStatus = text(storedRow.dm_status || storedRow.automation_state?.private_reply?.status || "").toLowerCase();
    const privateReplySource = text(storedRow.raw_payload?.source || "").toLowerCase();
    const isFacebookComment = text(storedRow.platform || "").toLowerCase() === "facebook";
    const privateReplyEligible = isFacebookComment && Boolean(text(storedRow.comment_id || ""));
    const legacyPathEnabled = !automationConfig?.enabled && hasLinkedProductForAutomation({ row: storedRow || {}, productContext });
    console.log("SOCIAL_COMMENT_LEGACY_PATH_ENTERED", {
      tenant_id: storedRow.tenant_id,
      platform: storedRow.platform,
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      automation_config_enabled: Boolean(automationConfig?.enabled),
      runtime_applied: false,
      inserted_run: Boolean(storedRow.id),
    });
    const shouldQueuePrivateReply = privateReplyEligible && legacyPathEnabled && !["queued", "sending", "sent"].includes(privateReplyStatus);
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_TEMPLATE_STATE", {
      tenant_id: storedRow.tenant_id,
      platform: text(storedRow.platform || ""),
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      config_enabled: Boolean(automationConfig?.enabled),
      loaded_template: renderedPrivateReplyTemplate,
      rendered_template: renderedPrivateReplyFallback,
      enqueue_template: shouldQueuePrivateReply ? queuedPrivateReplyText : "",
      fallback_reason: !automationConfig?.enabled
        ? (!automationConfig ? "no_config" : "config_disabled")
        : "runtime_enabled",
    });
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_REACHED", {
      storedRow_id: storedRow.id || null,
      comment_id: text(storedRow.comment_id || ""),
      conversation_id: text(storedRow.inbox_conversation_id || ""),
      platform: text(storedRow.platform || ""),
      source: privateReplySource,
      private_reply_status: privateReplyStatus || "empty",
      eligible: privateReplyEligible,
    });
    if (!legacyPathEnabled) {
      console.log("SOCIAL_COMMENT_LEGACY_PATH_SKIPPED_AUTOMATION_ENABLED", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        automation_config_enabled: true,
      });
    } else if (shouldQueuePrivateReply) {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLING", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        platform: text(storedRow.platform || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
      });
      storedRow.dm_status = storedRow.dm_status || "queued";
      storedRow.automation_state = {
        ...(storedRow.automation_state || {}),
        private_reply: {
          requested: true,
          status: "queued",
          queued_at: new Date().toISOString(),
          template: renderedPrivateReplyTemplate || renderedPrivateReplyFallback || "",
          message: queuedPrivateReplyText,
          rendered_reply: queuedPrivateReplyText,
        },
      };
      storedRow.product_context = productContext || {};
      storedRow.raw_payload = {
        ...(storedRow.raw_payload || {}),
        product_context: productContext || {},
      };
      await persistSocialCommentAutomationState({
        tenantId: storedRow.tenant_id,
        platform: storedRow.platform,
        commentId: storedRow.comment_id,
        sessionId: storedRow.inbox_conversation_id || "",
        channel: storedRow.channel || "",
          dmStatus: "queued",
          automationState: storedRow.automation_state,
        }).catch(() => {});
      console.log("SOCIAL_COMMENT_SAVED_FOR_PRIVATE_REPLY", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_PAYLOAD", buildPrivateReplyEnqueuePayloadLog({
        row: storedRow,
        productContext: productContext || {},
      }));
      await enqueueSocialCommentPrivateReplyJob({
        tenantId: storedRow.tenant_id,
        platform: storedRow.platform,
        commentId: storedRow.comment_id,
          postId: storedRow.post_id,
          row: storedRow,
        }).catch(() => {});
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_CALLED", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        platform: text(storedRow.platform || ""),
        source: privateReplySource,
        private_reply_status: text(storedRow.dm_status || storedRow.automation_state?.private_reply?.status || "").toLowerCase() || "empty",
      });
    } else {
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_ENQUEUE_SKIPPED", {
        storedRow_id: storedRow.id || null,
        comment_id: text(storedRow.comment_id || ""),
        conversation_id: text(storedRow.inbox_conversation_id || ""),
        source: privateReplySource,
        private_reply_status: privateReplyStatus || "empty",
        reason: !privateReplyEligible
          ? "not_facebook_comment_or_missing_comment_id"
          : !legacyPathEnabled
            ? "automation_enabled"
          : `private_reply_status_${privateReplyStatus || "empty"}`,
      });
    }
    console.log("[COMMENT_EVENT_SAVED]", {
      platform: storedRow.platform,
      page_id: text(storedRow.raw_payload?.entry?.id || storedRow.raw_payload?.value?.page_id || ""),
      post_id: storedRow.post_id || "",
      comment_id: storedRow.comment_id || "",
      from_id: storedRow.commenter_id || "",
      text_length: String(storedRow.original_comment_text || "").length,
    });
    const webhookMedia = await fetchSocialCommentWebhookPostMedia({
      tenantId: storedRow.tenant_id,
      event: storedRow,
    }).catch(() => null);
    storedRow = applyWebhookPostMediaToEvent(storedRow, webhookMedia);
    let automationRuntimeApplied = false;
    if (automationConfig?.enabled) {
      console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_BEFORE", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        config_enabled: Boolean(automationConfig?.enabled),
        matched_key: text(automationConfig?.lookup_matched_key || ""),
      });
      console.info("SOCIAL_COMMENT_RUNTIME_SELECTED_POST", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        selected_post_id: text(storedRow.post_id || ""),
        selected_comment_id: text(storedRow.comment_id || ""),
        selected_post_permalink: text(storedRow.post_permalink || storedRow.post_permalink_url || ""),
      });
      const selectedPostId = text(storedRow.post_id || "");
      const selectedCommentId = text(storedRow.comment_id || "");
      const runtimePostId = text(storedRow.post_id || storedRow.raw_payload?.post_id || "");
      const runtimeCommentId = text(storedRow.comment_id || storedRow.raw_payload?.comment_id || "");
      const runtimeProductContextInput = buildRuntimeProductContextRow({
        row: storedRow,
        event: storedRow,
        selectedPostId,
        selectedCommentId,
        runtimePostId,
        runtimeCommentId,
        postId: text(storedRow.post_id || ""),
        commentId: text(storedRow.comment_id || ""),
      });
      console.log("SOCIAL_COMMENT_PRODUCT_CONTEXT_CALL_INPUT", {
        runtime_post_id: runtimePostId,
        runtime_comment_id: runtimeCommentId,
        selected_post_id: selectedPostId,
        selected_comment_id: selectedCommentId,
        final_post_id: runtimeProductContextInput.finalPostId,
        final_comment_id: runtimeProductContextInput.finalCommentId,
      });
      const runtimeProductContext = await resolveSocialCommentPublishedProductContext({
        tenantId: storedRow.tenant_id,
        row: runtimeProductContextInput.row,
      }).catch(() => null);
      console.log("SOCIAL_COMMENT_PRODUCT_CONTEXT_RESOLVED", buildSocialCommentProductContextResolvedLog({
        productContext: runtimeProductContext,
        row: runtimeProductContextInput.row,
      }));
      const automationRuntimeResult = await executeSocialCommentAutomationRuntime({
        tenantId: storedRow.tenant_id,
        platform: storedRow.platform,
        postId: storedRow.post_id,
        commentId: text(storedRow.comment_id || ""),
        row: storedRow,
        currentRunId: storedRow?.id || null,
        productContext: runtimeProductContext,
        config: automationConfig,
      }).catch((error) => {
        console.warn("SOCIAL_COMMENT_AUTOMATION_RUNTIME_FAILED", {
          tenant_id: storedRow.tenant_id,
          platform: storedRow.platform,
          post_id: text(storedRow.post_id || ""),
          comment_id: text(storedRow.comment_id || ""),
          message: error?.message || "",
        });
        return null;
      });
      console.log("SOCIAL_COMMENT_AUTOMATION_RUNTIME_AFTER", {
        tenant_id: storedRow.tenant_id,
        platform: storedRow.platform,
        post_id: text(storedRow.post_id || ""),
        comment_id: text(storedRow.comment_id || ""),
        applied: Boolean(automationRuntimeResult?.applied),
        skipped: Boolean(automationRuntimeResult?.skipped),
        reason: text(automationRuntimeResult?.reason || ""),
      });
      if (automationRuntimeResult?.row) {
        storedRow = automationRuntimeResult.row;
      }
      automationRuntimeApplied = Boolean(automationRuntimeResult?.applied);
    }
    if (!automationConfig?.enabled && !privateReplyTrigger) {
      try {
        const materialized = await upsertSocialCommentLeadConversation({
          tenantId: storedRow.tenant_id,
          event: storedRow,
          suggestedReply: "",
        });
          if (materialized?.session_id) {
            storedRow.inbox_conversation_id = materialized.session_id;
            await db.query(
              `
              UPDATE social_comment_automation_runs
            SET inbox_conversation_id = $3::text,
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
            `,
            [storedRow.tenant_id, storedRow.platform, materialized.session_id, storedRow.comment_id]
          );
          emitSocialCommentUpdated(storedRow);
        }
      } catch (error) {
        socialCommentsError("[social-comments] inbox conversation materialize failed", {
          tenant_id: storedRow.tenant_id,
          platform: storedRow.platform,
          comment_id: storedRow.comment_id,
          message: error?.message || "",
        });
        storedRow.error_code = storedRow.error_code || "comment_inbox_materialization_failed";
      }
      if (COMMENT_THREAD_LABELS.has(storedRow.classification_label)) {
        try {
          const materialized = await upsertSocialCommentLeadConversation({
            tenantId: storedRow.tenant_id,
            event: storedRow,
            suggestedReply: buildSocialCommentSuggestedReply({
              classificationLabel: storedRow.classification_label,
              commenterName: storedRow.commenter_name,
              originalCommentText: storedRow.original_comment_text,
              postPermalink: storedRow.post_permalink,
            }),
          });
          if (materialized?.session_id) {
            storedRow.inbox_conversation_id = materialized.session_id;
            storedRow.action_taken = storedRow.action_taken || "classified_only";
            await db.query(
              `
              UPDATE social_comment_automation_runs
              SET inbox_conversation_id = $3::text,
                  updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
              `,
              [storedRow.tenant_id, storedRow.platform, materialized.session_id, storedRow.comment_id]
            );
            emitSocialCommentUpdated(storedRow);
          }
          const automationResult = await executeSocialCommentAutomation({
            tenantId: storedRow.tenant_id,
            row: {
              ...storedRow,
              inbox_conversation_id: materialized?.session_id || storedRow.inbox_conversation_id || "",
            },
            conversation: materialized,
          });
          if (automationResult?.row) {
            storedRow.action_taken = automationResult.row.action_taken || storedRow.action_taken;
            storedRow.public_reply_status = automationResult.row.public_reply_status || storedRow.public_reply_status;
            storedRow.dm_status = automationResult.row.dm_status || storedRow.dm_status;
            storedRow.like_status = automationResult.row.like_status || storedRow.like_status;
            storedRow.error_code = automationResult.row.error_code || storedRow.error_code;
            storedRow.automation_state = automationResult.row.automation_state || storedRow.automation_state;
            storedRow.inbox_conversation_id = automationResult.row.inbox_conversation_id || storedRow.inbox_conversation_id;
            emitSocialCommentUpdated(storedRow);
          }
        } catch (error) {
          socialCommentsError("[social-comments] lead conversation materialize failed", {
            tenant_id: storedRow.tenant_id,
            platform: storedRow.platform,
            comment_id: storedRow.comment_id,
            classification_label: storedRow.classification_label,
            message: error?.message || "",
          });
          storedRow.error_code = storedRow.error_code || "comment_lead_materialization_failed";
          await db.query(
            `
            UPDATE social_comment_automation_runs
            SET error_code = COALESCE(NULLIF($3::text, ''), error_code),
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1::bigint AND platform = $2::text AND comment_id = $4::text
            `,
            [storedRow.tenant_id, storedRow.platform, storedRow.error_code, storedRow.comment_id]
          ).catch(() => {});
          emitSocialCommentUpdated(storedRow);
        }
      }
      if (!automationRuntimeApplied) {
        try {
          await processSocialCommentAutoReply({
            tenantId: storedRow.tenant_id,
            platform: storedRow.platform,
            postId: storedRow.post_id,
            commentId: storedRow.comment_id,
            comment: storedRow,
            post: storedRow,
            force: false,
          });
        } catch (error) {
          socialCommentsError("[social-comments] auto reply processing failed", {
            tenant_id: storedRow.tenant_id,
            platform: storedRow.platform,
            comment_id: storedRow.comment_id,
            message: error?.message || "",
          });
        }
      }
    }
    console.log("[META_WEBHOOK_COMMENT_STORED]", {
      tenant_id: storedRow.tenant_id,
      source: "webhook",
      post_id: text(storedRow.post_id || ""),
      comment_id: text(storedRow.comment_id || ""),
      from_id: text(storedRow.commenter_id || ""),
      from_name: text(storedRow.commenter_name || ""),
      inserted_run: storedRow.id || null,
      inserted_message: text(storedRow.original_comment_text || ""),
      conversation_id: text(storedRow.inbox_conversation_id || ""),
    });
    stored.push(storedRow);
  }
  return stored;
};

const mapMarketingStatusToClassificationLabel = (row = {}) => {
  const status = text(row.status || "").toLowerCase();
  if (status === "ignored") return "ignore";
  if (status === "failed" || status === "manual_follow_up") return "human_review";
  if (status === "simulated") return "lead_inbox";
  if (status === "processed") return "lead_inbox";
  return "human_review";
};

const mapMarketingLeadScoreToClassificationScore = (row = {}) => {
  const score = text(row.lead_score || "").toLowerCase();
  if (score === "high") return 0.95;
  if (score === "medium") return 0.8;
  if (score === "low") return 0.65;
  return 0.7;
};

const mapMarketingCommentEventToRecentRow = (row = {}) => ({
  id: `marketing:${row.id ?? row.comment_id ?? crypto.randomUUID()}`,
  tenant_id: row.business_id ?? row.tenant_id ?? null,
  platform: text(row.platform || "facebook") || "facebook",
  channel: text(row.platform || "").toLowerCase() === "instagram" ? "instagram_comment" : "facebook_comment",
  post_id: text(row.post_id || ""),
  post_permalink: text(row.raw_payload?.post_permalink || row.raw_payload?.post_url || row.raw_payload?.permalink || ""),
  comment_id: text(row.comment_id || ""),
  commenter_name: text(row.username || row.commenter_name || ""),
  commenter_profile_picture_url: text(row.raw_payload?.profile_picture_url || row.raw_payload?.commenter_profile_picture_url || ""),
  original_comment_text: text(row.message || row.original_comment_text || ""),
  classification_label: mapMarketingStatusToClassificationLabel(row),
  classification_score: mapMarketingLeadScoreToClassificationScore(row),
  action_taken: text(row.status || "ingested"),
  public_reply_status: row.automation_actions?.public_reply?.status || null,
  dm_status: row.automation_actions?.private_reply?.status || null,
  like_status: row.automation_actions?.liked?.status || null,
  inbox_conversation_id: text(row.inbox_conversation_id || row.raw_payload?.inbox_conversation_id || ""),
  error_code: text(row.error_message || row.error_code || ""),
  automation_state: row.automation_actions && typeof row.automation_actions === "object" ? row.automation_actions : {},
  raw_payload: row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : { raw_payload: row.raw_payload ?? null },
  processed_at: row.processed_at || row.updated_at || row.created_at || new Date().toISOString(),
  created_at: row.created_at || row.processed_at || row.updated_at || new Date().toISOString(),
  updated_at: row.updated_at || row.processed_at || row.created_at || new Date().toISOString(),
});

const mapSocialCommentAutomationAuditRowToRecentRow = (row = {}) => {
  const stepResults = Array.isArray(row.step_results) ? row.step_results : [];
  const productLink = text(row.product_link || row.metadata?.product_link || "");
  const checkoutLink = text(row.checkout_link || row.metadata?.checkout_link || "");
  const skippedReason = text(row.skipped_reason || row.error_message || "duplicate_comment_automation");
  const matchedConfigKey = text(row.matched_config_key || row.metadata?.matched_config_key || "");
  const resolvedPostId = text(row.resolved_post_id || row.metadata?.resolved_post_id || row.post_id || "");
  const resolvedPlatformPostId = text(row.resolved_platform_post_id || row.metadata?.resolved_platform_post_id || row.post_id || "");
  const resolvedProductId = row.resolved_product_id ?? row.metadata?.resolved_product_id ?? null;
  const duplicateReason = text(row.duplicate_reason || row.metadata?.duplicate_reason || skippedReason || "");
  return {
    id: `audit:${row.id ?? row.comment_id ?? crypto.randomUUID()}`,
    tenant_id: row.tenant_id ?? null,
    platform: text(row.platform || "facebook") || "facebook",
    channel: text(row.platform || "facebook") === "instagram" ? "instagram_comment" : "facebook_comment",
    post_id: text(row.post_id || ""),
    comment_id: text(row.comment_id || ""),
    config_id: row.config_id ?? null,
    customer_name: text(row.customer_name || row.commenter_name || ""),
    status: text(row.status || "duplicate_skipped") || "duplicate_skipped",
    step_results: stepResults.length ? stepResults : [{
      step: "automation",
      status: "skipped",
      reason: skippedReason,
    }],
    error_message: skippedReason,
    skipped_reason: skippedReason,
    matched_config_key: matchedConfigKey,
    resolved_post_id: resolvedPostId,
    resolved_platform_post_id: resolvedPlatformPostId,
    resolved_product_id: resolvedProductId,
    duplicate_reason: duplicateReason,
    config_found: Boolean(row.config_found),
    config_enabled: Boolean(row.config_enabled),
    product_link: productLink,
    checkout_link: checkoutLink,
    guidance_mode: text(row.guidance_mode || "website_checkout") || "website_checkout",
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
    automation_state: {
      runtime_monitor: {
        status: text(row.status || "duplicate_skipped") || "duplicate_skipped",
        skipped_reason: skippedReason,
        matched_config_key: matchedConfigKey,
        resolved_post_id: resolvedPostId,
        resolved_platform_post_id: resolvedPlatformPostId,
        resolved_product_id: resolvedProductId,
        duplicate_reason: duplicateReason,
        config_found: Boolean(row.config_found),
        config_enabled: Boolean(row.config_enabled),
        step_results: stepResults,
        product_link: productLink,
        checkout_link: checkoutLink,
        guidance_mode: text(row.guidance_mode || "website_checkout") || "website_checkout",
        raw_runtime_context: {
          step_results: stepResults,
          post_id: resolvedPostId,
          platform_post_id: resolvedPlatformPostId,
          matched_config_key: matchedConfigKey,
          resolved_product_id: resolvedProductId,
          config_found: Boolean(row.config_found),
          config_enabled: Boolean(row.config_enabled),
          duplicate_reason: duplicateReason,
        },
      },
    },
  };
};

export const listRecentSocialCommentAutomationRuns = async ({ tenantId = null, limit = 50 } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const [automationRunsResult, marketingEventsResult] = await Promise.all([
    db.query(
      `
      SELECT *
      FROM social_comment_automation_runs
      WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [tenantId, safeLimit]
    ),
    db.query(
      `
      SELECT *
      FROM marketing_comment_events
      WHERE business_id = $1::bigint
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [tenantId, safeLimit]
    ).catch((error) => {
      socialCommentsError("[social-comments] marketing events query failed", {
        tenant_id: tenantId,
        message: error?.message || "",
      });
      return { rows: [] };
    }),
  ]);

  const automationRows = automationRunsResult.rows || [];
  const auditRowsResult = await db.query(
    `
    SELECT *
    FROM social_comment_automation_run_audits
    WHERE tenant_id = $1::bigint
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  ).catch(() => ({ rows: [] }));
  const auditRows = (auditRowsResult.rows || []).map(mapSocialCommentAutomationAuditRowToRecentRow);
  const marketingRows = (marketingEventsResult.rows || []).map(mapMarketingCommentEventToRecentRow);
  const combinedRows = [...automationRows, ...auditRows, ...marketingRows];
  socialCommentsLog("[social-comments] recent pipeline counts", {
    tenant_id: tenantId,
    total_rows_before_filters: automationRows.length + auditRows.length + marketingRows.length,
    rows_after_tenant_filter: automationRows.length + auditRows.length + marketingRows.length,
    rows_after_status_channel_filters: combinedRows.length,
    social_runs_rows: automationRows.length,
    audit_rows: auditRows.length,
    marketing_rows: marketingRows.length,
  });

  const deduped = [];
  const seen = new Set();
  for (const row of combinedRows) {
    const dedupeKey = `${text(row.platform || "")}:${text(row.comment_id || "")}`;
    if (!row.comment_id || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(row);
  }

  deduped.sort((a, b) => {
    const timeDelta = new Date(b.created_at || b.processed_at || 0).getTime() - new Date(a.created_at || a.processed_at || 0).getTime();
    if (timeDelta !== 0) return timeDelta;
    return text(String(b.id || "")).localeCompare(text(String(a.id || "")));
  });

  return deduped.slice(0, safeLimit);
};

export const listSocialCommentAutomationRuns = async ({ tenantId = null, platform = "", postId = "", limit = 20 } = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const normalizedPlatform = text(platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safePostId) return [];
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const candidatePostIds = Array.from(
    new Set(
      [
        safePostId,
        safePostId.replace(/^facebook_post:/i, ""),
        safePostId.replace(/^instagram_post:/i, ""),
        safePostId.replace(/^social_comment:[^:]+:/i, ""),
      ]
        .map((value) => text(value))
        .filter(Boolean)
    )
  );
  const params = [safeTenantId, normalizedPlatform, ...candidatePostIds];
  const wherePostClause = candidatePostIds
    .map((_, index) => `post_id = $${index + 3}::text`)
    .join(" OR ");
  const [result, auditResult] = await Promise.all([
    db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND (${wherePostClause})
    ORDER BY created_at DESC, id DESC
    LIMIT $4
    `,
      [...params, safeLimit]
    ),
    db.query(
      `
      SELECT *
      FROM social_comment_automation_run_audits
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND (${wherePostClause})
      ORDER BY created_at DESC, id DESC
      LIMIT $4
      `,
      [...params, safeLimit]
    ).catch(() => ({ rows: [] })),
  ]);
  const automationRows = result.rows || [];
  const auditRows = (auditResult.rows || []).map(mapSocialCommentAutomationAuditRowToRecentRow);
  return [...automationRows, ...auditRows]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, safeLimit);
};

export const testSocialCommentAutomationRuntime = async ({ tenantId = null, platform = "", postId = "" } = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safePostId = text(postId || "");
  const normalizedPlatform = text(platform || "facebook").toLowerCase() === "instagram" ? "instagram" : "facebook";
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safePostId) {
    throw Object.assign(new Error("tenant_id, platform and postId are required"), { status: 400 });
  }
  const config = await getSocialCommentAutomationConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId });
  const post = config?.post || await loadSocialCommentPost({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId });
  const product = metadataObject(config?.product || post?.product || {});
  const websiteLinks = await resolveAutomationWebsiteLinks({
    tenantId: safeTenantId,
    row: post || {},
    productContext: product || {},
  }).catch(() => ({
    product_link: buildAutomationPublicUrl("/shop/products"),
    product_url: buildAutomationPublicUrl("/shop/products"),
    checkout_link: buildAutomationPublicUrl("/shop/checkout"),
    checkout_url: buildAutomationPublicUrl("/shop/checkout"),
    available_sizes: asArray(post?.productSizes || product?.sizes || product?.available_sizes || [])
      .map(text)
      .filter(Boolean),
    stock_status: text(product?.stock_status || post?.stock_status || ""),
  }));
  const templateContext = {
    customerName: "عميل تجريبي",
    customer_name: "عميل تجريبي",
    commenterName: "عميل تجريبي",
    commenter_name: "عميل تجريبي",
    productName: text(product.name || post?.productName || post?.caption || "Linked product"),
    product_name: text(product.name || post?.productName || post?.caption || "Linked product"),
    price: text(product.sale_price || product.price || post?.productSalePrice || post?.productPrice || "0"),
    size: text((post?.productSizes || "").split(",").map((value) => text(value)).filter(Boolean)[0] || "غير محدد"),
    color: text(post?.productColors || product.color || ""),
    productUrl: text(product.storefront_url || product.product_url || post?.productLink || ""),
    product_url: text(product.storefront_url || product.product_url || post?.productLink || ""),
    product_link: text(websiteLinks?.product_link || product.storefront_url || product.product_url || post?.productLink || ""),
    checkout_link: text(websiteLinks?.checkout_link || buildAutomationPublicUrl("/shop/checkout")),
    postPermalink: text(post?.permalinkUrl || post?.post_permalink_url || ""),
    post_permalink: text(post?.permalinkUrl || post?.post_permalink_url || ""),
    originalCommentText: "هذا تعليق تجريبي",
    original_comment_text: "هذا تعليق تجريبي",
    sizes: text(post?.productSizes || ""),
    available_sizes: text(post?.productSizes || product?.available_sizes || product?.sizes || ""),
    availableSizes: text(post?.productSizes || product?.available_sizes || product?.sizes || ""),
    variants: text(post?.productSizes || ""),
    stock_status: text(websiteLinks?.stock_status || product?.stock_status || post?.stock_status || "unknown"),
  };
  const duplicatePostIds = Array.from(new Set([
    safePostId,
    safePostId.replace(/^facebook_post:/i, ""),
    safePostId.replace(/^instagram_post:/i, ""),
    safePostId.replace(/^social_comment:[^:]+:/i, ""),
  ].map((value) => text(value)).filter(Boolean)));
  const duplicateRun = await db.query(
    `
    SELECT id
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, duplicatePostIds]
  ).catch(() => ({ rows: [] }));
  const duplicateAuditRun = await db.query(
    `
    SELECT id
    FROM social_comment_automation_run_audits
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, duplicatePostIds]
  ).catch(() => ({ rows: [] }));
  const duplicateExists = Boolean(duplicateRun.rows?.[0] || duplicateAuditRun.rows?.[0]);
  const publicTemplate = text(config?.message_templates?.publicReplyTemplate || "تم الرد على حضرتك في الخاص ✅");
  const privateTemplate = text(config?.message_templates?.privateReplyTemplate || "");
  const warnings = {
    publicReplyTemplate: detectMissingTemplatePlaceholders(publicTemplate, templateContext),
    privateReplyTemplate: detectMissingTemplatePlaceholders(privateTemplate, templateContext),
    aiOpeningPrompt: detectMissingTemplatePlaceholders(text(config?.message_templates?.aiOpeningPrompt || ""), templateContext),
  };
  return {
    success: true,
    dry_run: true,
    config: config || resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }),
    post: post || null,
    product: product || null,
    product_link: text(websiteLinks?.product_link || templateContext.product_link || ""),
    checkout_link: text(websiteLinks?.checkout_link || templateContext.checkout_link || ""),
    would_run: !duplicateExists,
    duplicate_reason: duplicateExists ? "duplicate_comment_automation" : "",
    enabled_steps: {
      likeComment: Boolean(config?.settings?.likeComment),
      publicReply: Boolean(config?.settings?.publicReply),
      privateReply: Boolean(config?.settings?.privateReply),
      aiFollowUp: Boolean(config?.settings?.aiFollowUp),
      createLead: Boolean(config?.settings?.createLead),
    },
    rendered_public_reply: renderAutomationTemplate(publicTemplate, templateContext).trim(),
    rendered_private_reply: renderAutomationTemplate(privateTemplate || "", templateContext).trim(),
    rendered_ai_opening_prompt: renderAutomationTemplate(text(config?.message_templates?.aiOpeningPrompt || ""), templateContext).trim(),
    guidance_mode: "website_checkout",
    placeholder_warnings: warnings,
    mock_context: templateContext,
  };
};
