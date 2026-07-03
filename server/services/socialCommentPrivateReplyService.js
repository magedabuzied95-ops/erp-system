import db from "../database/db.js";
import { resolveCustomerDisplayPrice, resolveSocialProductDisplayPrice } from "../utils/customerDisplayPrice.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const isAbsoluteHttpUrl = (value = "") => /^https?:\/\//i.test(text(value));
const toFiniteNumber = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const renderTemplateText = (template = "", context = {}) =>
  String(template || "").replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return String(context[key] ?? context[key.toLowerCase()] ?? "").trim();
  });

export const GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY = "تم الرد على حضرتك في الخاص ✅";
export const SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX = "SOCIAL_SIZE_SELECT::";
export const SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX = "SOCIAL_COLOR_SELECT::";
export const SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX = "SOCIAL_ORDER_ACTION::";

export const sortSocialCommentAvailableSizes = (values = []) =>
  asArray(values)
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => {
      const leftNumber = Number.parseFloat(left);
      const rightNumber = Number.parseFloat(right);
      const leftIsNumber = Number.isFinite(leftNumber);
      const rightIsNumber = Number.isFinite(rightNumber);
      if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
      if (leftIsNumber) return -1;
      if (rightIsNumber) return 1;
      return left.localeCompare(right, "ar", { numeric: true, sensitivity: "base" });
    });

const publicAppBaseUrl = () => text(getPublicAppUrl()).replace(/\/+$/g, "");

export const ensureAbsoluteSocialAssetUrl = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  if (isAbsoluteHttpUrl(normalized)) return normalized;
  const publicUrl = publicAppBaseUrl();
  if (!publicUrl) return normalized;
  return `${publicUrl}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
};

export const ensureAbsoluteSocialProductLink = (value = "") => {
  const normalized = text(value);
  if (!normalized) {
    const publicUrl = publicAppBaseUrl();
    return publicUrl ? `${publicUrl}/shop/products` : "";
  }
  return ensureAbsoluteSocialAssetUrl(normalized);
};

const absolutizeRelativeShopLinks = (value = "") =>
  String(value || "").replace(/(^|[\s(])((?:\/shop\/[^\s)\]]+))/g, (_match, prefix, relativePath) => {
    return `${prefix}${ensureAbsoluteSocialProductLink(relativePath)}`;
  });

const DEFAULT_SIZE_FALLBACK = "ابعتلنا المقاس المطلوب وهنراجع التوفر لحضرتك فورًا.";
const DEFAULT_COLOR_LABEL = "غير محدد";

const normalizeSocialCommentColorPart = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const colorMap = {
    black: "أسود",
    white: "أبيض",
    grey: "رمادي",
    gray: "رمادي",
    red: "أحمر",
    blue: "أزرق",
    green: "أخضر",
    yellow: "أصفر",
    beige: "بيج",
    brown: "بني",
    pink: "وردي",
    purple: "بنفسجي",
    orange: "برتقالي",
    navy: "كحلي",
    camel: "جملي",
  };
  return colorMap[lower] || raw;
};

export const normalizeSocialCommentColorDisplay = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  const parts = raw
    .split(/\s*(?:&|\/|\+|and|و)\s*/i)
    .map((part) => normalizeSocialCommentColorPart(part))
    .filter(Boolean);
  if (parts.length > 1) return parts.join(" / ");
  return normalizeSocialCommentColorPart(raw) || raw;
};

const normalizePriceText = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = toFiniteNumber(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  if (parsed <= 0) return "";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed.toFixed(2)).replace(/\.?0+$/g, "");
};

const hasUsablePriceValue = (value = "") => {
  const normalized = normalizePriceText(value);
  if (!normalized) return false;
  const parsed = toFiniteNumber(normalized);
  if (parsed === null) return true;
  return parsed >= 0;
};

const priceCandidates = (...values) =>
  values
    .map((value) => normalizePriceText(value))
    .filter(Boolean);

const pickFirstPrice = (...values) => priceCandidates(...values)[0] || "";

const resolveSocialCommentDisplayPrice = async ({
  tenantId = null,
  base = {},
  primaryProduct = {},
  variants = [],
  callsite = "",
} = {}) => {
  const socialPriceInfo = await resolveSocialProductDisplayPrice({
    tenantId,
    product: primaryProduct,
    productContext: base,
    linkedProduct: primaryProduct?.product || primaryProduct?.linkedProduct || primaryProduct?.linked_product || {},
    variants,
    availableVariants: variants,
    context: {
      product_id: base.product_id || primaryProduct.product_id || primaryProduct.id || null,
      product_name: base.product_name || primaryProduct.name || primaryProduct.product_name || "",
    },
    callsite,
  });
  const resolved = resolveCustomerDisplayPrice({
    ...primaryProduct,
    ...base,
    product: primaryProduct,
  });
  const displayPrice = normalizePriceText(socialPriceInfo.selected_display_price || resolved.display_price);
  const oldPrice = normalizePriceText(resolved.old_price);
  return {
    priceUsed: displayPrice,
    salePriceUsed: resolved.sale_active ? displayPrice : "",
    regularPriceUsed: oldPrice || (!resolved.sale_active ? displayPrice : ""),
    hasValidPrice: socialPriceInfo.has_valid_price,
  };
};

const variantStockCount = (variant = {}) => {
  const candidates = [
    variant.stock,
    variant.current_stock,
    variant.available_stock,
    variant.stock_quantity,
    variant.quantity,
    variant.total_stock,
  ];
  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const variantSizeLabel = (variant = {}) =>
  text(variant.size || variant.size_label || variant.variant_size || variant.option1 || "");

const filterInStockVariants = (values = []) =>
  asArray(values).filter((variant) => variant && typeof variant === "object" && variantStockCount(variant) > 0);

const loadAvailableVariantRows = async ({ tenantId = null, productId = null } = {}) => {
  const safeProductId = Number(productId || 0);
  if (!Number.isFinite(safeProductId) || safeProductId <= 0) return [];
  const safeTenantId = Number(tenantId || 0);
  const result = await db.query(
    `
    SELECT
      id,
      size,
      color,
      COALESCE(stock, 0) AS stock
    FROM product_variants
    WHERE product_id = $1
      AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL)
      AND COALESCE(stock, 0) > 0
    ORDER BY
      CASE
        WHEN NULLIF(REGEXP_REPLACE(COALESCE(size, ''), '[^0-9.]', '', 'g'), '') IS NULL THEN 1
        ELSE 0
      END,
      NULLIF(REGEXP_REPLACE(COALESCE(size, ''), '[^0-9.]', '', 'g'), '')::numeric NULLS LAST,
      COALESCE(size, '') ASC,
      id ASC
    `,
    [safeProductId, safeTenantId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
};

export const normalizeSocialCommentProductContext = async ({ tenantId = null, productContext = {} } = {}) => {
  const primaryProduct = productContext?.primary_product || {};
  const productId = Number(productContext?.product_id || primaryProduct?.product_id || primaryProduct?.id || 0) || null;
  const stockedContextVariants = filterInStockVariants(
    productContext?.available_variants ||
    productContext?.variants ||
    primaryProduct?.available_variants ||
    primaryProduct?.variants ||
    []
  );
  let availableVariantRows = stockedContextVariants.map((variant) => ({
    size: variantSizeLabel(variant),
    stock: variantStockCount(variant),
    color: text(variant.color || ""),
  }));
  if (!availableVariantRows.length && productId) {
    availableVariantRows = await loadAvailableVariantRows({ tenantId, productId }).catch(() => []);
  }
  const availableSizes = sortSocialCommentAvailableSizes(
    availableVariantRows.length
      ? availableVariantRows.map((variant) => variantSizeLabel(variant))
      : (
          productContext?.available_sizes ||
          productContext?.sizes ||
          primaryProduct?.available_sizes ||
          primaryProduct?.sizes ||
          []
        )
  );
  const productLink = ensureAbsoluteSocialProductLink(
    productContext?.product_link ||
    productContext?.product_url ||
    productContext?.storefront_url ||
    primaryProduct?.product_link ||
    primaryProduct?.product_url ||
    primaryProduct?.storefront_url ||
    ""
  );
  const productImageUrl = ensureAbsoluteSocialAssetUrl(
    productContext?.product_image_url ||
    productContext?.image_url ||
    productContext?.image ||
    primaryProduct?.product_image_url ||
    primaryProduct?.image_url ||
    primaryProduct?.image ||
    primaryProduct?.main_image ||
    ""
  );
  const productName = text(productContext?.product_name || primaryProduct?.name || primaryProduct?.product_name || "") || "المنتج";
  const priceResolution = await resolveSocialCommentDisplayPrice({
    tenantId,
    base: {
      sale_active: productContext?.sale_active ?? productContext?.is_sale_active ?? productContext?.on_sale ?? productContext?.sale_enabled ?? productContext?.discount_enabled ?? productContext?.has_sale,
      sale_price: productContext?.sale_price,
      selling_price: productContext?.selling_price,
      price: productContext?.price,
      regular_price: productContext?.final_price,
    },
    primaryProduct: {
      ...primaryProduct,
      sale_active: primaryProduct?.sale_active ?? primaryProduct?.is_sale_active ?? primaryProduct?.on_sale ?? primaryProduct?.sale_enabled ?? primaryProduct?.discount_enabled ?? primaryProduct?.has_sale,
    },
    variants: availableVariantRows,
    callsite: "socialCommentPrivateReplyService.normalizeSocialCommentProductContext",
  });
  return {
    hasProductContext: Boolean(productContext?.found || productContext?.has_product_context),
    productId,
    productName,
    availableSizes,
    availableSizesLabel: availableSizes.length ? availableSizes.join(" | ") : DEFAULT_SIZE_FALLBACK,
    availableVariantsCount: availableVariantRows.length,
    availableVariantRows,
    productLink,
    productImageUrl,
    priceUsed: priceResolution.priceUsed,
    salePriceUsed: priceResolution.salePriceUsed,
    regularPriceUsed: priceResolution.regularPriceUsed,
  };
};

const buildProductReplySections = ({ customerName = "", normalizedContext = {} } = {}) => {
  const sections = [
    text(customerName) ? `أهلاً بحضرتك يا ${text(customerName)} ✨` : "أهلاً بحضرتك ✨",
    "",
    normalizedContext.productName || "المنتج",
  ];
  if (hasUsablePriceValue(normalizedContext.priceUsed)) {
    sections.push(
      "",
      "السعر:",
      `${normalizePriceText(normalizedContext.priceUsed)} جنيه`
    );
  }
  sections.push(
    "",
    "المقاسات المتاحة:",
    normalizedContext.availableSizesLabel || DEFAULT_SIZE_FALLBACK,
    "",
    "━━━━━━━━━━━━",
    "",
    "اختر مقاسك من الأزرار بالأسفل.",
    "",
    "شحن لجميع المحافظات",
    "الدفع عند الاستلام متاح",
    "",
    "️ عرض المنتج:",
    "",
    normalizedContext.productLink,
    "",
    "━━━━━━━━━━━━",
    "",
    "لو محتاج أي مساعدة في اختيار المقاس أو عندك أي استفسار، إحنا معاك في أي وقت ❤️"
  );
  return sections;
};

export const buildPolishedSocialCommentProductReply = ({
  customerName = "",
  productContext = {},
} = {}) => {
  const normalizedContext = productContext && typeof productContext === "object" && productContext.__normalized_private_reply_context
    ? productContext
    : {
        productName: text(productContext?.product_name || "") || "المنتج",
        priceUsed: normalizePriceText(productContext?.selling_price || productContext?.sale_price || productContext?.price || ""),
        availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || []).join(" | ") || DEFAULT_SIZE_FALLBACK,
        productLink: ensureAbsoluteSocialProductLink(productContext?.product_link || productContext?.product_url || productContext?.storefront_url || ""),
      };
  return buildProductReplySections({ customerName, normalizedContext }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const sanitizeRenderedPrivateReplyMessage = ({
  message = "",
  normalizedContext = {},
} = {}) => {
  const rawLines = String(message || "").replace(/\r\n/g, "\n").split("\n");
  const cleanedLines = [];
  const hasPrice = hasUsablePriceValue(normalizedContext.priceUsed);
  const hasSizes = Array.isArray(normalizedContext.availableSizes) && normalizedContext.availableSizes.length > 0;
  const sizesInlineValue = hasSizes ? normalizedContext.availableSizes.join(" | ") : DEFAULT_SIZE_FALLBACK;

  for (const rawLine of rawLines) {
    const line = text(rawLine);
    if (!line) {
      cleanedLines.push("");
      continue;
    }
    if (!hasPrice && (
      line.includes("{{price}}") ||
      line.includes("{{formatted_price}}") ||
      line.includes("متاح بسعر") ||
      line === "السعر:" ||
      line.startsWith("السعر:")
    )) {
      continue;
    }

    let nextLine = absolutizeRelativeShopLinks(line).replace(/\bIN STOCK\b/gi, "");

    if (line === "المقاسات المتاحة:") {
      nextLine = line;
    } else if (line.includes("{{available_sizes}}") || line.startsWith("المقاسات المتاحة:")) {
      nextLine = `المقاسات المتاحة: ${sizesInlineValue}`;
    }

    nextLine = nextLine
      .replace(/\{\{\s*available_sizes\s*\}\}/gi, sizesInlineValue)
      .replace(/\{\{\s*product_link\s*\}\}/gi, normalizedContext.productLink || "")
      .replace(/\{\{\s*price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/\{\{\s*formatted_price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/متاح\s+بسعر\s*\.\s*/gi, "")
      .replace(/متاح\s+بسعر/gi, "")
      .trimEnd();

    if (!nextLine) continue;
    cleanedLines.push(nextLine);
  }

  const compacted = [];
  for (const line of cleanedLines) {
    if (!line && !compacted.length) continue;
    if (!line && !compacted[compacted.length - 1]) continue;
    compacted.push(line);
  }

  return compacted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentSizeQuickReplies = ({
  productContext = null,
  postId = "",
  commentId = "",
  conversationId = "",
} = {}) => {
  const safeProductId = Number(productContext?.product_id || productContext?.primary_product?.product_id || productContext?.primary_product?.id || 0) || null;
  const sizes = sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []).slice(0, 11);
  if (!safeProductId || !sizes.length) return [];
  return sizes.map((size) => ({
    content_type: "text",
    title: size.slice(0, 20),
    payload: `${SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX}${JSON.stringify({
      size,
      product_id: safeProductId,
      post_id: text(postId),
      comment_id: text(commentId),
      conversation_id: text(conversationId),
    })}`,
  }));
};

export const buildSocialCommentColorQuickReplies = ({
  productId = null,
  selectedSize = "",
  colors = [],
  postId = "",
  commentId = "",
  conversationId = "",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  const safeSelectedSize = text(selectedSize);
  const normalizedColors = asArray(colors)
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 11);
  if (!safeProductId || !safeSelectedSize || !normalizedColors.length) return [];
  return normalizedColors.map((color) => ({
    content_type: "text",
    title: color.slice(0, 20),
    payload: `${SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX}${JSON.stringify({
      color,
      size: safeSelectedSize,
      product_id: safeProductId,
      post_id: text(postId),
      comment_id: text(commentId),
      conversation_id: text(conversationId),
    })}`,
  }));
};

export const buildSocialCommentOrderActionQuickReplies = ({
  productId = null,
  selectedSize = "",
  selectedColor = "",
  postId = "",
  commentId = "",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  if (!safeProductId) return [];
  const payloadBase = {
    product_id: safeProductId,
    size: text(selectedSize),
    color: text(selectedColor),
    post_id: text(postId),
    comment_id: text(commentId),
  };
  return [
    { action: "confirm", title: "✅ تأكيد الطلب" },
    { action: "cancel", title: "❌ إلغاء الطلب" },
  ].map((item) => ({
    content_type: "text",
    title: item.title.slice(0, 20),
    payload: `${SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX}${JSON.stringify({
      ...payloadBase,
      action: item.action,
    })}`,
  }));
};

export const parseSocialCommentSizeQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX.length));
    const size = text(parsed?.size || "");
    const productId = Number(parsed?.product_id || 0) || null;
    if (!size || !productId) return null;
    return {
      size,
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "size",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const parseSocialCommentColorQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX.length));
    const color = text(parsed?.color || "");
    const size = text(parsed?.size || "");
    const productId = Number(parsed?.product_id || 0) || null;
    if (!color || !size || !productId) return null;
    return {
      color,
      size,
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "color",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const parseSocialCommentOrderActionQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX.length));
    const action = text(parsed?.action || "");
    const productId = Number(parsed?.product_id || 0) || null;
    if (!action || !productId) return null;
    return {
      action,
      size: text(parsed?.size || ""),
      color: text(parsed?.color || ""),
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "action",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const buildSocialCommentOrderSummaryMessage = ({
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "️ ملخص اختيارك",
    "",
    text(productName) || "المنتج",
    `المقاس: ${text(selectedSize) || "-"}`,
    `اللون: ${normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL}`,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push(`السعر: ${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "هل تحب نكمل الطلب؟");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentSalesFlowQuickReplies = ({
  productId = null,
  selectedSize = "",
  selectedColor = "",
  postId = "",
  commentId = "",
  conversationId = "",
  stage = "summary",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  if (!safeProductId) return [];
  const payloadBase = {
    product_id: safeProductId,
    size: text(selectedSize),
    color: text(selectedColor),
    post_id: text(postId),
    comment_id: text(commentId),
    conversation_id: text(conversationId),
  };
  const items = stage === "preview"
    ? [
        { action: "send_order", title: "✅ إرسال الطلب" },
        { action: "edit_data", title: "✏️ تعديل البيانات" },
        { action: "cancel", title: "❌ إلغاء" },
      ]
    : [
        { action: "confirm", title: "✅ تأكيد الطلب" },
        { action: "cancel", title: "❌ إلغاء الطلب" },
      ];
  if (stage === "summary") {
    return [
      { title: "✅ تأكيد الطلب", payload: "ORDER_CONFIRM" },
      { title: "❌ إلغاء الطلب", payload: "ORDER_CANCEL" },
    ].map((item) => ({
      content_type: "text",
      title: item.title.slice(0, 20),
      payload: item.payload,
    }));
  }
  return items.map((item) => ({
    content_type: "text",
    title: item.title.slice(0, 20),
    payload: `${SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX}${JSON.stringify({
      ...payloadBase,
      action: item.action,
    })}`,
  }));
};

export const buildSocialCommentOrderSummaryMessageV2 = ({
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "️ ملخص طلبك",
    "",
    text(productName) || "المنتج",
    "",
    "المقاس:",
    text(selectedSize) || "-",
    "",
    "اللون:",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push("", "السعر:", `${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "━━━━━━━━━━━━", "", "هل ترغب في إتمام الطلب؟");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentOrderPreviewMessage = ({
  customerName = "",
  customerPhone = "",
  governorate = "",
  customerAddress = "",
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "━━━━━━━━━━━━",
    "",
    "️ مراجعة الطلب",
    "",
    "الاسم",
    text(customerName) || "-",
    "",
    "الهاتف",
    text(customerPhone) || "-",
    "",
    "المحافظة",
    text(governorate) || "-",
    "",
    "العنوان",
    text(customerAddress) || "-",
    "",
    "المنتج",
    text(productName) || "المنتج",
    "",
    "المقاس",
    text(selectedSize) || "-",
    "",
    "اللون",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push("", "السعر", `${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "━━━━━━━━━━━━");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentOrderReviewMessage = ({
  customerName = "",
  customerPhone = "",
  governorate = "",
  customerAddress = "",
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "━━━━━━━━━━━━",
    "",
    "️ مراجعة الطلب",
    "",
    "الاسم",
    text(customerName) || "-",
    "",
    "الهاتف",
    text(customerPhone) || "-",
    "",
    "المحافظة",
    text(governorate) || "-",
    "",
    "العنوان",
    text(customerAddress) || "-",
    "",
    "المنتج",
    text(productName) || "المنتج",
    "",
    "المقاس",
    text(selectedSize) || "-",
    "",
    "اللون",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
    "",
    "السعر",
    hasUsablePriceValue(priceUsed) ? `${normalizePriceText(priceUsed)} جنيه` : "-",
    "",
    "━━━━━━━━━━━━",
  ];
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentPrivateReplyMessage = async ({
  tenantId = null,
  platform = "",
  commentId = "",
  postId = "",
  customerName = "",
  productContext = null,
  automationTemplate = "",
  fallbackTemplate = "",
} = {}) => {
  const normalizedContext = await normalizeSocialCommentProductContext({
    tenantId,
    productContext: productContext || {},
  });
  const templateContext = {
    customer_name: text(customerName),
    product_name: normalizedContext.productName,
    available_sizes: normalizedContext.availableSizesLabel,
    product_link: normalizedContext.productLink,
    price: normalizedContext.priceUsed,
    formatted_price: normalizedContext.priceUsed,
  };
  const renderedAutomationTemplate = text(automationTemplate)
    ? text(renderTemplateText(automationTemplate, templateContext))
    : "";
  const renderedFallbackTemplate = text(fallbackTemplate)
    ? text(renderTemplateText(fallbackTemplate, templateContext))
    : "";

  let message = "";
  let selectedSource = "";

  if (normalizedContext.hasProductContext) {
    message = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        __normalized_private_reply_context: true,
        productName: normalizedContext.productName,
        priceUsed: normalizedContext.priceUsed,
        availableSizesLabel: normalizedContext.availableSizesLabel,
        productLink: normalizedContext.productLink,
      },
    });
    selectedSource = "polished_product_renderer";
  } else if (renderedAutomationTemplate) {
    message = renderedAutomationTemplate;
    selectedSource = "generic_automation_template";
  } else if (renderedFallbackTemplate) {
    message = renderedFallbackTemplate;
    selectedSource = "generic_automation_template";
  } else {
    message = GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY;
    selectedSource = "generic_automation_template";
  }

  const beforeSanitizePreview = String(message || "").trim().slice(0, 280);
  const finalMessage = sanitizeRenderedPrivateReplyMessage({
    message,
    normalizedContext,
  });

  if (normalizedContext.hasProductContext) {
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_RENDER_DATA", {
      product_id: normalizedContext.productId,
      product_name: normalizedContext.productName,
      price_used: normalizedContext.priceUsed,
      available_sizes: normalizedContext.availableSizes,
      available_variants_count: normalizedContext.availableVariantsCount,
      absolute_product_link: normalizedContext.productLink,
    });
  }
  console.log("SOCIAL_COMMENT_PRIVATE_REPLY_MESSAGE_BUILT", {
    tenant_id: Number(tenantId || 0) || null,
    platform: text(platform),
    comment_id: text(commentId),
    post_id: text(postId),
    has_product_context: normalizedContext.hasProductContext,
    selected_source: selectedSource,
    before_sanitize_preview: beforeSanitizePreview,
    after_sanitize_preview: finalMessage.slice(0, 280),
    price_used: normalizedContext.priceUsed,
    available_sizes: normalizedContext.availableSizes,
  });
  return {
    message: finalMessage,
    selectedSource,
    hasProductContext: normalizedContext.hasProductContext,
    normalizedProductContext: normalizedContext,
    templateContext,
    messengerQuickReplies: buildSocialCommentSizeQuickReplies({
      productContext: {
        product_id: normalizedContext.productId,
        available_sizes: normalizedContext.availableSizes,
      },
      postId,
      commentId,
    }),
  };
};

export const sanitizeUnifiedSocialCommentPrivateReplyMessage = ({
  tenantId = null,
  platform = "",
  commentId = "",
  postId = "",
  customerName = "",
  message = "",
  productContext = null,
} = {}) => {
  const normalizedContext = {
    hasProductContext: Boolean(productContext?.found || productContext?.has_product_context),
    productName: text(productContext?.product_name || productContext?.primary_product?.name || "") || "المنتج",
    priceUsed: normalizePriceText(
      productContext?.selling_price ||
      productContext?.sale_price ||
      productContext?.price ||
      productContext?.final_price ||
      ""
    ),
    availableSizes: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []),
    availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []).join(" | ") || DEFAULT_SIZE_FALLBACK,
    productLink: ensureAbsoluteSocialProductLink(
      productContext?.product_link ||
      productContext?.product_url ||
      productContext?.storefront_url ||
      ""
    ),
  };
  let finalMessage = sanitizeRenderedPrivateReplyMessage({
    message: absolutizeRelativeShopLinks(String(message || "")),
    normalizedContext,
  });
  const badShape = normalizedContext.hasProductContext && (
    /IN STOCK/i.test(String(message || "")) ||
    /(^|\n)\s*\/shop\/product/i.test(String(message || "")) ||
    /متاح\s+بسعر/i.test(String(message || ""))
  );
  if (badShape) {
    const rebuilt = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        __normalized_private_reply_context: true,
        productName: normalizedContext.productName,
        priceUsed: normalizedContext.priceUsed,
        availableSizesLabel: normalizedContext.availableSizesLabel,
        productLink: normalizedContext.productLink,
      },
    });
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_BAD_MESSAGE_SHAPE", {
      tenant_id: Number(tenantId || 0) || null,
      platform: text(platform),
      comment_id: text(commentId),
      post_id: text(postId),
      message_preview_before: String(message || "").trim().slice(0, 280),
      message_preview_after: rebuilt.slice(0, 280),
    });
    finalMessage = rebuilt;
  }
  return {
    message: finalMessage || GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY,
    hasProductContext: normalizedContext.hasProductContext,
  };
};
