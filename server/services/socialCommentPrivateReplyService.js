import db from "../database/db.js";
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

export const ensureAbsoluteSocialProductLink = (value = "") => {
  const normalized = text(value);
  const publicUrl = text(getPublicAppUrl()).replace(/\/+$/g, "");
  if (!normalized) return publicUrl ? `${publicUrl}/shop/products` : "";
  if (isAbsoluteHttpUrl(normalized)) return normalized;
  if (!publicUrl) return normalized;
  return `${publicUrl}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
};

const absolutizeRelativeShopLinks = (value = "") =>
  String(value || "").replace(/(^|[\s(])((?:\/shop\/[^\s)\]]+))/g, (_match, prefix, relativePath) => {
    return `${prefix}${ensureAbsoluteSocialProductLink(relativePath)}`;
  });

const DEFAULT_EMPTY_SIZES_TEXT = "المقاسات المتاحة: يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.";

const normalizePriceText = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = toFiniteNumber(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  return Number.isInteger(parsed) ? String(parsed) : String(parsed.toFixed(2)).replace(/\.?0+$/g, "");
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

const normalizeSocialCommentProductContext = async ({ tenantId = null, productContext = {} } = {}) => {
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
  return {
    hasProductContext: Boolean(productContext?.found || productContext?.has_product_context),
    productId,
    productName: text(productContext?.product_name || primaryProduct?.name || primaryProduct?.product_name || ""),
    availableSizes,
    availableSizesLabel: availableSizes.length
      ? availableSizes.join(" - ")
      : "يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.",
    availableVariantsCount: availableVariantRows.length,
    availableVariantRows,
    productLink,
    priceUsed: normalizePriceText(
      productContext?.selling_price ||
      productContext?.sale_price ||
      productContext?.price ||
      productContext?.final_price ||
      primaryProduct?.selling_price ||
      primaryProduct?.sale_price ||
      primaryProduct?.price ||
      primaryProduct?.final_price ||
      ""
    ),
  };
};

const buildProductReplySections = ({ customerName = "", normalizedContext = {} } = {}) => {
  const sections = [
    text(customerName) ? `أهلًا بحضرتك ${text(customerName)}` : "أهلًا بحضرتك",
    "",
    "✅ المنتج:",
    normalizedContext.productName || "المنتج",
  ];
  if (normalizedContext.priceUsed) {
    sections.push(
      "",
      "السعر:",
      `${normalizedContext.priceUsed} جنيه`
    );
  }
  sections.push(
    "",
    "المقاسات المتاحة:",
    normalizedContext.availableSizesLabel || "يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.",
    "",
    "مشاهدة المنتج وطلبه:",
    normalizedContext.productLink,
    "",
    "إذا احتجت أي مساعدة في اختيار المقاس المناسب، ابعتلنا المقاس وسنساعدك بكل سرور"
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
        productName: text(productContext?.product_name || ""),
        priceUsed: normalizePriceText(productContext?.selling_price || productContext?.sale_price || productContext?.price || ""),
        availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || []).join(" - ") || "يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.",
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
  const hasPrice = Boolean(text(normalizedContext.priceUsed));
  const hasSizes = Array.isArray(normalizedContext.availableSizes) && normalizedContext.availableSizes.length > 0;
  const sizesInlineValue = hasSizes
    ? normalizedContext.availableSizes.join(" - ")
    : "يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.";

  for (const rawLine of rawLines) {
    const line = text(rawLine);
    if (!line) {
      cleanedLines.push("");
      continue;
    }
    if (!hasPrice && (line.includes("{{price}}") || line.includes("متاح بسعر") || line === "السعر:" || line.startsWith("السعر:"))) {
      continue;
    }

    let nextLine = absolutizeRelativeShopLinks(line).replace(/\bIN STOCK\b/gi, "");

    if (line.includes("{{available_sizes}}") || line.startsWith("المقاسات المتاحة:")) {
      nextLine = `المقاسات المتاحة: ${sizesInlineValue}`;
    } else if (!hasSizes && (line === "المقاسات المتاحة:" || line.includes("{{available_sizes}}"))) {
      nextLine = DEFAULT_EMPTY_SIZES_TEXT;
    }

    nextLine = nextLine
      .replace(/\{\{\s*available_sizes\s*\}\}/gi, sizesInlineValue)
      .replace(/\{\{\s*product_link\s*\}\}/gi, normalizedContext.productLink || "")
      .replace(/\{\{\s*price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/\{\{\s*formatted_price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/متاح\s+بسعر\s*\.\s*/gi, "")
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
    productName: text(productContext?.product_name || productContext?.primary_product?.name || ""),
    priceUsed: normalizePriceText(
      productContext?.selling_price ||
      productContext?.sale_price ||
      productContext?.price ||
      productContext?.final_price ||
      ""
    ),
    availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []).join(" - ") || "يرجى إرسال المقاس المطلوب وسنراجع التوفر فورًا.",
    productLink: ensureAbsoluteSocialProductLink(
      productContext?.product_link ||
      productContext?.product_url ||
      productContext?.storefront_url ||
      ""
    ),
  };
  let finalMessage = absolutizeRelativeShopLinks(String(message || ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const badShape = normalizedContext.hasProductContext && (
    /IN STOCK/i.test(String(message || "")) ||
    /(^|\n)\s*\/shop\/product/i.test(String(message || "")) ||
    /متاح\s+بسعر\s*\./i.test(String(message || ""))
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
  } else {
    finalMessage = sanitizeRenderedPrivateReplyMessage({
      message: finalMessage,
      normalizedContext: {
        ...normalizedContext,
        availableSizes: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []),
      },
    });
  }
  return {
    message: finalMessage || GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY,
    hasProductContext: normalizedContext.hasProductContext,
  };
};
