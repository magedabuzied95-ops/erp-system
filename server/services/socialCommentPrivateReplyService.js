import { getPublicAppUrl } from "../utils/publicUrl.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const isAbsoluteHttpUrl = (value = "") => /^https?:\/\//i.test(text(value));
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

const normalizeSocialCommentProductContext = (productContext = {}) => {
  const primaryProduct = productContext?.primary_product || {};
  const availableSizes = sortSocialCommentAvailableSizes(
    productContext?.available_sizes ||
    productContext?.sizes ||
    primaryProduct?.available_sizes ||
    primaryProduct?.sizes ||
    []
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
    productName: text(productContext?.product_name || primaryProduct?.name || primaryProduct?.product_name || ""),
    availableSizes,
    availableSizesLabel: availableSizes.length
      ? availableSizes.join(", ")
      : "برجاء تأكيد المقاس المطلوب وهنراجع التوفر لحضرتك",
    productLink,
    price: text(
      productContext?.final_price ||
      productContext?.sale_price ||
      productContext?.selling_price ||
      productContext?.price ||
      primaryProduct?.final_price ||
      primaryProduct?.sale_price ||
      primaryProduct?.selling_price ||
      primaryProduct?.price ||
      ""
    ),
  };
};

export const buildPolishedSocialCommentProductReply = ({
  customerName = "",
  productContext = {},
} = {}) => {
  const normalizedContext = normalizeSocialCommentProductContext(productContext);
  return [
    text(customerName) ? `أهلًا بحضرتك يا ${text(customerName)}` : "أهلًا بحضرتك",
    "",
    "✅ المنتج اللي سألت عنه:",
    normalizedContext.productName || "المنتج",
    "",
    `المقاسات المتاحة: ${normalizedContext.availableSizesLabel}`,
    "",
    "لينك المنتج:",
    normalizedContext.productLink,
    "",
    "لو مقاس حضرتك موجود، ابعتلنا المقاس ونكمل الطلب فورًا ️",
  ].join("\n").trim();
};

export const buildSocialCommentPrivateReplyMessage = ({
  tenantId = null,
  platform = "",
  commentId = "",
  postId = "",
  customerName = "",
  productContext = null,
  automationTemplate = "",
  fallbackTemplate = "",
} = {}) => {
  const normalizedContext = normalizeSocialCommentProductContext(productContext || {});
  const templateContext = {
    customer_name: text(customerName),
    product_name: normalizedContext.productName,
    available_sizes: normalizedContext.availableSizesLabel,
    product_link: normalizedContext.productLink,
    price: normalizedContext.price,
  };
  const renderedAutomationTemplate = text(automationTemplate)
    ? text(renderTemplateText(automationTemplate, templateContext))
    : "";
  const renderedFallbackTemplate = text(fallbackTemplate)
    ? text(renderTemplateText(fallbackTemplate, templateContext))
    : "";

  let message = "";
  let selectedSource = "";

  if (renderedAutomationTemplate) {
    message = renderedAutomationTemplate;
    selectedSource = "automation_template";
  } else if (normalizedContext.hasProductContext) {
    message = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        ...productContext,
        product_name: normalizedContext.productName,
        available_sizes: normalizedContext.availableSizes,
        product_link: normalizedContext.productLink,
        price: normalizedContext.price,
        has_product_context: normalizedContext.hasProductContext,
      },
    });
    selectedSource = "polished_product_fallback";
  } else if (renderedFallbackTemplate) {
    message = renderedFallbackTemplate;
    selectedSource = "fallback_template";
  } else {
    message = GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY;
    selectedSource = "generic_fallback";
  }

  const finalMessage = absolutizeRelativeShopLinks(message).replace(/\bIN STOCK\b/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  console.log("SOCIAL_COMMENT_PRIVATE_REPLY_MESSAGE_BUILT", {
    tenant_id: Number(tenantId || 0) || null,
    platform: text(platform),
    comment_id: text(commentId),
    post_id: text(postId),
    has_product_context: normalizedContext.hasProductContext,
    selected_source: selectedSource,
    message_preview: finalMessage.slice(0, 280),
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
  const normalizedContext = normalizeSocialCommentProductContext(productContext || {});
  let finalMessage = absolutizeRelativeShopLinks(String(message || "")).replace(/\bIN STOCK\b/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  const badShape = normalizedContext.hasProductContext && (/IN STOCK/i.test(String(message || "")) || /(^|\n)\s*\/shop\/product/i.test(String(message || "")));
  if (badShape) {
    const rebuilt = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        ...productContext,
        product_name: normalizedContext.productName,
        available_sizes: normalizedContext.availableSizes,
        product_link: normalizedContext.productLink,
        price: normalizedContext.price,
        has_product_context: normalizedContext.hasProductContext,
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
