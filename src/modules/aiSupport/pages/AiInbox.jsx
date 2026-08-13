import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowUpDown,
  ExternalLink,
  FileText,
  Bot,
  BadgePercent,
  CheckCheck,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Brain,
  CheckCircle2,
  Clock3,
  CreditCard,
  Flame,
  Handshake,
  EyeOff,
  Info as InfoIcon,
  Loader2,
  LockKeyhole,
  MapPin,
  Image as ImageIcon,
  Maximize2,
  MessageSquareText,
  Minimize2,
  MoreVertical,
  PackageCheck,
  PauseCircle,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  PlayCircle,
  Star,
  RefreshCw,
  Radio,
  Ruler,
  Search,
  Send,
  Smile,
  ShieldBan,
  ShoppingBag,
  ShoppingCart,
  Snowflake,
  Sparkles,
  Tag,
  Timer,
  Truck,
  User,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  FaFacebookF,
  FaFacebookMessenger,
  FaInstagram,
  FaWhatsapp,
} from "react-icons/fa";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { subscribeRealtime, useRealtimeStatus } from "../../../shared/realtime/socketStore";
import AIStatusBadge from "../../../components/ai/AIStatusBadge";
import AILiveLogs from "../../../components/ai/AILiveLogs";
import TranscriptMessage, { PinnedMessagesBar } from "../components/TranscriptMessage";
import ProductCardPicker from "../components/ProductCardPicker";
import {
  MAX_BATCH_PRODUCTS, productSelectionKey, toggleProductSelection,
  summarizeSendResults, selectedCountText, assistedSendButtonText,
  maxBatchReachedText, sendOutcomeText,
} from "../lib/productSelection.js";
import SocialCommentsWorkspace from "../components/SocialCommentsWorkspace.jsx";
import Customer360Drawer from "../components/Customer360Drawer.jsx";
import { getSocialCommentRealTimestamp } from "../components/socialCommentTimeline.jsx";
import { useTenant } from "../../saas/context/TenantContext";
import { formatCurrency } from "../../../shared/lib/currency";
import { publicProductUrl, publicStorefrontUrl } from "../../../shared/lib/publicStorefront";
import { AI_INBOX_DEFAULT_LABELS, aiInboxLabelsFromConversation, customAiInboxLabel, normalizeAiInboxConversationLabels } from "../../../../shared/aiInboxConversationLabels.js";
import { toast } from "react-hot-toast";
import { prefetchSocialWorkspace, readSocialWorkspaceCache, socialWorkspaceCacheKey, primeSocialWorkspaceCache } from "../services/socialWorkspaceProgressiveLoad.js";
import inboxCache from "../services/inboxCache/inboxCache";
import { channelWindow, channelsForFilter, mergeConversationPages } from "../services/inboxChannels";
import "./AiInboxDesktop.css";

const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => formatCurrency(value);
const clean = (value = "") => String(value || "").trim();
const GENERIC_CUSTOMER_NAMES = new Set([
  "customer",
  "customers",
  "client",
  "guest",
  "unknown",
  "anonymous",
  "user",
  "lead",
  "عميل",
  "العميل",
  "زائر",
  "مستخدم",
  "غير معروف",
  ".",
  "-",
  "n/a",
  "null",
  "undefined",
]);
const isGenericCustomerName = (value = "") => {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  return !normalized || GENERIC_CUSTOMER_NAMES.has(normalized);
};
// A brand-new Messenger conversation can land with customer_name set to the customer's
// first message (e.g. "ممكن صور جوردن فور") before the Facebook profile is fetched. Detect
// that so we can trigger a profile sync and replace it with the real name + avatar. Mirrors
// the backend messenger-name-repair heuristic. False positives only cost one extra profile
// fetch (gated per conversation), so this can be a little aggressive.
const MESSAGE_LIKE_NAME_KEYWORDS = /(السلام عليكم|سلام عليكم|عليكم السلام|ممكن|عايز|عايزة|عايزه|عاوز|عاوزه|محتاج|محتاجة|محتاجه|محتاجين|بكام|بكاام|وريني|ورينى|ابعت|ابعتلي|ابعتلى|هاتلي|هاتلى|فين|متاح|السعر|سعر|المقاس|مقاس|اللون|لون|صوره|صور|عندكم|عندكو|available|price|size|color)/i;
const looksLikeMessageName = (value = "") => {
  const normalized = clean(value);
  if (!normalized) return false;
  if (normalized.length > 40) return true;
  if (/[?!؟…]/.test(normalized)) return true;
  return MESSAGE_LIKE_NAME_KEYWORDS.test(normalized);
};
const firstUsefulCustomerName = (...values) =>
  values.map((value) => clean(value)).find((value) => value && !isGenericCustomerName(value)) || "";
const customerIdentifier = (...values) => {
  const value = values.map((item) => clean(item)).find(Boolean) || "";
  return value.replace(/^whatsapp:/i, "").replace(/@(?:s\.whatsapp\.net|c\.us|lid)$/i, "").trim();
};
const customer360Identifier = (customer = {}) => {
  const profile = customer?.customer_profile || customer?.profile || {};
  const metadata = customer?.channel_metadata || {};
  const channel = clean(customer?.channel || customer?.source || customer?.platform).toLowerCase();
  const channelCustomerId = customerIdentifier(customer?.customer_id);
  const phoneLikeChannelCustomerId = /^\+?\d{10,15}$/.test(channelCustomerId) ? channelCustomerId : "";
  return customerIdentifier(
    customer?.erp_customer_id,
    profile?.erp_customer_id,
    customer?.phone,
    customer?.customer_phone,
    profile?.phone,
    metadata?.resolved_phone,
    metadata?.phone,
    channel.includes("whatsapp") ? customer?.external_customer_id : "",
    phoneLikeChannelCustomerId
  );
};
const storefrontProductUrl = (product = {}) => {
  const rawUrl = clean(product.product_url || product.storefront_url || product.url || "");
  if (rawUrl) return publicStorefrontUrl(rawUrl);
  const productId = clean(product.product_id || product.id || product.slug || "");
  return productId ? publicProductUrl(productId) : "#";
};
const parseOptionalCount = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};
const formatDisplayPrice = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const text = clean(value);
    if (!text) continue;
    const numeric = Number(text.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(numeric) && numeric <= 0) continue;
    return text;
  }
  return "";
};
const isSocialDebugEnabled = () => import.meta.env.DEV && window.localStorage.getItem("social_debug") === "1";
const socialDebugLog = (...args) => {
  if (!isSocialDebugEnabled()) return;

  console.log(...args);
};
const ENABLE_SOCIAL_FAST_CENTER = true;
const normalizeValidationSummary = (value = {}) => {
  const validation = value && typeof value === "object" ? value : {};
  const violations = asArray(validation.violations || validation.issues || []);
  const warnings = asArray(validation.warnings || []);
  const violationsCount = Number(validation.violations_count ?? validation.violationsCount ?? violations.length ?? 0) || 0;
  const warningsCount = Number(validation.warnings_count ?? validation.warningsCount ?? warnings.length ?? 0) || 0;
  const confidence = Number(validation.confidence ?? validation.confidence_pct ?? 0);
  const confidencePercent = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence <= 1 ? confidence * 100 : confidence)) : 0;
  const hasErrors = violations.some((item) => clean(item?.severity || "").toLowerCase() === "error");
  const status =
    clean(validation.status || validation.state || "") ||
    (violationsCount > 0 ? (hasErrors ? "خطر / تحقق قبل الإرسال" : "يحتاج مراجعة") : warningsCount > 0 ? "يحتاج مراجعة" : "آمن");
  const details = [
    ...violations.slice(0, 3).map((item) => clean(item?.message || item?.type || item)),
    ...warnings.slice(0, 3).map((item) => clean(item?.message || item?.type || item)),
  ].filter(Boolean).slice(0, 3);
  return {
    confidencePercent,
    violationsCount,
    warningsCount,
    status,
    details,
    violations,
    warnings,
  };
};
const normalizeConfidenceEngineSummary = (value = {}) => {
  const engine = value && typeof value === "object" ? value : {};
  const score = Number(engine.score ?? engine.confidence_score ?? 0);
  const confidenceScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const level = clean(engine.level || engine.confidence_level || "").toLowerCase() || (confidenceScore >= 80 ? "high" : confidenceScore >= 60 ? "medium" : confidenceScore >= 35 ? "low" : "critical");
  const decision = clean(engine.decision || "").toLowerCase() || (confidenceScore >= 70 ? "safe" : confidenceScore >= 35 ? "review" : "high_risk");
  const reasons = asArray(engine.reasons || []).map((item) => clean(item)).filter(Boolean);
  const riskFlags = engine.risk_flags && typeof engine.risk_flags === "object" ? engine.risk_flags : {};
  const reasonsPreview = reasons.slice(0, 3);
  const label = level === "high" ? "High" : level === "medium" ? "Medium" : level === "low" ? "Low" : "Critical";
  const decisionLabel = decision === "safe" ? "Safe" : decision === "review" ? "Review" : "High Risk";
  const tone = decision === "high_risk" ? "rose" : decision === "review" ? "amber" : "emerald";
  return {
    score: confidenceScore,
    level,
    levelLabel: label,
    decision,
    decisionLabel,
    tone,
    reasons,
    reasonsPreview,
    reasonsCount: reasons.length,
    riskFlags,
    riskFlagsCount: Object.values(riskFlags).filter(Boolean).length,
  };
};
const normalizeProductCardsValue = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") return [value];
  return [];
};
const encodeConversationId = (value = "") => {
  const raw = clean(value);
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};
const buildClientRequestId = () => {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};
const buildMessageIdentityKey = ({ tenantId = "", sessionId = "", direction = "outbound", clientRequestId = "", providerMessageId = "", externalMessageId = "" } = {}) => {
  const canonicalSessionId = encodeConversationId(sessionId);
  const stableKey = clean(clientRequestId || providerMessageId || externalMessageId);
  return stableKey && canonicalSessionId ? `msg:${clean(tenantId)}|${canonicalSessionId}|${clean(direction || "outbound")}|${stableKey}` : "";
};
const aiInboxConversationEndpoint = (sessionId = "", suffix = "") =>
  `/ai-inbox/conversations/${encodeConversationId(sessionId)}${suffix}`;
const aiAgentInboxEndpoint = (sessionId = "", suffix = "") =>
  `/ai-agent/inbox/${encodeConversationId(sessionId)}${suffix}`;
const aiReplyCorrectionEndpoint = (sessionId = "", messageId = "") =>
  aiAgentInboxEndpoint(sessionId, `/messages/${encodeConversationId(messageId)}/correction`);
const replyCorrectionTypes = [
  { value: "wrong_price", label: "wrong_price" },
  { value: "wrong_stock", label: "wrong_stock" },
  { value: "wrong_policy", label: "wrong_policy" },
  { value: "bad_tone", label: "bad_tone" },
  { value: "incomplete_answer", label: "incomplete_answer" },
  { value: "other", label: "other" },
];
const buildReplyCorrectionDraft = ({ conversation = {}, message = {} } = {}) => {
  const messages = asArray(conversation.messages);
  const index = messages.findIndex((item) => String(item.id || item.external_message_id || item.external_reply_id || "") === String(message.id || message.external_message_id || message.external_reply_id || ""));
  const previousCustomerMessage = index >= 0
    ? [...messages.slice(0, index)].reverse().find((item) => clean(item.customer_message || item.message_text || item.last_message || ""))
    : null;
  const customerQuestion = clean(
    previousCustomerMessage?.customer_message ||
      previousCustomerMessage?.message_text ||
      previousCustomerMessage?.last_message ||
      message.customer_message ||
      message.message_text ||
      ""
  );
  const aiWrongAnswer = clean(message.ai_answer || message.staff_message || "");
  const productId = clean(message.clicked_product_id || normalizeProductCardsValue(message.suggested_products)[0]?.id || message.product_id || message.current_product_id || "");
  return {
    conversationId: clean(conversation.session_id || conversation.conversation_id || ""),
    messageId: clean(message.id || message.external_message_id || message.external_reply_id || ""),
    channel: clean(conversation.channel || conversation.source || message.channel || ""),
    productId,
    customerQuestion,
    aiWrongAnswer,
    employeeCorrectAnswer: "",
    correctionType: "other",
  };
};
const productCardPreviewText = (cards = []) => {
  const first = asArray(cards)[0] || {};
  const name = clean(first.product_name || first.name || first.title || "");
  const color = clean(first.color || "");
  const size = clean(first.size || "");
  const price = Number(first.price ?? first.final_price ?? 0);
  return [name, color, size, price > 0 ? money(price) : ""].filter(Boolean).join(" • ");
};

const commentAutomationMessageLabel = (messageType = "") => {
  const key = clean(messageType).toLowerCase();
  if (key === "comment_like") return "Like";
  if (key === "comment_public_reply") return "Public reply";
  if (key === "comment_private_reply") return "Private message";
  if (key === "automation_error") return "Automation error";
  return "";
};

const normalizeSocialCommentPost = (raw) => {
  const post = raw || {};
  const metadata = post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const mappingSummary = post.mapping_summary && typeof post.mapping_summary === "object" && !Array.isArray(post.mapping_summary) ? post.mapping_summary : {};
  const postLinkKey = String(
    post.post_link_key ||
      post.postLinkKey ||
      mappingSummary.post_link_key ||
      ""
  ).trim();
  const linkedProducts = Array.isArray(post.linked_products)
    ? post.linked_products
    : Array.isArray(mappingSummary.linked_products)
      ? mappingSummary.linked_products
      : [];
  const primaryLinkedProduct =
    post.primary_linked_product ||
    post.primary_product ||
    mappingSummary.primary_linked_product ||
    mappingSummary.primary_product ||
    linkedProducts[0] ||
    null;
  const linkedProductsCount = parseOptionalCount(post.linked_products_count, mappingSummary.count, linkedProducts.length) ?? 0;
  const productLinkSourceRaw = String(post.product_link_source || metadata.product_link_source || mappingSummary.product_link_source || "none").trim() || "none";
  const hasDirectProductLink = Boolean(
    (post.has_direct_product_link ?? metadata.has_direct_product_link ?? false) ||
    productLinkSourceRaw === "direct" ||
    productLinkSourceRaw === "v2_direct" ||
    linkedProductsCount > 0 ||
    linkedProducts.length > 0
  );
  const productLinkSource = hasDirectProductLink && productLinkSourceRaw === "none" ? "v2_direct" : productLinkSourceRaw;
  const resolvedThumbnail =
    post.thumbnail_url ||
    post.thumbnailUrl ||
    post.post_thumbnail ||
    post.post_full_picture ||
    post.attachment_image ||
    post.full_picture ||
    post.picture ||
    post.media_url ||
    post.image_url ||
    post.image ||
    metadata.thumbnail_url ||
    metadata.post_thumbnail ||
    metadata.post_full_picture ||
    metadata.attachment_image ||
    metadata.full_picture ||
    metadata.picture ||
    metadata.media_url ||
    metadata.image_url ||
    metadata.image ||
    null;
  const mappedProductName = String(primaryLinkedProduct?.name || primaryLinkedProduct?.title || primaryLinkedProduct?.product_name || post.product_name || metadata.product_name || "").trim();
  const mappedProductPrice = formatDisplayPrice(primaryLinkedProduct?.final_price, primaryLinkedProduct?.sale_price, primaryLinkedProduct?.price, primaryLinkedProduct?.selling_price, post.product_price, metadata.product_price);
  const displayPostTime = String(
    post.display_post_time ||
    post.created_time ||
    post.post_created_time ||
    post.published_at ||
    metadata.display_post_time ||
    metadata.created_time ||
    metadata.post_created_time ||
    metadata.published_at ||
    ""
  ).trim();
  const resolvedIdentityId = String(
    post.id ||
    post.post_id ||
    post.canonical_post_id ||
    post.platform_post_id ||
    post.source_post_id ||
    post.permalink_url ||
    post.post_permalink_url ||
    post.conversation_id ||
    post.session_id ||
    metadata.post_id ||
    metadata.canonical_post_id ||
    metadata.platform_post_id ||
    metadata.source_post_id ||
    metadata.permalink_url ||
    ""
  ).trim();
  if (!resolvedIdentityId) {
    console.warn("SOCIAL_CARD_NORMALIZE_REJECT_TRACE", {
      raw_keys: Object.keys(post || {}),
      raw_ids: [
        post.id,
        post.post_id,
        post.canonical_post_id,
        post.platform_post_id,
        post.source_post_id,
        post.permalink_url,
        post.post_permalink_url,
        post.post_link_key,
      ].map((value) => String(value ?? "").trim()).filter(Boolean),
      reject_reason: "missing_identity",
    });
  }
  return {
    id: resolvedIdentityId || String(post.post_id || post.id || post.conversation_id || post.session_id || metadata.post_id || post.permalink_url || ""),
    postId: String(post.post_id || post.id || post.canonical_post_id || post.platform_post_id || post.source_post_id || metadata.post_id || post.permalink_url || ""),
    conversationId: String(post.conversation_id || post.session_id || post.conversation_key || post.thread_id || metadata.conversation_id || ""),
    sessionId: String(post.session_id || metadata.session_id || ""),
    platform: String(post.platform || metadata.platform || "facebook").toLowerCase(),
    caption: String(post.caption || post.post_caption || post.post_message || post.message || post.last_message || post.post_text || metadata.post_caption || metadata.post_message || metadata.caption || metadata.message || "منشور بدون نص").trim(),
    thumbnailUrl: resolvedThumbnail,
    thumbnail_url: resolvedThumbnail,
    post_thumbnail: post.post_thumbnail || metadata.post_thumbnail || null,
    post_full_picture: post.post_full_picture || metadata.post_full_picture || null,
    attachment_image: post.attachment_image || metadata.attachment_image || null,
    full_picture: post.full_picture || metadata.full_picture || null,
    picture: post.picture || metadata.picture || null,
    media_url: post.media_url || metadata.media_url || null,
    image_url: post.image_url || metadata.image_url || null,
    image: post.image || metadata.image || null,
    attachments: post.attachments || metadata.attachments || null,
    metadata,
    platform_post_id: String(post.platform_post_id || post.post_id || post.id || metadata.platform_post_id || metadata.post_id || ""),
    source_post_id: String(post.source_post_id || post.post_id || post.id || metadata.source_post_id || metadata.post_id || ""),
    permalinkUrl: resolveExternalSocialPostUrl(post),
    permalink_url: String(post.permalink_url || post.post_permalink_url || metadata.permalink_url || metadata.post_permalink_url || ""),
    commentsCount: parseOptionalCount(post.comments_count, post.comment_count, post.total_comments, metadata.comments_count),
    newCount: parseOptionalCount(post.new_comments_count, post.unread_comments_count, metadata.new_comments_count) ?? 0,
    lastActivity: String(post.last_activity_at || post.last_comment_at || post.last_message_at || post.updated_at || post.created_at || metadata.last_activity_at || "").trim(),
    autoReplyEnabled: Boolean(post.auto_reply_enabled || post.template_enabled || post.auto_reply_mode || metadata.auto_reply_enabled || metadata.template_enabled || metadata.auto_reply_mode),
    productName: mappedProductName,
    productPrice: mappedProductPrice,
    productSalePrice: formatDisplayPrice(primaryLinkedProduct?.sale_price, post.product_sale_price, metadata.product_sale_price),
    productSizes: String(
      post.product_sizes ||
      metadata.product_sizes ||
      (Array.isArray(primaryLinkedProduct?.available_sizes) ? primaryLinkedProduct.available_sizes.join(", ") : "") ||
      (Array.isArray(primaryLinkedProduct?.sizes) ? primaryLinkedProduct.sizes.join(", ") : "")
    ).trim(),
    productColors: String(
      post.product_colors ||
      metadata.product_colors ||
      (Array.isArray(primaryLinkedProduct?.available_colors) ? primaryLinkedProduct.available_colors.join(", ") : "") ||
      (Array.isArray(primaryLinkedProduct?.colors) ? primaryLinkedProduct.colors.join(", ") : "")
    ).trim(),
    productStock: String(post.product_stock || metadata.product_stock || primaryLinkedProduct?.stock || primaryLinkedProduct?.total_stock || "").trim(),
    productVariantCount: String(post.product_variant_count || metadata.product_variant_count || linkedProducts.length || "").trim(),
    productLink: String(post.product_link || post.product_storefront_url || post.product_url || metadata.product_link || metadata.product_storefront_url || metadata.product_url || primaryLinkedProduct?.storefront_url || primaryLinkedProduct?.product_url || "").trim(),
    storeAddress: String(post.store_address || metadata.store_address || "").trim(),
    shippingTime: String(post.shipping_time || metadata.shipping_time || "").trim(),
    linkedProducts,
    linked_products: linkedProducts,
    primaryLinkedProduct,
    primary_linked_product: primaryLinkedProduct,
    linkedProductsCount,
    linked_products_count: linkedProductsCount,
    productLinkSource,
    product_link_source: productLinkSource,
    hasDirectProductLink,
    has_direct_product_link: hasDirectProductLink,
    post_link_key: postLinkKey || String(post.post_id || post.id || post.conversation_id || "").trim(),
    displayPostTime,
    display_post_time: displayPostTime,
    raw: post,
  };
};

const normalizeSocialCommentThreadComment = (raw) => {
  const comment = raw || {};
  const metadata = comment.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : {};
  const resolvedCommentId = String(
    comment.comment_id ||
    comment.external_comment_id ||
    comment.provider_comment_id ||
    comment.external_message_id ||
    comment.provider_message_id ||
    comment.message_id ||
    metadata.comment_id ||
    metadata.external_comment_id ||
    metadata.provider_comment_id ||
    metadata.external_message_id ||
    metadata.provider_message_id ||
    metadata.message_id ||
    ""
  ).trim();
  return {
    id: String(comment.id || resolvedCommentId || "").trim(),
    comment_id: String(comment.comment_id || metadata.comment_id || resolvedCommentId || "").trim(),
    external_comment_id: String(comment.external_comment_id || metadata.external_comment_id || "").trim(),
    provider_comment_id: String(comment.provider_comment_id || metadata.provider_comment_id || "").trim(),
    external_message_id: String(comment.external_message_id || metadata.external_message_id || "").trim(),
    provider_message_id: String(comment.provider_message_id || metadata.provider_message_id || "").trim(),
    message_id: String(comment.message_id || metadata.message_id || "").trim(),
    message: String(comment.customer_message || comment.message || comment.text || comment.message_text || comment.original_comment_text || metadata.customer_message || metadata.message || "").trim(),
    customerName: String(comment.commenter_name || comment.customer_name || metadata.commenter_name || metadata.customer_name || "عميل").trim(),
    customerAvatar: String(comment.avatar || comment.customer_avatar || comment.customer_avatar_url || comment.commenter_profile_picture_url || comment.avatar_url || comment.profile_pic || metadata.avatar || metadata.customer_avatar || "").trim(),
    classification: String(comment.classification_label || comment.classification || comment.intent || metadata.classification_label || metadata.classification || metadata.intent || "Question").trim(),
    replyStatus: String(comment.reply_status || metadata.reply_status || "pending").trim(),
    createdTime: getSocialCommentRealTimestamp(comment).timestamp,
    metadata,
    postId: String(comment.post_id || comment.conversation_post_id || comment.thread_post_id || metadata.post_id || "").trim(),
    platform: String(comment.platform || metadata.platform || "").trim(),
    permalinkUrl: String(comment.permalink_url || comment.comment_url || metadata.permalink_url || metadata.comment_url || "").trim(),
    replyText: String(comment.reply_text || comment.rendered_reply || metadata.reply_text || metadata.rendered_reply || "").trim(),
    metadata,
    raw: comment,
  };
};

const isSocialPostSummary = (item = {}) =>
  Object.prototype.hasOwnProperty.call(item, "comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "new_comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "last_comment_text") ||
  Object.prototype.hasOwnProperty.call(item, "post_full_picture") ||
  Object.prototype.hasOwnProperty.call(item, "full_picture");

const labelMatchesFilter = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  if (isSocialPostSummary(item)) {
    const platform = clean(item.platform).toLowerCase();
    if (filter === "facebook") return platform === "facebook" || platform === "facebook_comment";
    if (filter === "instagram") return platform === "instagram" || platform === "instagram_comment";
    if (filter === "needs_human" || filter === "needs_reply") return Number(item.new_comments_count || 0) > 0 || clean(item.reply_status || item.auto_reply_mode).toLowerCase() !== "sent";
    if (filter === "ai_replied" || filter === "replied") return clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent";
    if (filter === "unread") return Number(item.new_comments_count || 0) > 0;
    if (filter === "auto_reply_on") return Boolean(item.auto_reply_enabled || item.template_enabled || item.generic_enabled);
    return true;
  }
  const label = clean(item.classification_label).toLowerCase();
  if (filter === "ignore") return ["ignore", "engagement_only"].includes(label);
  if (filter === "human_review") return label === "human_review";
  return label === filter;
};

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const filters = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "comments", label: "Comments" },
  { key: "needs_reply", label: "Needs Reply" },
];

const FAVORITE_FILTERS = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favorites" },
];

const MESSAGE_PLATFORM_FILTERS = [
  { key: "all", label: "All Messages" },
  { key: "messenger", label: "Messenger" },
  { key: "instagram", label: "Instagram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "web", label: "Web" },
  { key: "tiktok", label: "TikTok" },
];

const COMMENT_PLATFORM_FILTERS = [
  { key: "all", label: "All Comments" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
];

const leadFilters = [
  { key: "all", label: "الكل" },
  { key: "ready_to_buy", label: "جاهز للشراء" },
  { key: "hot", label: "ساخن" },
  { key: "warm", label: "دافئ" },
  { key: "needs_human", label: "يحتاج تدخلًا بشريًا" },
];

const leadTemperatureMeta = {
  cold: { label: "بارد", tone: "zinc", icon: Snowflake, emphasis: "subtle" },
  warm: { label: "دافئ", tone: "amber", icon: Sparkles, emphasis: "moderate" },
  hot: { label: "ساخن", tone: "rose", icon: Flame, emphasis: "clear" },
  ready_to_buy: { label: "جاهز للشراء", tone: "emerald", icon: CheckCircle2, emphasis: "maximum" },
};

const normalizeLeadTemperature = (value = "") => {
  const key = clean(value).toLowerCase().replace(/\s+/g, "_");
  if (["ready_to_buy", "ready", "readytobuy", "ready_to_confirm", "ready_to_confirm_order"].includes(key)) return "ready_to_buy";
  if (["hot", "hot_lead", "hotlead"].includes(key)) return "hot";
  if (["warm", "warm_lead", "warmlead"].includes(key)) return "warm";
  return "cold";
};

const normalizeLeadScore = (value = 0) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
};

const normalizeLeadReasons = (value = []) => asArray(value).map((item) => clean(item)).filter(Boolean);

const normalizeSalesAction = (value = "") => clean(value) || "continue_conversation";

const conversationLeadSnapshot = (conversation = {}) =>
  conversation?.lead_metadata ||
  conversation?.lead ||
  conversation?.channel_metadata?.lead ||
  conversation?.channel_metadata?.lead_metadata ||
  conversation?.unified_reply ||
  conversation?.latest_ai_reply ||
  conversation?.ai_reply ||
  conversation?.sales_intelligence ||
  {};

const conversationLeadScore = (conversation = {}) =>
  normalizeLeadScore(
    conversation?.lead_score ??
      conversation?.memory_score ??
      conversationLeadSnapshot(conversation)?.lead_score ??
      conversationLeadSnapshot(conversation)?.memory_score ??
      0
  );

const conversationLeadTemperature = (conversation = {}) =>
  normalizeLeadTemperature(
    conversation?.lead_temperature ??
      conversationLeadSnapshot(conversation)?.lead_temperature ??
      (conversation?.needs_human_support || conversation?.conversation_status === "human_takeover" ? "hot" : "")
  );

const conversationLeadReasons = (conversation = {}) =>
  normalizeLeadReasons(
    conversation?.lead_reasons ??
      conversationLeadSnapshot(conversation)?.lead_reasons ??
      conversationLeadSnapshot(conversation)?.lead_reasons_list ??
      []
  );

const conversationRecommendedSalesAction = (conversation = {}) =>
  normalizeSalesAction(
    conversation?.recommended_sales_action ??
      conversationLeadSnapshot(conversation)?.recommended_sales_action ??
      conversationLeadSnapshot(conversation)?.sales_action ??
      ""
  );

const leadMeta = {
  "Hot Lead": { tone: "rose", icon: Flame },
  "Warm Lead": { tone: "amber", icon: Sparkles },
  "Cold Lead": { tone: "cyan", icon: Snowflake },
  VIP: { tone: "emerald", icon: UserCheck },
  Complaint: { tone: "rose", icon: AlertTriangle },
};

const sentimentTone = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "positive") return "emerald";
  if (key === "negative") return "rose";
  return "zinc";
};

const relativeTime = (value) => {
  if (!value) return "لا يوجد نشاط";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.round(hours / 24)} يوم`;
};

const absoluteTime = (value) => (value ? new Date(value).toLocaleString() : "");
const shortText = (value = "", limit = 140) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
};
const isMetaChannel = (value = "") => ["facebook_messenger", "instagram"].includes(clean(value).toLowerCase());
const isFacebookMessengerChannel = (value = "") => ["facebook_messenger", "facebook", "messenger"].includes(clean(value).toLowerCase());
const isWhatsappChannel = (value = "") => clean(value).toLowerCase() === "whatsapp";
const socialCommentsDebugEnabled = () =>
  import.meta.env.DEV ||
  ["1", "true", "yes", "on"].includes(String(import.meta.env.VITE_AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || import.meta.env.VITE_AI_SUPPORT_DEBUG || "").toLowerCase());
const DEBUG_SOCIAL_COMMENTS = socialCommentsDebugEnabled();
const canViewAiDebugPanel = (user = {}) => {
  const role = clean(user.role || user.role_name || user.user_role || user.type).toLowerCase();
  return Boolean(
    import.meta.env.DEV ||
      user.is_super_admin ||
      user.is_admin ||
      ["admin", "super_admin", "superadmin", "owner"].includes(role)
  );
};
const canSyncMessengerProfile = (conversation) => {
  const channel = clean(conversation?.channel || conversation?.source).toLowerCase();
  const source = clean(conversation?.source).toLowerCase();
  const provider = clean(conversation?.provider || conversation?.platform).toLowerCase();
  const sessionId = clean(conversation?.session_id || conversation?.conversation_id || conversation?.id).toLowerCase();
  const externalConversationId = clean(conversation?.external_conversation_id).toLowerCase();

  return (
    isFacebookMessengerChannel(channel) ||
    isFacebookMessengerChannel(source) ||
    isFacebookMessengerChannel(provider) ||
    sessionId.startsWith("facebook_messenger:") ||
    externalConversationId.startsWith("facebook_messenger:")
  );
};
// Phase 12 polish — MIRRORS server instagramProductShareText (aiProductCards.js) so the AI Inbox preview shows
// the exact concise text/link package that will reach Instagram. Kept field-for-field identical to the server
// formatter; the instagramShareParity test guards against drift. Name + optional colour + customer price + URL.
const instagramShareText = (card = {}) => {
  const name = clean(card.name || card.product_name || card.title || "");
  const color = clean(card.color || "");
  const price = card.display_price ?? card.price ?? null;
  const url = clean(card.storefront_url || card.product_url || card.url || "");
  return [
    name,
    color ? `اللون: ${color}` : "",
    (price != null && price !== "" && Number.isFinite(Number(price))) ? `السعر: ${Math.round(Number(price))} جنيه` : "",
    url ? "عرض المنتج:" : "",
    url || "",
  ].filter(Boolean).join("\n");
};

// Phase 13.2 — MONOTONIC AI-draft reconciliation. A completed assisted send clears the server draft to a
// versioned TOMBSTONE (status "sent" + the completed source_message_id). When merging a refreshed / cached /
// socket conversation row over an existing one, the AUTHORITATIVE draft is chosen deterministically so a stale
// payload can NEVER resurrect a completed suggestion:
//   1. a NEWER source_message_id (a fresh not_sent Y) beats an older draft/tombstone X
//   2. same source_message_id: a completed/cleared tombstone beats a pending draft (older pending X can't win)
//   3. else the newer server timestamp wins
const draftOf = (row) => row?.ai_reply_draft || row?.last_ai_reply_draft || null;
const draftMetaOf = (row) => {
  const d = draftOf(row);
  const src = Number(d?.metadata?.source_message_id || d?.source_message_id || 0) || 0;
  const status = String(d?.status || "").toLowerCase();
  const t = row?.last_ai_reply_draft_updated_at || d?.updated_at || d?.metadata?.updated_at || "";
  const ts = t ? new Date(t).getTime() : 0;
  return { src, completed: status === "sent" || status === "cleared", ts: Number.isFinite(ts) ? ts : 0 };
};
const reconcileConversationDraft = (existing, incoming) => {
  const e = draftMetaOf(existing);
  const i = draftMetaOf(incoming);
  let winner;
  if (i.src !== e.src) winner = i.src > e.src ? incoming : existing;
  else if (i.completed !== e.completed) winner = i.completed ? incoming : existing;
  else winner = i.ts >= e.ts ? incoming : existing;
  return {
    ai_reply_draft: winner?.ai_reply_draft ?? winner?.last_ai_reply_draft ?? null,
    last_ai_reply_draft: winner?.last_ai_reply_draft ?? winner?.ai_reply_draft ?? null,
    last_ai_reply_draft_updated_at: winner?.last_ai_reply_draft_updated_at || draftOf(winner)?.updated_at || "",
  };
};

const channelLabel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "facebook_messenger") return "ماسنجر فيسبوك";
  if (key === "facebook_comment") return "تعليق فيسبوك";
  if (key === "instagram_comment") return "تعليق إنستجرام";
  if (key === "instagram") return "رسائل إنستجرام";
  if (key === "whatsapp") return "واتساب";
  if (key === "web_chat") return "دردشة الويب";
  return key || "قناة غير معروفة";
};
const channelBadgeLabel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key.includes("whatsapp")) return "واتساب";
  if (key.includes("facebook_comment")) return "تعليق فيسبوك";
  if (key.includes("instagram_comment")) return "تعليق إنستجرام";
  if (key.includes("instagram")) return "إنستجرام DM";
  if (key.includes("facebook") && key.includes("messenger")) return "ماسنجر";
  if (key.includes("facebook")) return "فيسبوك";
  if (key.includes("messenger")) return "ماسنجر";
  if (key.includes("web")) return "ويب";
  return "الكل";
};
const isConversationAiEnabled = (conversation = {}) => conversation?.ai_enabled !== false;
const conversationChannelAliases = ["whatsapp", "facebook_messenger", "messenger", "instagram", "instagram_dm", "web_chat", "web"];
const socialCommentChannelAliases = ["facebook_comment", "instagram_comment"];
const isSocialCommentChannel = (value = "") => {
  const key = clean(value).toLowerCase();
  return socialCommentChannelAliases.some((alias) => key === alias || key.includes(alias));
};
const isConversationChannel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (!key) return false;
  if (isSocialCommentChannel(key)) return false;
  return conversationChannelAliases.some((alias) => key === alias || key.includes(alias));
};
const conversationChannelOrder = ["whatsapp", "messenger", "instagram", "web"];
const socialCommentChannelOrder = ["facebook_comment", "instagram_comment"];
// The UI channel vocabulary ("messenger", "web") is NOT the backend's. loadAiInbox
// only recognises facebook_messenger | instagram | whatsapp | web_chat |
// facebook_comment | instagram_comment; anything else silently matches no clause
// and the server returns the unfiltered top-N across every channel. The PWA has
// always mapped these before sending — ERP did not, so its channel chips never
// narrowed the query server-side. Empty string means "no channel filter".
// Canonical channel vocabulary, per-channel windows and the fair-merge helper
// all live in the shared module so they stay unit-testable and cannot drift.
const normalizeConversationChannel = (conversation = {}) => {
  const raw = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform || "");
  const key = raw.toLowerCase();
  if (key.includes("whatsapp")) return "whatsapp";
  if (key.includes("facebook_comment")) return "facebook_comment";
  if (key.includes("instagram_comment")) return "instagram_comment";
  if (key.includes("instagram")) return "instagram";
  if (key.includes("facebook") && key.includes("messenger")) return "messenger";
  if (key.includes("messenger")) return "messenger";
  if (key.includes("facebook")) return "messenger";
  if (key.includes("web")) return "web";
  return key || "unknown";
};
const normalizeWhatsappSessionIdentity = (value = "", phone = "") => {
  const candidates = [value, phone];
  for (const candidate of candidates) {
    const raw = clean(candidate);
    if (!raw) continue;
    const digits = raw
      .replace(/^whatsapp:/i, "")
      .replace(/@(?:s\.whatsapp\.net|lid)$/i, "")
      .replace(/\D/g, "");
    if (digits) {
      if (digits.startsWith("20") && digits.length === 12) return `whatsapp:${digits}`;
      if (digits.startsWith("0") && digits.length === 11) return `whatsapp:20${digits.slice(1)}`;
      return `whatsapp:${digits}`;
    }
  }
  return "";
};
const conversationKey = (conversation = {}) => {
  const channel = normalizeConversationChannel(conversation);
  const sessionId = clean(conversation?.id || conversation?.conversation_id || conversation?.session_id);
  const whatsappSessionId = channel === "whatsapp" ? normalizeWhatsappSessionIdentity(sessionId, conversation?.external_customer_id || conversation?.phone || "") : "";
  return whatsappSessionId || `${channel}:${sessionId}`;
};
const customerAvatarUrl = (item = {}) => {
  const source = item || {};
  return clean(
    source.customer_avatar_url ||
    source.profile_pic_url ||
    source.profile_pic ||
    source.avatar_url ||
    source.customer_profile?.customer_avatar_url ||
    source.customer_profile?.avatar_url ||
    source.customer_profile?.profile_pic_url ||
    source.customer_profile?.profile_pic ||
    source.channel_metadata?.profile_pic ||
    source.channel_metadata?.messenger_profile?.profile_pic
  );
};
const firstNonEmpty = (...values) => values.map((value) => clean(value)).find(Boolean) || "";
const isLikelyMessengerExternalId = (value = "") => {
  const candidate = clean(value).replace(/\s+/g, "");
  return Boolean(candidate) && /^\d{5,}$/.test(candidate);
};
const messengerIdentityKey = (conversation = {}) => clean(
  conversation.external_customer_id ||
  conversation.sender_psid ||
  conversation.customer_profile?.external_customer_id ||
  conversation.customer?.external_customer_id ||
  conversation.channel_metadata?.sender_psid ||
  conversation.channel_metadata?.customer_psid ||
  conversation.phone ||
  ""
);
const messengerSelectedCustomer = (conversation = {}) => conversation.customer || conversation.customer_profile || {};
const messengerSelectedCustomerMatches = (conversation = {}) => {
  const identityKey = messengerIdentityKey(conversation);
  const selectedCustomer = messengerSelectedCustomer(conversation);
  const selectedCustomerExternalId = clean(
    selectedCustomer?.external_customer_id ||
    selectedCustomer?.phone ||
    conversation.customer_profile?.external_customer_id ||
    ""
  );
  return Boolean(identityKey && selectedCustomerExternalId && selectedCustomerExternalId === identityKey);
};
const messengerDisplayName = (conversation = {}) => {
  const source = conversation || {};
  const profile = source.customer_profile || {};
  const messengerProfile = source.channel_metadata?.messenger_profile || source.channel_metadata?.customer_profile || source.customer_profile?.messenger_profile || {};
  const candidates = [
    source.customer_name,
    source.customer?.name,
    profile.name,
    profile.display_name,
    profile.facebook_name,
    profile.messenger_name,
    profile.full_name,
    profile.sender_name,
    profile.profile_name,
    profile.contact_name,
    profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : "",
    messengerProfile.name,
    messengerProfile.display_name,
    messengerProfile.facebook_name,
    messengerProfile.messenger_name,
    messengerProfile.full_name,
    messengerProfile.sender_name,
    messengerProfile.profile_name,
    messengerProfile.contact_name,
    messengerProfile.first_name && messengerProfile.last_name ? `${messengerProfile.first_name} ${messengerProfile.last_name}` : "",
    source.customer_profile?.name,
    source.customer_profile?.full_name,
    source.customer_profile?.display_name,
    source.customer_profile?.facebook_name,
    source.customer_profile?.messenger_name,
    source.customer_profile?.sender_name,
    source.customer_profile?.profile_name,
    source.customer_profile?.contact_name,
    source.customer_profile?.first_name && source.customer_profile?.last_name
      ? `${source.customer_profile.first_name} ${source.customer_profile.last_name}`
      : "",
    source.display_name,
    source.facebook_name,
    source.messenger_name,
    source.first_name && source.last_name ? `${source.first_name} ${source.last_name}` : ""
  ].filter(Boolean);
  const profileName = candidates.find((candidate) => {
    const value = clean(candidate);
    if (!value) return false;
    if (isGenericCustomerName(value)) return false;
    return !isLikelyMessengerExternalId(value);
  });
  if (profileName) return profileName;
  return "";
};
const isMessengerConversation = (conversation = {}) => {
  const channel = normalizeConversationChannel(conversation);
  const source = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform).toLowerCase();
  if (channel === "facebook_comment" || channel === "instagram_comment" || source.includes("_comment")) return false;
  return (
    channel === "messenger" ||
    channel === "facebook" ||
    source.includes("facebook_messenger") ||
    source === "messenger" ||
    source === "facebook" ||
    source.includes("messenger")
  );
};
const isCommentConversation = (conversation = {}) => {
  const channel = normalizeConversationChannel(conversation);
  const source = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform).toLowerCase();
  const threadKind = clean(conversation?.thread_kind || conversation?.channel_metadata?.thread_kind || "").toLowerCase();
  return channel === "facebook_comment" || channel === "instagram_comment" || threadKind === "comment" || source.includes("_comment");
};

const getConversationThreadMetadata = (item = {}) => {
  const channelMetadata = item?.channel_metadata && typeof item.channel_metadata === "object" && !Array.isArray(item.channel_metadata) ? item.channel_metadata : {};
  const metadata = item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {};
  return { channelMetadata, metadata };
};

const isSocialCommentThread = (item = {}) => {
  const { channelMetadata, metadata } = getConversationThreadMetadata(item);
  const channel = normalizeConversationChannel(item);
  const source = clean(item?.channel || item?.source || item?.provider || item?.platform || channel || metadata.source || metadata.source_type || "").toLowerCase();
  const threadKind = clean(item?.thread_kind || channelMetadata.thread_kind || metadata.thread_kind || "").toLowerCase();
  const sourceType = clean(item?.source_type || channelMetadata.source_type || metadata.source_type || metadata.sourceType || "").toLowerCase();
  const commentId = clean(
    item?.comment_id ||
      item?.external_comment_id ||
      item?.provider_comment_id ||
      channelMetadata.comment_id ||
      metadata.comment_id ||
      metadata.external_comment_id ||
      metadata.provider_comment_id ||
      ""
  );
  const postId = clean(
    item?.post_id ||
      item?.conversation_post_id ||
      item?.thread_post_id ||
      channelMetadata.post_id ||
      metadata.post_id ||
      ""
  );
  return (
    threadKind === "social_comment" ||
    threadKind === "comment" ||
    sourceType === "social_comment" ||
    source === "social_comments" ||
    channel === "facebook_comment" ||
    channel === "instagram_comment" ||
    Boolean(commentId || postId || channelMetadata.comment_id || channelMetadata.post_id || metadata.comment_id || metadata.post_id)
  );
};

const getMessagePlatform = (item = {}) => {
  if (isSocialCommentThread(item)) return "";
  const source = clean(item?.channel || item?.source || item?.provider || item?.platform || item?.source_platform || "").toLowerCase();
  if (source.includes("facebook_messenger") || source.includes("messenger")) return "messenger";
  if (source.includes("instagram_dm") || source.includes("instagram")) return "instagram";
  if (source.includes("whatsapp")) return "whatsapp";
  if (source.includes("web") || source.includes("website")) return "web";
  if (source.includes("tiktok_dm") || source.includes("tiktok")) return "tiktok";
  return "web";
};

const matchesMessagePlatform = (item = {}, activeMessagePlatformFilter = "all") => {
  if (activeMessagePlatformFilter === "all") return true;
  if (isSocialCommentThread(item)) return false;
  return getMessagePlatform(item) === activeMessagePlatformFilter;
};

const getCommentPlatform = (item = {}) => {
  if (!isSocialCommentThread(item)) return "";
  const platform = clean(item?.platform || item?.metadata?.platform || item?.channel_metadata?.platform || "").toLowerCase();
  const source = clean(item?.channel || item?.source || item?.provider || item?.platform || item?.metadata?.platform || item?.source_platform || "").toLowerCase();
  if (platform === "facebook" || source.includes("facebook")) return "facebook";
  if (platform === "instagram" || source.includes("instagram")) return "instagram";
  if (platform === "tiktok" || source.includes("tiktok")) return "tiktok";
  return platform || "facebook";
};

const matchesCommentPlatform = (item = {}, activeCommentPlatformFilter = "all") => {
  if (activeCommentPlatformFilter === "all") return true;
  if (!isSocialCommentThread(item)) return false;
  return getCommentPlatform(item) === activeCommentPlatformFilter;
};

const isMessageThread = (item = {}) => !isSocialCommentThread(item) && Boolean(getMessagePlatform(item));

const getInboxItemKind = (item = {}) => (isSocialCommentThread(item) ? "comment" : "message");

const latestCommentMessage = (conversation = {}) =>
  [...uniqueMessages(conversation?.messages || [])].reverse().find((message) =>
    clean(message?.message_type).toLowerCase() === "comment_inbound" ||
    clean(message?.thread_kind).toLowerCase() === "comment" ||
    clean(message?.commenter_name)
  ) || conversation?.latest_comment || conversation?.last_comment || conversation?.comment || {};

const isUsefulCommenterName = (value = "") => {
  const name = clean(value);
  return Boolean(name) && !/^\d+$/.test(name) && !["customer", "unknown", "guest", "anonymous", "commenter", "عميل", "العميل"].includes(name.toLowerCase());
};

const commentThreadCommenterName = (conversation = {}) => {
  const message = latestCommentMessage(conversation);
  const candidates = [
    conversation?.commenter_name,
    conversation?.last_commenter_name,
    conversation?.latest_commenter_name,
    conversation?.channel_metadata?.last_commenter_name,
    conversation?.channel_metadata?.commenter_name,
    conversation?.metadata?.last_commenter_name,
    conversation?.metadata?.commenter_name,
    message?.commenter_name,
    message?.customer_name,
    message?.from?.name,
    message?.sender?.name,
    conversation?.customer_name,
    conversation?.sender_name,
    conversation?.customer_profile?.name,
    conversation?.customer?.name,
  ];
  return clean(candidates.find(isUsefulCommenterName)) || "مستخدم فيسبوك";
};

const commentThreadCustomerAvatarUrl = (conversation = {}) => {
  const message = latestCommentMessage(conversation);
  return firstNonEmpty(
    conversation?.commenter_profile_picture_url,
    conversation?.latest_commenter_avatar_url,
    conversation?.customer_avatar_url,
    conversation?.channel_metadata?.commenter_profile_picture_url,
    conversation?.channel_metadata?.last_commenter_avatar_url,
    conversation?.channel_metadata?.customer_avatar_url,
    conversation?.metadata?.commenter_profile_picture_url,
    conversation?.metadata?.last_commenter_avatar_url,
    message?.commenter_profile_picture_url,
    message?.customer_avatar_url,
    message?.from?.picture?.data?.url,
    message?.from?.picture,
    conversation?.customer_profile?.avatar_url,
    conversation?.customer?.avatar_url
  );
};

const commentConversationPostUrl = (conversation = {}) =>
  firstNonEmpty(
    conversation?.channel_metadata?.comment_url,
    conversation?.channel_metadata?.post_permalink_url,
    conversation?.channel_metadata?.post_permalink,
    conversation?.channel_metadata?.permalink_url,
    conversation?.channel_metadata?.post_url,
    conversation?.metadata?.comment_url,
    conversation?.metadata?.post_permalink_url,
    conversation?.metadata?.post_permalink,
    conversation?.metadata?.permalink_url,
    conversation?.metadata?.post_url,
    conversation?.comment_url,
    conversation?.post_permalink_url,
    conversation?.post_permalink,
    conversation?.permalink_url,
    conversation?.post_url,
    conversation?.last_message_permalink
  );

const commentThreadPostImageUrl = (conversation = {}) =>
  firstNonEmpty(
    conversation?.post_full_picture,
    conversation?.post_image_url,
    conversation?.media_url,
    conversation?.thumbnail_url,
    conversation?.channel_metadata?.post_full_picture,
    conversation?.channel_metadata?.full_picture,
    conversation?.channel_metadata?.post_image_url,
    conversation?.channel_metadata?.media_url,
    conversation?.channel_metadata?.thumbnail_url,
    conversation?.channel_metadata?.post_thumbnail,
    conversation?.channel_metadata?.attachment_image,
    conversation?.channel_metadata?.picture,
    conversation?.channel_metadata?.image_url,
    conversation?.metadata?.post_full_picture,
    conversation?.metadata?.full_picture,
    conversation?.metadata?.post_image_url,
    conversation?.metadata?.media_url,
    conversation?.metadata?.thumbnail_url,
    conversation?.metadata?.post_thumbnail,
    conversation?.metadata?.attachment_image,
    conversation?.metadata?.picture,
    conversation?.metadata?.image_url,
    latestCommentMessage(conversation)?.post_full_picture,
    latestCommentMessage(conversation)?.post_image_url,
    latestCommentMessage(conversation)?.media_url,
    latestCommentMessage(conversation)?.attachment?.media?.image?.src,
    conversation?.full_picture,
    conversation?.image_url
  );

const commentThreadPostTitle = (conversation = {}) =>
  firstNonEmpty(
    conversation?.channel_metadata?.post_message,
    conversation?.channel_metadata?.post_caption,
    conversation?.metadata?.post_message,
    conversation?.metadata?.post_caption,
    conversation?.post_message,
    conversation?.post_caption,
    conversation?.last_message
  );

const commentThreadLastComment = (conversation = {}) =>
  firstNonEmpty(
    conversation?.channel_metadata?.last_comment_text,
    conversation?.metadata?.last_comment_text,
    conversation?.last_comment_text,
    conversation?.latest_message_preview,
    conversation?.last_message,
    [...uniqueMessages(conversation.messages)].reverse().find((message) => clean(message.customer_message || message.message_text || message.text || message.body || message.content || message.caption || ""))?.customer_message ||
      ""
  );

const commentThreadCommentCount = (conversation = {}) =>
  Number(
    conversation?.channel_metadata?.comments_count ||
      conversation?.metadata?.comments_count ||
      (Array.isArray(conversation?.messages) ? conversation.messages.filter((message) => clean(message?.message_type).toLowerCase() === "comment_inbound" || clean(message?.thread_kind).toLowerCase() === "comment").length : 0) ||
      conversation?.message_count ||
      conversation?.channel_metadata?.comment_count ||
      0
  ) || 0;

const commentThreadPostTime = (conversation = {}) =>
  firstNonEmpty(
    conversation?.channel_metadata?.post_created_time,
    conversation?.metadata?.post_created_time,
    conversation?.post_created_time,
    conversation?.channel_metadata?.last_comment_at,
    conversation?.metadata?.last_comment_at,
    conversation?.last_activity_at,
    conversation?.last_message_at
  );

const commentThreadDisplayName = (conversation = {}) =>
  firstNonEmpty(
    commentThreadPostTitle(conversation),
    conversation?.channel_metadata?.post_title,
    conversation?.channel_metadata?.post_name,
    conversation?.channel_metadata?.post_caption,
    conversation?.metadata?.post_title,
    conversation?.metadata?.post_name,
    conversation?.metadata?.post_caption,
    conversation?.last_message,
    "Post"
  );

const isLeadThreadConversation = (conversation = {}) => isCommentConversation(conversation) || isMessengerConversation(conversation);

const leadConversationDisplayName = (conversation = {}) => {
  const profile = conversation?.customer_profile || {};
  return firstNonEmpty(
    conversation.customer_profile?.name,
    profile.name,
    [profile.first_name, profile.last_name].map(clean).filter(Boolean).join(" "),
    conversation.customer_name,
    conversation.channel_metadata?.commenter_name,
    conversation.metadata?.commenter_name,
    conversation.sender_name,
    conversation.external_customer_id,
    conversation.phone,
    "Lead"
  );
};

const conversationPreview = (conversation = {}) => {
  const latestCards = normalizeProductCardsValue(
    conversation.last_product_cards ||
      conversation.latest_product_cards ||
      conversation.channel_metadata?.last_product_cards
  );
  const preview = clean(
    conversation.latest_message_preview ||
      conversation.last_message_preview ||
      conversation.latest_message ||
      conversation.last_message ||
      conversation.last_customer_message ||
      conversation.customer_message_preview
  );
  if (preview) return preview;
  if (latestCards.length) return productCardPreviewText(latestCards) || "Product card sent";
  const latestMessage = [...uniqueMessages(conversation.messages)].reverse().find((message) => clean(message.customer_message || message.message_text || message.text || message.body || message.content || message.caption || ""));
  return clean(latestMessage?.customer_message || latestMessage?.message_text || latestMessage?.text || latestMessage?.body || latestMessage?.content || latestMessage?.caption || "");
};

const buildLeadPrivateMessageText = (conversation = {}, comment = {}) => {
  const name = clean(comment?.commenter_name || leadConversationDisplayName(conversation));
  return `مرحباً${name ? ` ${name}` : ""}، أرسلت لك التفاصيل في الخاص.`;
};

const buildLeadCommentReplyText = (conversation = {}, comment = {}) => {
  const name = clean(comment?.commenter_name || leadConversationDisplayName(conversation));
  return `شكراً${name ? ` ${name}` : ""}، أرسلنا لك التفاصيل في الخاص.`;
};

const LEAD_STATUS_META = {
  new: { label: "New", tone: "cyan" },
  contacted: { label: "Contacted", tone: "amber" },
  interested: { label: "Interested", tone: "emerald" },
  negotiation: { label: "Negotiation", tone: "violet" },
  won: { label: "Won", tone: "emerald" },
  lost: { label: "? Lost", tone: "rose" },
};

const CONVERSATION_LABEL_CLASSES = {
  sky: "border-sky-400/35 bg-sky-500/15 text-sky-100",
  cyan: "border-cyan-400/35 bg-cyan-500/15 text-cyan-100",
  amber: "border-amber-400/35 bg-amber-500/15 text-amber-100",
  violet: "border-violet-400/35 bg-violet-500/15 text-violet-100",
  emerald: "border-emerald-400/35 bg-emerald-500/15 text-emerald-100",
  rose: "border-rose-400/35 bg-rose-500/15 text-rose-100",
  orange: "border-orange-400/35 bg-orange-500/15 text-orange-100",
  teal: "border-teal-400/35 bg-teal-500/15 text-teal-100",
};

const CONVERSATION_LABEL_DOT_CLASSES = {
  sky: "bg-sky-400",
  cyan: "bg-cyan-400",
  amber: "bg-amber-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  orange: "bg-orange-400",
  teal: "bg-teal-400",
};

const conversationLabelClass = (color = "sky") => CONVERSATION_LABEL_CLASSES[color] || CONVERSATION_LABEL_CLASSES.sky;
const conversationLabelDotClass = (color = "sky") => CONVERSATION_LABEL_DOT_CLASSES[color] || CONVERSATION_LABEL_DOT_CLASSES.sky;

const normalizeLeadStatus = (value = "") => {
  const key = clean(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEAD_STATUS_META, key) ? key : "new";
};

const leadStatusLabel = (value = "") => LEAD_STATUS_META[normalizeLeadStatus(value)]?.label || "New";
const leadStatusTone = (value = "") => LEAD_STATUS_META[normalizeLeadStatus(value)]?.tone || "cyan";
const conversationLeadStatus = (conversation = {}) =>
  normalizeLeadStatus(
    conversation?.lead_status ||
      conversation?.channel_metadata?.lead_status ||
      conversation?.metadata?.lead_status ||
      ""
  );

const leadSourceKey = (conversation = {}) => {
  const channel = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform).toLowerCase();
  const threadKind = clean(conversation?.thread_kind || conversation?.channel_metadata?.thread_kind || "").toLowerCase();
  const hasCommentId = Boolean(
    clean(conversation?.external_comment_id || conversation?.comment_id || conversation?.channel_metadata?.comment_id || conversation?.channel_metadata?.lead?.comment_id)
  );
  if (channel.includes("instagram") && (channel.includes("comment") || threadKind === "comment" || hasCommentId)) return "instagram_comment";
  if ((channel.includes("facebook") || channel.includes("messenger")) && (channel.includes("comment") || threadKind === "comment" || hasCommentId)) return "facebook_comment";
  if (channel.includes("instagram")) return "messenger";
  if (channel.includes("facebook") || channel.includes("messenger")) return "messenger";
  return threadKind === "comment" || hasCommentId ? "facebook_comment" : "messenger";
};

const leadSourceLabel = (conversation = {}) => {
  const key = leadSourceKey(conversation);
  if (key === "facebook_comment") return "Facebook Comment";
  if (key === "instagram_comment") return "Instagram Comment";
  return "Messenger";
};

const getConversationSourceLabel = (item = {}) => {
  const { channelMetadata, metadata } = getConversationThreadMetadata(item);
  const platform = clean(item?.platform || item?.source_platform || item?.channel || item?.source || channelMetadata.platform || metadata.platform || "").toLowerCase();
  if (isSocialCommentThread(item)) {
    if (platform.includes("instagram")) return "Instagram Comment";
    if (platform.includes("facebook")) return "Facebook Comment";
    return "Comment";
  }
  const channel = normalizeConversationChannel(item);
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "instagram") return "Instagram DM";
  if (channel === "messenger") return "Messenger";
  if (channel === "web") return "Web Chat";
  if (channel === "tiktok") return "TikTok DM";
  return channelLabel(platform || channel);
};

const getConversationSourceIcon = (item = {}) => {
  if (isSocialCommentThread(item)) return MessageSquareText;
  const channel = normalizeConversationChannel(item);
  if (channel === "whatsapp") return FaWhatsapp;
  if (channel === "instagram") return FaInstagram;
  if (channel === "messenger") return FaFacebookMessenger;
  return MessageSquareText;
};

const normalizeExternalSocialUrl = (value = "") => {
  const candidate = clean(value);
  if (!candidate) return "";
  if (/^social_comment:/i.test(candidate)) return "";
  if (/^\/marketing\/social-comments/i.test(candidate)) return "";
  if (/^https?:\/\/[^/]+\/marketing\/social-comments/i.test(candidate)) return "";
  return candidate;
};

const buildFacebookPostUrlFromId = (value = "") => {
  const candidate = clean(value);
  if (!candidate || /^social_comment:/i.test(candidate)) return "";
  const segments = candidate.split("_").map((part) => clean(part)).filter(Boolean);
  if (segments.length >= 2) {
    return `https://www.facebook.com/${segments[0]}/posts/${segments[1]}`;
  }
  return /^\d+$/.test(candidate) ? `https://www.facebook.com/${candidate}` : "";
};

const resolveExternalSocialPostUrl = (item = {}) => {
  const metadata = item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {};
  const platform = clean(item?.platform || item?.source_platform || metadata?.platform || "facebook").toLowerCase();
  const directUrl = [
    item?.permalink_url,
    item?.post_permalink,
    item?.post_permalink_url,
    item?.post_url,
    metadata?.permalink_url,
    metadata?.post_permalink,
    metadata?.post_permalink_url,
    metadata?.post_url,
  ]
    .map((value) => normalizeExternalSocialUrl(value))
    .find(Boolean);
  if (directUrl) return directUrl;
  const platformPostId = [
    item?.platform_post_id,
    item?.post_id,
    item?.canonical_post_id,
    item?.conversation_post_id,
    item?.thread_post_id,
    metadata?.platform_post_id,
    metadata?.post_id,
  ]
    .map((value) => clean(value))
    .find(Boolean);
  if (platform.includes("facebook")) {
    return buildFacebookPostUrlFromId(platformPostId);
  }
  return "";
};

const buildSocialCommentsCenterUrl = (item = {}, tenantId = "") => {
  const params = new URLSearchParams();
  const postId = clean(item?.post_link_key || item?.postLinkKey || item?.post_id || item?.conversation_post_id || item?.thread_post_id || item?.conversation_id || item?.id || "");
  const commentId = clean(item?.comment_id || item?.external_comment_id || item?.provider_comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || "");
  const platform = clean(item?.platform || item?.source_platform || item?.channel || item?.source || "");
  const pageId = clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || "");

  if (postId) params.set("postId", postId);
  if (commentId) params.set("commentId", commentId);
  if (platform) params.set("platform", platform);
  if (clean(tenantId)) params.set("tenant", clean(tenantId));
  if (pageId) params.set("pageId", pageId);
  return `/marketing/social-comments${params.toString() ? `?${params.toString()}` : ""}`;
};
const getConversationDisplayName = (conversation = {}) => {
  const source = conversation || {};
  if (isMessengerConversation(source)) {
    const channelMetadata = source.channel_metadata || {};
    const metadata = source.metadata || {};
    return messengerDisplayName(source) || customerIdentifier(
      source.external_customer_id,
      source.phone,
      source.customer_phone,
      source.customer_profile?.external_customer_id,
      source.customer_profile?.phone,
      channelMetadata.psid,
      channelMetadata.sender_id,
      channelMetadata.customer_id,
      metadata.psid,
      metadata.sender_id,
      metadata.customer_id,
    ) || "Customer";
  }

  const profile = source.customer_profile || {};
  const channelMetadata = source.channel_metadata || {};
  const metadata = source.metadata || {};
  const memory = channelMetadata.ai_memory || metadata.ai_memory || {};
  const fullName = [source.first_name || profile.first_name, source.last_name || profile.last_name].map(clean).filter(Boolean).join(" ");
  return firstUsefulCustomerName(
    source.customer_name,
    source.channel_metadata?.commenter_name,
    source.metadata?.commenter_name,
    fullName,
    source.customer?.name,
    profile.name,
    profile.full_name,
    profile.display_name,
    profile.contact_name,
    channelMetadata.customer_name,
    channelMetadata.contact_name,
    memory.customer_name,
  ) || firstNonEmpty(
    source.external_customer_id,
    source.phone,
    source.customer_phone,
    profile.external_customer_id,
    profile.phone,
    channelMetadata.phone,
    channelMetadata.customer_phone,
    channelMetadata.resolved_phone,
    channelMetadata.remote_jid,
    metadata.phone,
    metadata.customer_phone,
    metadata.resolved_phone,
    metadata.remote_jid,
  ) || customerIdentifier(source.external_customer_id, source.phone, source.customer_phone, profile.external_customer_id, profile.phone, channelMetadata.phone, channelMetadata.customer_phone, channelMetadata.resolved_phone, channelMetadata.remote_jid, metadata.phone, metadata.customer_phone, metadata.resolved_phone, metadata.remote_jid, source.session_id, source.conversation_id, source.conversation_key);
};
const customerDisplayName = (item = {}) => getConversationDisplayName(item);
const isRtlText = (value = "") => /[\u0600-\u06ff]/.test(String(value || ""));
const needsHumanAttention = (conversation = {}) =>
  conversation?.human_takeover === true ||
  conversation?.ai_paused === true ||
  conversation?.conversation_status === "human_takeover" ||
  Boolean(clean(conversation?.escalation_reason || conversation?.ai_escalation_reason)) ||
  conversation?.needs_human_support === true;
const messageIdentityKeys = (message = {}) =>
  [
    clean(message.message_identity_key || message.messageIdentityKey || ""),
    clean(message.client_request_id || message.clientRequestId || ""),
    clean(message.idempotency_key || message.idempotencyKey || ""),
    clean(message.dedupe_key || message.dedupeKey || ""),
    clean(message.provider_message_id || message.providerMessageId || ""),
    clean(message.external_message_id || message.externalMessageId || ""),
    clean(message.id || ""),
  ].filter(Boolean);

const messageKey = (message = {}) =>
  String(
    message.message_identity_key ||
      message.messageIdentityKey ||
      message.provider_message_id ||
      message.providerMessageId ||
      message.external_message_id ||
      message.externalMessageId ||
      message.id ||
      `${message.sender_type || ""}:${message.created_at || ""}:${message.customer_message || message.ai_answer || message.staff_message || ""}`
  );

const isFromMeMessage = (message = {}) =>
  message?.from_me === true ||
  message?.fromMe === true ||
  message?.is_from_me === true;

const normalizeTranscriptMessage = (message = {}) => {
  const fromMe = isFromMeMessage(message);
  const senderType = clean(message.sender_type || message.senderType || "").toLowerCase();
  const explicitDirection = clean(message.direction || message.message_direction || "").toLowerCase();
  const direction = fromMe
    ? "outbound"
    : ["inbound", "incoming", "customer", "user", "client"].includes(explicitDirection)
      ? "inbound"
      : ["outbound", "sent", "assistant", "ai", "bot", "staff", "agent"].includes(explicitDirection)
        ? "outbound"
        : ["customer", "user", "client"].includes(senderType)
          ? "inbound"
          : ["assistant", "ai", "bot", "staff", "agent"].includes(senderType)
            ? "outbound"
            : "";
  const body = clean(
    message.customer_message ||
      message.ai_answer ||
      message.staff_message ||
      message.message_text ||
      message.text ||
      message.body ||
      message.content ||
      message.reply_text ||
      message.caption ||
      ""
  );
  const normalizedSenderType = senderType || (fromMe || direction === "outbound" ? "assistant" : "customer");
  const isStaffSender = ["staff", "agent", "human"].includes(normalizedSenderType);
  const resolvedFromMe = fromMe || direction === "outbound";
  return {
    ...message,
    from_me: resolvedFromMe,
    fromMe: resolvedFromMe,
    direction: direction || message.direction || message.message_direction || "",
    sender_type: normalizedSenderType,
    senderType: normalizedSenderType,
    customer_message: clean(resolvedFromMe ? "" : message.customer_message || (direction === "inbound" ? body : "")),
    ai_answer: clean(message.ai_answer || ((!isStaffSender && resolvedFromMe) ? body : "")),
    staff_message: clean(message.staff_message || (normalizedSenderType === "staff" ? body : "")),
    message_text: clean(message.message_text || body),
    text: clean(message.text || body),
    body: clean(message.body || body),
    content: clean(message.content || body),
  };
};

// Freshness window for focus/visibility-triggered list revalidation. Within
// this window a tab regaining visibility keeps showing current data instead of
// refetching. Manual refresh and socket reconnect are NOT gated by it.
const VISIBILITY_FRESH_MS = 20000;

const mergeMessagesByIdentity = (messages = []) => {
  const merged = [];
  const identityIndexes = new Map();
  for (const raw of asArray(messages)) {
    const message = raw && typeof raw === "object" ? raw : {};
    const keys = messageIdentityKeys(message);
    const existingIndex = keys.reduce((found, key) => found ?? identityIndexes.get(key), undefined);
    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], ...message };
      messageIdentityKeys(merged[existingIndex]).forEach((key) => identityIndexes.set(key, existingIndex));
    } else {
      const nextIndex = merged.push(message) - 1;
      keys.forEach((key) => identityIndexes.set(key, nextIndex));
    }
  }
  return merged;
};

const uniqueMessages = (messages = []) => mergeMessagesByIdentity(messages);
const latestCustomerText = (messages = []) =>
  [...uniqueMessages(messages)].reverse().find((message) => clean(message.customer_message))?.customer_message || "";
const displayFallback = (value, fallback = "Not set yet") => (clean(value) || fallback);
const productImage = (product = {}) =>
  clean(
    product.matched_variant_image ||
    product.matched_image_url ||
    product.selected_card_image_url ||
    product.image_url ||
    product.image ||
    product.thumbnail ||
    product.photo_url
  );
const productScore = (product = {}) => Number(product.score || product.match_score || product.confidence || product.rank_score || 0);
const productSource = (product = {}) => clean(product.source || product.origin || product.match_source || product.recommendation_source || "AI match");
const productVariantLabel = (product = {}) =>
  [product.size, product.color].filter(Boolean).join(" / ") ||
  product.variant_name ||
  product.sku ||
  "No variant details";
const productReason = (product = {}) =>
  clean(product.reason || product.match_reason || product.explanation || product.ai_reason || product.note || "");

function LinkifiedText({ text = "", className = "" }) {
  const value = String(text || "");
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p dir={isRtlText(value) ? "rtl" : "auto"} className={`whitespace-pre-wrap break-words text-sm leading-7 text-slate-100 ${className}`}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        return (
          <a
            key={`${index}-${part}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="font-black text-cyan-100 underline decoration-cyan-300/50 underline-offset-4 hover:text-cyan-50"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}

function usePageVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function Pill({ children, tone = "zinc", className = "" }) {
  const classes = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    zinc: "border-white/10 bg-white/[0.055] text-slate-200",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${classes[tone] || classes.zinc} ${className}`}>{children}</span>;
}

function LeadBadge({ type = "Cold Lead", score = 0 }) {
  const meta = leadMeta[type] || leadMeta["Cold Lead"];
  const Icon = meta.icon;
  return (
    <Pill tone={meta.tone}>
      <Icon className="h-3.5 w-3.5" />
      {type}
      <span className="opacity-70">{Number(score || 0)}</span>
    </Pill>
  );
}

const normalizeCommentAutomationStatus = (value = "") => {
  const key = clean(value).toLowerCase();
  if (["sent", "failed", "skipped", "pending", "partial", "completed"].includes(key)) return key;
  return "skipped";
};

const commentAutomationBadgeTone = (value = "") => {
  const status = normalizeCommentAutomationStatus(value);
  if (status === "sent" || status === "completed") return "emerald";
  if (status === "failed" || status === "partial") return "rose";
  if (status === "pending") return "amber";
  return "zinc";
};

const commentAutomationStatusLabel = (value = "") => {
  const status = normalizeCommentAutomationStatus(value);
  if (status === "sent") return "sent";
  if (status === "failed") return "failed";
  if (status === "pending") return "pending";
  if (status === "partial") return "partial";
  if (status === "completed") return "completed";
  return "skipped";
};

function CommentAutomationBadges({ automationState = {} }) {
  const state = automationState && typeof automationState === "object" ? automationState : {};
  const badges = [
    { key: "like_status", label: "Like" },
    { key: "public_reply_status", label: "Public reply" },
    { key: "dm_status", label: "Private message" },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {badges.map((item) => {
        const status = commentAutomationStatusLabel(state[item.key]);
        return (
          <Pill key={item.key} tone={commentAutomationBadgeTone(status)}>
            {item.label}
            <span className="opacity-70">{status}</span>
          </Pill>
        );
      })}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-400">
        {Icon ? <Icon className="h-4 w-4" /> : null}
        {title}
      </div>
      {action}
    </div>
  );
}

function VisualAttachmentsPreview({ attachments = [] }) {
  const visualAttachments = asArray(attachments).filter(Boolean);
  if (!visualAttachments.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {visualAttachments.map((attachment, index) => {
        if (attachment?.type === "size_guide") {
          const sizes = asArray(attachment.sizes).filter(Boolean);
          if (!sizes.length) return null;
          return (
            <div key={`${attachment.type}-${index}`} className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-3">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-cyan-100">{attachment.title || "Size guide"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sizes.map((size) => <span key={size} className="rounded-full bg-white/[0.09] px-2 py-1 text-xs font-black text-slate-100">{size}</span>)}
              </div>
              {attachment.note ? <p className="mt-2 text-xs leading-5 text-slate-400">{attachment.note}</p> : null}
            </div>
          );
        }

        const items = asArray(attachment?.items).filter((item) => item?.image_url);
        if (!items.length) return null;
        return (
          <div key={`${attachment?.type || "visual"}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{attachment?.title || "Visual attachments"}</div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {items.slice(0, 10).map((item, itemIndex) => (
                <a key={`${item.id || item.product_id || itemIndex}`} href={storefrontProductUrl(item)} className="min-w-[7.5rem] max-w-[7.5rem] rounded-xl border border-white/10 bg-slate-950 p-2 transition hover:border-cyan-300/30">
                  <img src={item.image_url} alt={item.title || "Visual attachment"} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                  <div className="mt-1 truncate text-xs font-black text-white">{item.title || "منتج"}</div>
                  {item.subtitle ? <div className="truncate text-[11px] text-slate-500">{item.subtitle}</div> : null}
                  {Number(item.price || 0) > 0 ? <div className="mt-0.5 text-[11px] font-bold text-emerald-100">{money(item.price)}</div> : null}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProductCards({ products = [] }) {
  const items = asArray(products).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.slice(0, 4).map((product, index) => {
        const image = product.matched_variant_image || product.matched_image_url || product.selected_card_image_url || product.image_url || product.image;
        return (
          <a key={product.id || index} href={storefrontProductUrl(product)} className="flex min-w-0 gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2 transition hover:border-cyan-300/30">
            {image ? <img src={image} alt={product.name || "منتج"} className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-white/[0.055]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-white">{product.name || product.title || "منتج"}</span>
              <span className="mt-1 block text-xs text-slate-500">{product.availability || product.stock_status || "availability"}</span>
              {Number(product.price || product.final_price || product.sale_price || 0) > 0 ? <span className="mt-1 block text-xs font-black text-emerald-100">{money(product.final_price || product.price || product.sale_price)}</span> : null}
            </span>
          </a>
        );
      })}
    </div>
  );
}

const ConversationListItem = memo(function ConversationListItem({ item, active, unseen, onSelect, onOpenCustomer360, onToggleFavorite }) {
  const channel = item.channel || item.source || "web_chat";
  const liveMeta = item.is_live_meta === true || isMetaChannel(channel);
  const isSocialComment = isSocialCommentThread(item);
  const inboxKind = getInboxItemKind(item);
  const isCommentThread = isCommentConversation(item) || isSocialComment;
  const sourceLabel = getConversationSourceLabel(item);
  const SourceIcon = getConversationSourceIcon(item);
  const customerName = isCommentThread
    ? commentThreadCommenterName(item)
    : isMessengerConversation(item)
      ? messengerDisplayName(item)
      : getConversationDisplayName(item);
  const avatarUrl = isCommentThread ? commentThreadCustomerAvatarUrl(item) : customerAvatarUrl(item);
  const postImageUrl = isCommentThread ? commentThreadPostImageUrl(item) : "";
  const postTitle = isCommentThread ? commentThreadDisplayName(item) : "";
  const commentCount = isCommentThread ? commentThreadCommentCount(item) : 0;
  const lastComment = isCommentThread ? commentThreadLastComment(item) : "";
  const lastActivity = relativeTime(item.last_message_at || item.last_activity_at || item.updated_at);
  const postTime = isCommentThread ? commentThreadPostTime(item) : "";
  const unreadCount = Number(item.unread_count || item.unread || 0);
  const isFavorite = item.is_favorite === true || clean(item.is_favorite).toLowerCase() === "true";
  const containerTone =
    active
      ? "border-cyan-300/50 bg-cyan-300/12 shadow-[0_10px_30px_rgba(34,211,238,0.12)]"
      : unreadCount || unseen || liveMeta
        ? "border-white/10 bg-slate-950/80 hover:border-cyan-300/25 hover:bg-white/[0.045]"
        : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-white/[0.045]";
  return (
    <div
      role="button"
      tabIndex={0}
      dir="ltr"
      data-ai-inbox-conversation-direction="ltr"
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${containerTone}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(item, {
                  customerId: customer360Identifier(item),
                  source: "conversation_list",
                  platform: channel,
                });
              }}
              className="overflow-hidden rounded-2xl ring-1 ring-white/10 transition hover:ring-cyan-300/40"
              aria-label={`Open customer details for ${customerName || "customer"}`}
            >
              <div className="relative h-11 w-11 overflow-hidden rounded-2xl">
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                {isCommentThread ? (
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-transparent to-black/25" />
                ) : null}
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(item, {
                  customerId: customer360Identifier(item),
                  source: "conversation_list",
                  platform: channel,
                });
              }}
              className={`grid h-11 w-11 place-items-center rounded-2xl transition ${liveMeta ? "bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/20" : "bg-white/[0.07] text-slate-200 hover:bg-white/[0.1]"}`}
              aria-label={`Open customer details for ${customerName || "customer"}`}
            >
              <User className="h-5 w-5" />
            </button>
          )}
          {unreadCount ? <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-rose-500" aria-hidden="true" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {inboxKind === "comment" ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCustomer360?.(item, {
                        customerId: customer360Identifier(item),
                        source: "conversation_list",
                        platform: channel,
                      });
                    }}
                    dir="auto"
                    className="line-clamp-1 text-left text-[15px] font-black leading-5 text-white hover:underline"
                  >
                    {customerName}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={isSocialComment ? "blue" : isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>
                      <span className="inline-flex items-center gap-1">
                        <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-200" : liveMeta ? "text-cyan-200" : "text-slate-500"}`} />
                        {sourceLabel}
                      </span>
                    </Pill>
                    <Pill tone="blue">{commentCount ? `${commentCount} تعليق` : "تعليق"}</Pill>
                    {needsHumanAttention(item) ? <Pill tone="amber">Needs Human</Pill> : null}
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCustomer360?.(item, {
                        customerId: customer360Identifier(item),
                        source: "conversation_list",
                        platform: channel,
                      });
                    }}
                    dir="auto"
                    className="line-clamp-2 text-left text-[15px] font-black leading-5 text-white hover:underline"
                  >
                    {customerName}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={isSocialComment ? "blue" : isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>
                      <span className="inline-flex items-center gap-1">
                        <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-200" : liveMeta ? "text-cyan-200" : "text-slate-500"}`} />
                        {sourceLabel}
                      </span>
                    </Pill>
                  </div>
                </>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite?.(item);
                }}
                className="inline-flex h-5 items-center justify-center rounded-md px-1 text-slate-500 transition hover:text-amber-300 hover:bg-white/10"
                aria-label={isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
              >
                <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current text-amber-300" : "text-slate-500"}`} />
              </button>
              <span className="text-[11px] font-bold text-slate-500">{lastActivity}</span>
            </div>
          </div>
          {isCommentThread ? (
            <div className="mt-2 flex gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
              {postImageUrl ? <img src={postImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-cover ring-1 ring-white/10" loading="lazy" /> : null}
              <div className="min-w-0 flex-1 space-y-1.5">
                {postTitle ? <div className="line-clamp-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{postTitle}</div> : null}
                {lastComment ? <div dir="auto" className="line-clamp-2 text-left text-[12.5px] font-medium leading-4.5 text-slate-200">{lastComment}</div> : null}
              </div>
            </div>
          ) : (
            <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unreadCount ? "text-slate-700" : "text-slate-500"}`}>
              <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unreadCount && !active ? "text-emerald-600" : ""}`} />
              <span dir="auto" className={`line-clamp-2 text-left ${unreadCount && !active ? "font-medium" : ""}`}>{conversationPreview(item) || "No messages yet"}</span>
            </div>
          )}
          {unreadCount ? <div className="mt-2 flex justify-end"><span className="inline-flex h-5 items-center rounded-full bg-rose-400/12 px-2 text-[10px] font-black text-rose-100">غير مقروء {unreadCount}</span></div> : null}
        </div>
      </div>
    </div>
  );
});

function InboxChannelSidebar({
  channels = [],
  allUnread = 0,
  activeChannel = "all",
  onSelectChannel,
  socialCommentsCount = 0,
  socialCommentsActive = false,
  onSelectSocialComments,
}) {
  const channelIcon = (key, active = false) => {
    const baseIconClass = "h-6 w-6";
    const iconClass = active ? "drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]" : "";
    const commentBaseClass = `relative inline-flex h-7 w-7 items-center justify-center ${iconClass}`;
    const commentGlyphClass = `h-7 w-7 ${active ? "text-white" : "text-white/90"}`;
    const commentBadgeClass = `absolute -right-0.5 -bottom-0.5 h-[15px] w-[15px] ${active ? "drop-shadow-[0_0_8px_rgba(34,211,238,0.35)]" : ""}`;

    if (key === "all") {
      return <MessageSquareText className={`${baseIconClass} ${iconClass}`} />;
    }
    if (key === "whatsapp") {
      return <FaWhatsapp className={`${baseIconClass} ${active ? "text-emerald-300" : "text-emerald-300/85"} ${iconClass}`} aria-hidden="true" />;
    }
    if (key === "messenger") {
      return <FaFacebookMessenger className={`${baseIconClass} ${active ? "text-sky-300" : "text-sky-300/90"} ${iconClass}`} aria-hidden="true" />;
    }
    if (key === "instagram") {
      return <FaInstagram className={`${baseIconClass} ${active ? "text-pink-300" : "text-pink-300/90"} ${iconClass}`} aria-hidden="true" />;
    }
    if (key === "facebook") {
      return <FaFacebookF className={`${baseIconClass} ${active ? "text-blue-300" : "text-blue-300/90"} ${iconClass}`} aria-hidden="true" />;
    }
    if (key === "facebook_comment") {
      return (
        <span className={commentBaseClass} aria-hidden="true">
          <MessageSquareText className={`${commentGlyphClass} ${active ? "text-blue-100" : "text-blue-100/90"}`} />
          <FaFacebookF className={`${commentBadgeClass} ${active ? "text-blue-300" : "text-blue-300/90"}`} />
        </span>
      );
    }
    if (key === "instagram_comment") {
      return (
        <span className={commentBaseClass} aria-hidden="true">
          <MessageSquareText className={`${commentGlyphClass} ${active ? "text-pink-100" : "text-pink-100/90"}`} />
          <FaInstagram className={`${commentBadgeClass} ${active ? "text-pink-300" : "text-pink-300/90"}`} />
        </span>
      );
    }
    if (key === "web") {
      return <MessageSquareText className={`${baseIconClass} ${active ? "text-slate-100" : "text-slate-300"} ${iconClass}`} aria-hidden="true" />;
    }
    return (
      <MessageSquareText className={`${baseIconClass} ${active ? "text-slate-100" : "text-slate-300"} ${iconClass}`} aria-hidden="true" />
    );
  };

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center rounded-3xl border border-white/10 bg-white/[0.04] px-2 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={() => onSelectChannel("all")}
        className={`relative mb-2 flex h-[58px] w-12 items-center justify-center text-center transition ${
          !socialCommentsActive && activeChannel === "all" ? "text-cyan-100 drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]" : "text-white/80 hover:text-white"
        }`}
      >
        {Number(allUnread || 0) > 0 ? (
          <span dir="ltr" className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow-[0_8px_18px_rgba(244,63,94,0.35)]">
            {allUnread}
          </span>
        ) : null}
        {channelIcon("all", !socialCommentsActive && activeChannel === "all")}
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            onClick={() => onSelectChannel(channel.key)}
            title={channelBadgeLabel(channel.key)}
            className={`relative flex h-[58px] w-12 items-center justify-center text-center transition ${
              !socialCommentsActive && activeChannel === channel.key ? "text-cyan-100 drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]" : "text-white/80 hover:text-white"
            }`}
          >
            {Number(channel.unread || 0) > 0 ? (
              <span dir="ltr" className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow-[0_8px_18px_rgba(244,63,94,0.35)]">
                {channel.unread}
              </span>
            ) : null}
            {channelIcon(channel.key, !socialCommentsActive && activeChannel === channel.key)}
          </button>
        ))}
      </div>
      {onSelectSocialComments ? (
        <div className="mt-2 border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={onSelectSocialComments}
            title="Social Comments"
            aria-label="Social Comments"
            aria-pressed={socialCommentsActive}
            className={`relative flex h-[58px] w-12 items-center justify-center text-center transition ${
              socialCommentsActive
                ? "text-amber-200 drop-shadow-[0_0_12px_rgba(212,175,55,0.4)]"
                : "text-amber-200/80 hover:text-amber-100"
            }`}
          >
            {Number(socialCommentsCount || 0) > 0 ? (
              <span dir="ltr" className="absolute right-0 top-0 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black leading-[18px] text-slate-950 shadow-[0_8px_18px_rgba(212,175,55,0.28)]">
                {socialCommentsCount}
              </span>
            ) : null}
            <MessageSquareText className="h-7 w-7" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </aside>
  );
}

const InboxConversationCard = memo(function InboxConversationCard({ item, active, unseen, onSelect, onOpenCustomer360, onToggleFavorite }) {
  const channel = item.channel || item.source || "web_chat";
  const liveMeta = item.is_live_meta === true || isMetaChannel(channel);
  const isSocialComment = isSocialCommentThread(item);
  const inboxKind = getInboxItemKind(item);
  const sourceLabel = getConversationSourceLabel(item);
  const SourceIcon = getConversationSourceIcon(item);
  const customerName = inboxKind === "comment" ? commentThreadCommenterName(item) : getConversationDisplayName(item) || "Customer";
  const avatarUrl = customerAvatarUrl(item);
  const commentCount = commentThreadCommentCount(item);
  const postTitle = commentThreadDisplayName(item);
  const commentPreview = commentThreadLastComment(item) || "No comments yet";
  const unreadCount = Number(item.unread_count || item.unread || 0);
  const isFavorite = item.is_favorite === true || clean(item.is_favorite).toLowerCase() === "true";
  const containerTone = active
    ? "border-cyan-300/50 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_18px_45px_rgba(8,145,178,0.16)]"
    : unreadCount || unseen || liveMeta
      ? "border-white/10 bg-slate-950/80 hover:border-cyan-300/25 hover:bg-white/[0.045]"
      : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-white/[0.045]";
  return (
    <div
      role="button"
      tabIndex={0}
      dir="ltr"
      data-ai-inbox-conversation-direction="ltr"
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition duration-200 ${containerTone}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(item, {
                  customerId: customer360Identifier(item),
                  source: "inbox_conversation",
                  platform: channel,
                });
              }}
              className="overflow-hidden rounded-2xl ring-1 ring-white/10 transition hover:ring-cyan-300/40"
              aria-label={`Open customer details for ${customerName || "customer"}`}
            >
              <img src={avatarUrl} alt="" className="h-11 w-11 rounded-2xl object-cover" loading="lazy" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(item, {
                  customerId: customer360Identifier(item),
                  source: "inbox_conversation",
                  platform: channel,
                });
              }}
              className={`grid h-11 w-11 place-items-center rounded-2xl transition ${liveMeta ? "bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/20" : "bg-white/[0.07] text-slate-200 hover:bg-white/[0.1]"}`}
              aria-label={`Open customer details for ${customerName || "customer"}`}
            >
              <User className="h-5 w-5" />
            </button>
          )}
          {unreadCount ? <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-rose-500" aria-hidden="true" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {inboxKind === "comment" ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCustomer360?.(item, {
                      customerId: customer360Identifier(item),
                        source: "inbox_conversation",
                        platform: channel,
                      });
                    }}
                    dir="auto"
                    className="line-clamp-1 text-left text-[14px] font-black leading-5 text-white hover:underline"
                  >
                    {customerName}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={isSocialComment ? "blue" : isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>
                      <span className="inline-flex items-center gap-1">
                        <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-200" : liveMeta ? "text-cyan-200" : "text-slate-500"}`} />
                        {sourceLabel}
                      </span>
                    </Pill>
                    <Pill tone="blue">{commentCount ? `${commentCount} تعليق` : "تعليق"}</Pill>
                    {needsHumanAttention(item) ? <Pill tone="amber">Needs Human</Pill> : null}
                  </div>
                </>
              ) : (
                <>
                  <div dir="auto" className="truncate text-left text-[14px] font-black leading-5 text-white">{customerName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={isSocialComment ? "blue" : isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>
                      <span className="inline-flex items-center gap-1">
                        <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-200" : liveMeta ? "text-cyan-200" : "text-slate-500"}`} />
                        {sourceLabel}
                      </span>
                    </Pill>
                  </div>
                </>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite?.(item);
                }}
                className="inline-flex h-5 items-center justify-center rounded-md px-1 text-slate-500 transition hover:text-amber-300 hover:bg-white/10"
                aria-label={isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
              >
                <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current text-amber-300" : "text-slate-500"}`} />
              </button>
              <span className="text-[11px] font-bold text-slate-500">{relativeTime(item.last_message_at || item.last_activity_at || item.updated_at)}</span>
            </div>
          </div>
              {inboxKind === "comment" ? (
            <div className="mt-2 space-y-1.5 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
              {postTitle ? <div className="line-clamp-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{postTitle}</div> : null}
              <div dir="auto" className="line-clamp-2 text-left text-[12.5px] font-medium leading-4.5 text-slate-200">{commentPreview}</div>
            </div>
          ) : (
            <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unreadCount ? "text-slate-700" : "text-slate-500"}`}>
              <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unreadCount && !active ? "text-emerald-600" : ""}`} />
              <span dir="auto" className={`line-clamp-2 text-left ${unreadCount && !active ? "font-medium" : ""}`}>{conversationPreview(item) || "No messages yet"}</span>
            </div>
          )}
          {unreadCount ? <div className="mt-2 flex justify-end"><span className="inline-flex h-5 items-center rounded-full bg-rose-400/12 px-2 text-[10px] font-black text-rose-100">Unread {unreadCount}</span></div> : null}
        </div>
      </div>
    </div>
  );
});

function ConversationLabelsModal({ open, labels = [], saving = false, onClose, onSave }) {
  const [query, setQuery] = useState("");
  const [draftLabels, setDraftLabels] = useState([]);
  const [editingLabel, setEditingLabel] = useState(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEditingLabel(null);
    setDraftLabels(normalizeAiInboxConversationLabels(labels));
  }, [labels, open]);

  if (!open) return null;

  const normalizedQuery = clean(query).toLowerCase();
  const selectedIds = new Set(draftLabels.map((label) => label.id));
  const availableLabels = AI_INBOX_DEFAULT_LABELS.filter((label) => !selectedIds.has(label.id) && (!normalizedQuery || label.name.toLowerCase().includes(normalizedQuery)));
  const customCandidate = customAiInboxLabel(query);
  const canCreateCustom = Boolean(customCandidate && !selectedIds.has(customCandidate.id) && !AI_INBOX_DEFAULT_LABELS.some((label) => label.id === customCandidate.id));
  const addLabel = (label) => setDraftLabels((current) => normalizeAiInboxConversationLabels([...current, label]));
  const saveLabelEdit = () => {
    const nextName = clean(editingLabel?.name).slice(0, 40);
    if (!editingLabel?.id || !nextName) return;
    setDraftLabels((current) => normalizeAiInboxConversationLabels(current.map((label) => (
      label.id === editingLabel.id ? { ...label, name: nextName, color: editingLabel.color } : label
    ))));
    setEditingLabel(null);
  };

  return (
    <div className="fixed inset-0 z-[2147482600] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}>
      <section dir="rtl" role="dialog" aria-modal="true" aria-label="Conversation Labels" className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#20231f] text-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2"><Tag className="h-5 w-5 text-amber-300" /><div><h3 className="text-base font-black">Conversation Labels</h3><p className="text-[11px] text-slate-400">أضف أكثر من Label للعميل</p></div></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close labels" className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"><XCircle className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 p-5">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-amber-300/40">
            <Search className="h-4 w-4 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث أو اكتب Label جديد..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" autoFocus />
          </label>

          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Current labels ({draftLabels.length})</div>
            <div className="flex min-h-10 flex-wrap gap-2 rounded-xl border border-white/8 bg-black/15 p-2">
              {draftLabels.length ? draftLabels.map((label) => (
                <span key={label.id} className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black ${conversationLabelClass(label.color)}`}>
                  {label.name}
                  <button type="button" onClick={() => setEditingLabel({ ...label })} aria-label={`Edit ${label.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-black/20"><Pencil className="h-2.5 w-2.5" /></button>
                  <button type="button" onClick={() => setDraftLabels((current) => current.filter((item) => item.id !== label.id))} aria-label={`Remove ${label.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-black/20">×</button>
                </span>
              )) : <span className="px-1 py-1.5 text-xs text-slate-500">لا توجد Labels مختارة</span>}
            </div>
            {editingLabel ? (
              <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">Edit label</div>
                <input value={editingLabel.name} onChange={(event) => setEditingLabel((current) => ({ ...current, name: event.target.value }))} maxLength={40} aria-label="Label name" className="h-9 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm font-bold text-white outline-none focus:border-amber-300/40" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {Object.keys(CONVERSATION_LABEL_DOT_CLASSES).map((color) => (
                    <button key={color} type="button" onClick={() => setEditingLabel((current) => ({ ...current, color }))} aria-label={`Label color ${color}`} className={`grid h-7 w-7 place-items-center rounded-full border ${editingLabel.color === color ? "border-white bg-white/10" : "border-transparent"}`}><span className={`h-3 w-3 rounded-full ${conversationLabelDotClass(color)}`} /></button>
                  ))}
                  <div className="mr-auto flex gap-1.5">
                    <button type="button" onClick={() => setEditingLabel(null)} className="h-8 rounded-lg border border-white/10 px-3 text-[11px] font-bold text-slate-300">Cancel</button>
                    <button type="button" onClick={saveLabelEdit} disabled={!clean(editingLabel.name)} className="h-8 rounded-lg bg-amber-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-40">Save edit</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Available labels</div>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-black/15 p-1.5">
              {availableLabels.map((label) => (
                <button key={label.id} type="button" onClick={() => addLabel(label)} className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-right transition hover:bg-white/[0.07]">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${conversationLabelDotClass(label.color)}`} />
                  <span className="flex-1 text-sm font-bold text-slate-200">{label.name}</span>
                  <span className="text-lg text-slate-500">+</span>
                </button>
              ))}
              {canCreateCustom ? (
                <button type="button" onClick={() => { addLabel(customCandidate); setQuery(""); }} className="flex h-11 w-full items-center gap-3 rounded-lg border border-dashed border-amber-300/25 bg-amber-300/[0.06] px-2.5 text-right transition hover:bg-amber-300/10">
                  <Tag className="h-4 w-4 text-amber-300" /><span className="flex-1 text-sm font-black text-amber-100">إنشاء “{customCandidate.name}”</span><span className="text-lg text-amber-300">+</span>
                </button>
              ) : null}
              {!availableLabels.length && !canCreateCustom ? <div className="p-4 text-center text-xs text-slate-500">لا توجد Labels أخرى</div> : null}
            </div>
          </div>
        </div>

        <footer className="border-t border-white/10 p-4">
          <button type="button" onClick={async () => { const saved = await onSave?.(draftLabels); if (saved !== false) onClose?.(); }} disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-300 text-sm font-black text-slate-950 shadow-lg disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function InboxChatHeader({
  conversation,
  channelStatus = {},
  loading = false,
  labelsSaving = false,
  onLabelsChange,
  onBack,
  onToggleAi,
  showBack = false,
  isFullscreenConversation = false,
  onToggleFullscreen,
  onOpenTools,
  toolsOpen = false,
  onOpenCustomer360,
}) {
  const [labelsOpen, setLabelsOpen] = useState(false);
  const conversationLabels = useMemo(() => aiInboxLabelsFromConversation(conversation || {}), [conversation]);
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const avatarUrl = isCommentConversation(conversation) ? commentThreadCustomerAvatarUrl(conversation) : customerAvatarUrl(conversation);
  const name = isCommentConversation(conversation)
    ? commentThreadCommenterName(conversation)
    : isMessengerConversation(conversation)
      ? messengerDisplayName(conversation)
      : getConversationDisplayName(conversation);
  const channel = conversation.channel || conversation.source || "web_chat";
  const phone = customerIdentifier(
    conversation.phone,
    conversation.customer_phone,
    conversation.customer_profile?.phone,
    conversation.channel_metadata?.resolved_phone,
    conversation.external_customer_id
  );
  const channelKey = clean(channel).toLowerCase();
  const showCustomerIdentifier = Boolean(phone) && !["facebook", "messenger", "instagram"].some((provider) => channelKey.includes(provider));
  const isSocialComment = isSocialCommentThread(conversation);
  const sourceLabel = getConversationSourceLabel(conversation);
  const SourceIcon = getConversationSourceIcon(conversation);
  const conversationAiEnabled = isConversationAiEnabled(conversation);
  const aiTone = status === "human_takeover"
    ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
    : conversationAiEnabled
      ? "bg-emerald-300 text-slate-950"
      : "border border-rose-300/20 bg-rose-400/10 text-rose-100";
  return (
    <>
    <div dir="ltr" data-ai-inbox-compact-contact-header="true" className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div data-ai-inbox-contact-identity="left" className="flex min-w-0 items-center gap-2">
          {showBack ? (
            <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-100 md:hidden">
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {avatarUrl ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(conversation, {
                  customerId: customer360Identifier(conversation),
                  source: "inbox_header",
                  platform: channel,
                });
              }}
              className="overflow-hidden rounded-full ring-1 ring-white/10 transition hover:ring-cyan-300/40"
              aria-label={`Open customer details for ${name || "customer"}`}
            >
              <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenCustomer360?.(conversation, {
                  customerId: customer360Identifier(conversation),
                  source: "inbox_header",
                  platform: channel,
                });
              }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-slate-200 transition hover:bg-white/[0.1]"
              aria-label={`Open customer details for ${name || "customer"}`}
            >
              <User className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenCustomer360?.(conversation, {
                    customerId: customer360Identifier(conversation),
                    source: "inbox_header",
                    platform: channel,
                  });
                }}
                className="truncate text-left text-sm font-black leading-5 text-white hover:underline"
              >
                {name}
              </button>
              {conversationLabels.slice(0, 4).map((label) => (
                <span key={label.id} className={`inline-flex h-5 items-center rounded-md border px-1.5 text-[9px] font-black ${conversationLabelClass(label.color)}`}>{label.name}</span>
              ))}
              {conversationLabels.length > 4 ? <span className="text-[9px] font-black text-slate-400">+{conversationLabels.length - 4}</span> : null}
              <Pill tone={isSocialComment ? "blue" : isWhatsappChannel(channel) ? "emerald" : channel.includes("instagram") ? "rose" : channel.includes("messenger") ? "cyan" : "zinc"}>
                <span className="inline-flex items-center gap-1">
                  <SourceIcon className={`h-3 w-3 ${isSocialComment ? "text-blue-100" : channel.includes("instagram") ? "text-rose-100" : channel.includes("messenger") ? "text-cyan-100" : "text-slate-100"}`} />
                  {sourceLabel}
                </span>
              </Pill>
            </div>
            {showCustomerIdentifier ? <div dir="ltr" className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">{phone}</div> : null}
          </div>
        </div>
        <div data-ai-inbox-header-actions="right" className="flex flex-wrap items-center justify-end gap-1.5">
          <button type="button" onClick={() => setLabelsOpen(true)} disabled={loading || labelsSaving} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-400/10 px-2.5 text-[11px] font-black text-amber-100 transition hover:bg-amber-400/15 disabled:opacity-50">
            <Tag className="h-3.5 w-3.5" /> Add Label
          </button>
          {onOpenTools ? (
            <button
              type="button"
              onClick={() => onOpenTools()}
              disabled={loading}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition disabled:opacity-50 ${toolsOpen ? "border-amber-300/30 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/[0.06] text-slate-100 hover:border-amber-300/25"}`}
              aria-label={toolsOpen ? "إغلاق تفاصيل العميل" : "فتح تفاصيل العميل"}
              title={toolsOpen ? "إغلاق التفاصيل" : "تفاصيل العميل والأدوات"}
            >
              {toolsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              التفاصيل
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onToggleFullscreen?.()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.06] px-2.5 text-[11px] font-black text-slate-100 transition disabled:opacity-50"
            aria-label={isFullscreenConversation ? "Restore conversation layout" : "Expand conversation layout"}
            title={isFullscreenConversation ? "Restore conversation layout" : "Expand conversation layout"}
          >
            {isFullscreenConversation ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onToggleAi?.()}
            disabled={loading}
            className={`inline-flex h-8 items-center gap-1.5 rounded-2xl px-2.5 text-[11px] font-black transition disabled:opacity-50 ${aiTone}`}
          >
            <Bot className="h-3.5 w-3.5" />
            {status === "human_takeover" ? "Return to AI" : `AI ${conversationAiEnabled ? "ON" : "OFF"}`}
          </button>
        </div>
      </div>
    </div>
    <ConversationLabelsModal open={labelsOpen} labels={conversationLabels} saving={labelsSaving} onClose={() => setLabelsOpen(false)} onSave={onLabelsChange} />
    </>
  );
}

// Day separators for the chat transcript ("اليوم" / "أمس" / "12 ديسمبر 2026"), matching
// the portal chat. Styled for the AI Inbox dark theme so it stays consistent.
const transcriptDayKey = (value) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : "";
};
const transcriptDayLabel = (value) => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  const key = transcriptDayKey(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (key === transcriptDayKey(today)) return "اليوم";
  if (key === transcriptDayKey(yesterday)) return "أمس";
  try {
    return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
};
const transcriptRowTime = (row = {}) =>
  row.created_at || row.createdAt || row.timestamp || row.sent_at || row.message_created_at || row.created || row.time || "";

const Transcript = memo(function Transcript({
  conversation = null,
  rows = [],
  events = [],
  loadingOlder,
  onLoadOlder,
  onOpenCorrection,
  onReplyComment,
  onPrivateMessage,
  onReact,
  olderMessagesAvailable = false,
}) {
  const isCommentThread = isCommentConversation(conversation || {});
  const postUrl = commentConversationPostUrl(conversation || {});
  const postImage = commentThreadPostImageUrl(conversation || {});
  const postTitle = commentThreadDisplayName(conversation || {});
  const postTime = commentThreadPostTime(conversation || {});
  const commentCount = commentThreadCommentCount(conversation || {});
  if (!rows.length && !events.length && !isCommentThread) {
    return <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">No transcript yet.</div>;
  }

  return (
    <div className="space-y-3">
      <PinnedMessagesBar rows={rows} variant="desktop" />
      {olderMessagesAvailable ? (
        <div className="flex justify-center">
          <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[10px] font-black text-slate-300 disabled:opacity-50">
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            تحميل الرسائل الأقدم
          </button>
        </div>
      ) : null}
      {isCommentThread ? (
        <div className="sticky top-2 z-10 rounded-3xl border border-white/10 bg-slate-950/90 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="flex items-start gap-3">
            {postImage ? (
              <img src={postImage} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-400">
                <MessageSquareText className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">بوست التعليق</div>
              <div className="mt-1 line-clamp-2 text-[16px] font-black leading-6 text-white">{postTitle}</div>
              {postTime ? <div className="mt-1 text-[11px] font-medium text-slate-400">{postTime}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {postUrl ? (
                  <a href={postUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-[11px] font-black text-emerald-100">
                    <ExternalLink className="h-3.5 w-3.5" />
                    فتح البوست
                  </a>
                ) : null}
                <button type="button" onClick={() => onPrivateMessage?.(conversation)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
              </div>
              {commentCount ? <div className="mt-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-black text-slate-200">{commentCount} تعليق</div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const rowTime = transcriptRowTime(row);
        const rowKey = transcriptDayKey(rowTime);
        const prevKey = index > 0 ? transcriptDayKey(transcriptRowTime(rows[index - 1])) : "";
        const dayLabel = rowKey && rowKey !== prevKey ? transcriptDayLabel(rowTime) : "";
        return (
          <Fragment key={row.key}>
            {dayLabel ? (
              <div className="mx-auto my-1 w-max rounded-full border border-white/10 bg-slate-950/80 px-3 py-1 text-[11px] font-black text-slate-300 shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
                {dayLabel}
              </div>
            ) : null}
            <TranscriptMessage
              row={row}
              variant="desktop"
              onOpenCorrection={onOpenCorrection}
              onReplyComment={onReplyComment}
              onPrivateMessage={onPrivateMessage}
              onReact={onReact}
              channelLabel={row.channelLabel}
            />
          </Fragment>
        );
      })}
      {events.length ? (
        <div className="space-y-2">
          {events.map((event, index) => (
            <div key={`${event.type}-${event.order_id || index}`} className="mx-auto w-max max-w-full rounded-full border border-white/10 bg-slate-950 px-3 py-1.5 text-[11px] font-black text-slate-300">
              {event.label || event.type} / {absoluteTime(event.created_at)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function ConversationActions({ conversation, channelStatus = {}, loading, assignName, onAssignNameChange, onAction }) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const assigned = conversation.assigned_user?.name || conversation.assigned_user_name || "Unassigned";
  const whatsappAiActive = isWhatsappChannel(conversation.channel || conversation.source) && status === "ai_active";
  const liveChannel = channelStatus.live_operational === true || channelStatus.effective_enabled === true || channelStatus.messaging_active === true;
  const tokenActive = Boolean(channelStatus.token_valid || channelStatus.page_access_token_configured);
  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-slate-950/65 p-2.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Pill tone={status === "human_takeover" ? "amber" : status === "closed" ? "rose" : "emerald"}>
            {status === "human_takeover" ? <PauseCircle className="h-3 w-3" /> : status === "closed" ? <LockKeyhole className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            {status === "human_takeover" ? "الموظف مسيطر — اقتراحات AI متوقفة" : status === "closed" ? "Closed" : "AI active"}
          </Pill>
          <Pill tone={liveChannel ? "emerald" : "amber"}>
            <Radio className="h-3 w-3" />
            {liveChannel ? "Live channel" : "Channel standby"}
          </Pill>
          <Pill tone={tokenActive ? "emerald" : "rose"}>
            {tokenActive ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {tokenActive ? "Token ready" : "Token issue"}
          </Pill>
          {whatsappAiActive ? <Pill tone="cyan"><Bot className="h-3 w-3" />ذكاء واتساب نشط</Pill> : null}
          <Pill tone="zinc"><UserCheck className="h-3 w-3" />{assigned}</Pill>
        </div>
        <details className="group relative ml-auto">
          <summary className="list-none cursor-pointer">
            <button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-[11px] font-black text-white">
              Actions
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
            </button>
          </summary>
          <div className="absolute right-0 z-10 mt-2 w-[220px] rounded-2xl border border-white/10 bg-slate-950/98 p-2 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-2 rounded-xl border border-white/10 bg-white/[0.035] p-2">
              <input value={assignName} onChange={(event) => onAssignNameChange(event.target.value)} placeholder="Assign to employee / admin" disabled={loading || status === "closed"} className="h-8 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 disabled:opacity-50" />
            </div>
            <div className="flex flex-col gap-1.5">
              {status === "closed" ? (
                <button type="button" onClick={() => onAction("reopen")} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2.5 text-[11px] font-black text-cyan-100 disabled:opacity-50">
                  <PlayCircle className="h-3.5 w-3.5" />
                  Reopen
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => onAction("takeover")} disabled={loading || status === "human_takeover"} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 text-[11px] font-black text-amber-100 disabled:opacity-50">
                    <Handshake className="h-3.5 w-3.5" />
                    Take over
                  </button>
                  <button type="button" onClick={() => onAction("return")} disabled={loading || status !== "human_takeover"} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2.5 text-[11px] font-black text-cyan-100 disabled:opacity-50">
                    <PlayCircle className="h-3.5 w-3.5" />
                    Return to AI
                  </button>
                  <button type="button" onClick={() => onAction("close")} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-300/20 bg-rose-400/10 px-2.5 text-[11px] font-black text-rose-100 disabled:opacity-50">
                    <LockKeyhole className="h-3.5 w-3.5" />
                    Close
                  </button>
                </>
              )}
              <button type="button" onClick={() => onAction("assign")} disabled={loading || status === "closed" || !clean(assignName)} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.07] px-2.5 text-[11px] font-black text-white disabled:opacity-50">
                <UserPlus className="h-3.5 w-3.5" />
                Assign
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function LeadQuickActionsBar({
  conversation,
  employees = [],
  selectedEmployeeId = "",
  onSelectedEmployeeIdChange,
  onCreateOpportunity,
  onSendPrivateMessage,
  onSendCommentReply,
  onAssignEmployee,
  busy = false,
}) {
  if (!conversation || !isLeadThreadConversation(conversation)) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const isClosed = status === "closed";
  const isComment = isCommentConversation(conversation);
  const postUrl = commentConversationPostUrl(conversation);
  const employeeOptions = asArray(employees).map((employee) => ({
    value: String(employee.id),
    label: employee.full_name || employee.name || `Employee ${employee.id}`,
  }));

  return (
    <details className="group mb-1.5 shrink-0 rounded-2xl border border-white/10 bg-slate-950/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <ShoppingBag className="h-4 w-4 text-amber-300" />
          أدوات البيع وخدمة العميل
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <span>رسالة خاصة، فرصة بيع، تعيين موظف</span>
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
        </div>
      </summary>
      <div className="border-t border-white/10 p-2">
        <div className="flex flex-col gap-1.5">
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {isComment ? (
            <button type="button" onClick={onSendCommentReply} disabled={busy || isClosed} className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-2.5 text-[11px] font-black text-violet-100 disabled:opacity-50">
              <MessageSquareText className="h-3.5 w-3.5" />
              رد على التعليق
            </button>
          ) : null}
          <button type="button" onClick={onSendPrivateMessage} disabled={busy || isClosed} className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2.5 text-[11px] font-black text-cyan-100 disabled:opacity-50">
            <MessageSquareText className="h-3.5 w-3.5" />
            إرسال رسالة خاصة
          </button>
          {isComment && postUrl ? (
            <a href={postUrl} target="_blank" rel="noreferrer" className={`inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2.5 text-[11px] font-black text-emerald-100 ${busy || isClosed ? "pointer-events-none opacity-50" : ""}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              فتح البوست
            </a>
          ) : null}
          <button type="button" onClick={onCreateOpportunity} disabled={busy || isClosed} className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 text-[11px] font-black text-amber-100 disabled:opacity-50">
            <ArrowUpRight className="h-3.5 w-3.5" />
            إنشاء فرصة بيع
          </button>
        </div>
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.035] p-1.5 sm:flex-row sm:items-center">
          <select
            value={selectedEmployeeId}
            onChange={(event) => onSelectedEmployeeIdChange?.(event.target.value)}
            disabled={busy || isClosed}
            className="h-8 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-3 text-xs font-black text-white outline-none focus:border-cyan-300/40 disabled:opacity-50"
          >
            <option value="">{employeeOptions.length ? "اختر موظف" : "لا يوجد موظفون متاحون"}</option>
            {employeeOptions.map((employee) => (
              <option key={employee.value} value={employee.value}>{employee.label}</option>
            ))}
          </select>
          <button type="button" onClick={onAssignEmployee} disabled={busy || isClosed || !selectedEmployeeId} className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 text-[11px] font-black text-white disabled:opacity-50">
            <UserCheck className="h-3.5 w-3.5" />
            تعيين لموظف
          </button>
        </div>
        </div>
      </div>
    </details>
  );
}

function CommentReplyDraftPanel({ draftText = "", onLoadDraft, onCopyDraft, loading }) {
  const value = clean(draftText);
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-violet-300/15 bg-violet-300/8 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-violet-100">مسودة رد على التعليق</div>
          <div className="mt-1 text-xs text-slate-400">يمكنك تحميل المسودة إلى المحرر ثم تعديلها قبل الإرسال.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onLoadDraft?.(value)}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100 disabled:opacity-50"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            رد على التعليق
          </button>
          <button
            type="button"
            onClick={() => onCopyDraft?.(value)}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-100 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            نسخ
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-7 text-slate-100">
        <LinkifiedText text={value} />
      </div>
    </div>
  );
}

function SuggestionProductToSend({ card = null, choices = [], ambiguous = false, colorChoices = [], colorRequired = false, removed = false, deliveryFormat = "", instagramDelivery = false, recommendationMode = false, recommendationSelectedKeys = null, onToggleRecommendation, onRemove, onChange, onChoose }) {
  const hasCard = Boolean(card && (card.product_id || card.id));
  // Phase 13.4 — RECOMMENDATION multi-select: the operator ticks the grounded products to send with the reply.
  // Distinct from single-select identity disambiguation (below) which resolves ONE product.
  const showRecommendation = recommendationMode && !removed && Array.isArray(choices) && choices.length > 0;
  const showChoices = !recommendationMode && ambiguous && !hasCard && !removed && Array.isArray(choices) && choices.length > 0;
  // Phase 12.2 — requested size available in >1 colour, none picked yet → require a colour before a card is definitive.
  const showColorChoices = colorRequired && !hasCard && !removed && Array.isArray(colorChoices) && colorChoices.length > 0;
  if (removed) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-2 text-[11px] font-bold text-slate-300">
        تم حذف كارت المنتج — هيتبعت الرد بس.
        <button type="button" onClick={onChange} className="mr-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-100">➕ إضافة منتج</button>
      </div>
    );
  }
  if (showColorChoices) {
    return (
      <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">المقاس متاح بأكتر من لون — اختار اللون</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {colorChoices.map((c) => (
            <button key={c.variant_id || `${c.product_id}:${c.color}`} type="button" onClick={() => onChoose?.(c)} className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-slate-100 hover:bg-white/[0.1]">
              {(c.image_url || c.image) ? <img src={c.image_url || c.image} alt={clean(c.color)} className="h-6 w-6 rounded border border-white/10 object-cover" /> : null}
              {clean(c.color) || "لون"}{c.display_price ? ` — ${c.display_price} جنيه` : ""}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (showRecommendation) {
    const selKeys = recommendationSelectedKeys instanceof Set ? recommendationSelectedKeys : new Set();
    const selectedCount = selKeys.size;
    return (
      <div className="mt-2 rounded-xl border border-cyan-300/25 bg-cyan-400/[0.08] p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">اختار المنتجات اللي هتتبعت</div>
          {selectedCount > 0 ? <span className="rounded-lg border border-cyan-300/25 bg-cyan-400/15 px-1.5 py-0.5 text-[9px] font-black text-cyan-100">{selectedCountText(selectedCount)}</span> : null}
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {choices.map((c) => {
            const key = productSelectionKey(c);
            const picked = selKeys.has(key);
            const name = clean(c.name || c.product_name);
            const img = c.image_url || c.image || c.thumbnail_url || "";
            const price = c.display_price ?? c.price ?? null;
            const url = c.storefront_url || c.product_url || c.url || "";
            return (
              <div key={c.product_id || c.id} className={`flex items-start gap-2 rounded-lg border p-1.5 transition ${picked ? "border-cyan-300/50 bg-cyan-400/15" : "border-white/12 bg-white/[0.04]"}`}>
                <button type="button" onClick={() => onToggleRecommendation?.(c)} aria-pressed={picked} className="flex min-w-0 flex-1 items-start gap-2 text-right">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] font-black ${picked ? "border-cyan-300 bg-cyan-400 text-slate-900" : "border-white/25 text-transparent"}`}>✓</span>
                  {img ? <img src={img} alt={name} className="h-9 w-9 shrink-0 rounded border border-white/10 object-cover" /> : null}
                  <span className="min-w-0 flex-1 text-[11px] leading-4 text-slate-100">
                    <span className="block truncate font-black">{name}</span>
                    {price != null && price !== "" ? <span className="text-emerald-200 font-bold">{price} جنيه</span> : null}
                  </span>
                </button>
                {url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-[9px] font-black text-cyan-200 underline">فتح المنتج ↗</a> : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (showChoices) {
    return (
      <div className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">فيه أكتر من منتج مطابق — اختر المنتج</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {choices.map((c) => (
            <button key={c.product_id || c.id} type="button" onClick={() => onChoose?.(c)} className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-slate-100 hover:bg-white/[0.1]">
              {clean(c.name || c.product_name)}{c.display_price ? ` — ${c.display_price} جنيه` : ""}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (!hasCard) return null;
  const name = clean(card.name || card.product_name);
  const img = card.image_url || card.image || card.thumbnail_url || "";
  const price = card.display_price ?? card.price ?? null;
  return (
    <div className="mt-2 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100">المنتج اللي هيتبعت</div>
        {deliveryFormat ? <span className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-black text-slate-200">{deliveryFormat}</span> : null}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        {img ? <img src={img} alt={name} className="h-14 w-14 shrink-0 rounded-lg border border-white/10 object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-white/10 bg-slate-800 text-[9px] text-slate-400">لا صورة</div>}
        <div className="min-w-0 flex-1 text-[11px] leading-5 text-slate-100">
          <div className="truncate font-black">{name}</div>
          {card.color ? <div className="text-slate-300">اللون: {clean(card.color)}</div> : null}
          {card.size ? <div className="text-slate-300">المقاس: {clean(card.size)}</div> : null}
          {price != null && price !== "" ? <div className="text-emerald-200 font-bold">{price} جنيه</div> : null}
          <div className={`font-bold ${card.in_stock === false ? "text-rose-300" : "text-emerald-300"}`}>{card.in_stock === false ? "غير متاح" : "متاح"}</div>
          {(card.storefront_url || card.product_url) ? <a href={card.storefront_url || card.product_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-cyan-200 underline">عرض المنتج ↗</a> : null}
        </div>
      </div>
      {instagramDelivery ? (
        <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 p-2">
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200/80">اللي هيوصل للعميل (نص + لينك)</div>
          <pre dir="rtl" className="mt-1 whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-slate-100">{instagramShareText(card)}</pre>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onRemove} className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-200 hover:bg-white/[0.08]">🗑️ حذف المنتج</button>
        <button type="button" onClick={onChange} className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-100 hover:bg-violet-400/15">🔁 تغيير المنتج</button>
      </div>
    </div>
  );
}

function AiSuggestionCard({
  text = "",
  onEdit,
  onApprove,
  onDismiss,
  editing = false,
  reviewNeeded = false,
  productCard = null,
  productChoices = [],
  productAmbiguous = false,
  colorChoices = [],
  colorRequired = false,
  productRemoved = false,
  deliveryFormat = "",
  channelName = "",
  instagramDelivery = false,
  recommendationMode = false,
  recommendationSelectedKeys = null,
  onToggleRecommendation,
  onRemoveProduct,
  onChangeProduct,
  onChooseProduct,
  editText = "",
  onEditTextChange,
  onCancelEdit,
}) {
  const value = clean(text);
  if (!value) return null;
  // The text that Approve & Send will actually send: the inline edit while editing, else the AI suggestion.
  const finalText = editing ? editText : value;
  // Phase 13.4 — recommendation batch count drives the Approve button label ("اعتماد وإرسال (N منتجات)").
  const recommendationCount = recommendationMode && recommendationSelectedKeys instanceof Set ? recommendationSelectedKeys.size : 0;

  return (
    <div className={`mb-2 rounded-2xl border p-2.5 ${editing ? "border-violet-300/30 bg-violet-400/10" : "border-cyan-300/15 bg-cyan-300/8"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">{editing ? "تعديل اقتراح الذكاء الاصطناعي" : "اقتراح الذكاء الاصطناعي"}</div>
            {clean(channelName) ? <span className="rounded-lg border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-black text-slate-200">{clean(channelName)}</span> : null}
            {clean(deliveryFormat) ? <span className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-black text-cyan-100">التسليم: {clean(deliveryFormat)}</span> : null}
            {/* Phase 13.3 — ONE compact operator-facing review cue; replaces the large validation/confidence panels. */}
            {reviewNeeded ? <span className="rounded-lg border border-amber-300/30 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-black text-amber-100">⚠ يحتاج مراجعة</span> : null}
          </div>
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => onEditTextChange?.(e.target.value)}
              rows={4}
              dir="auto"
              autoFocus
              className="mt-2 w-full resize-y rounded-xl border border-violet-300/40 bg-slate-950/80 p-3 text-sm leading-7 text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
              placeholder="عدّل رد الذكاء الاصطناعي هنا..."
            />
          ) : (
            <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-slate-950/75 p-3 text-sm leading-7 text-slate-100">
              {value}
            </div>
          )}
          {/* Phase 13.3 — presentation-only: show only the exact text that will be sent. The technical grounding
              facts block, context-provenance chip, match type and stock counts are hidden from the operator
              view (grounding still runs and is enforced server-side; only the display is simplified). */}
          <div className="mt-1 text-[10px] font-bold text-slate-400">النص اللي هيتبعت للعميل: <span className="text-slate-100">{clean(finalText) || "—"}</span></div>
        </div>
        {editing ? <Pill tone="violet" className="shrink-0 px-2 py-0.5 text-[10px] font-black">Editing</Pill> : null}
      </div>
      <SuggestionProductToSend
        card={productCard}
        choices={productChoices}
        ambiguous={productAmbiguous}
        colorChoices={colorChoices}
        colorRequired={colorRequired}
        removed={productRemoved}
        deliveryFormat={deliveryFormat}
        instagramDelivery={instagramDelivery}
        recommendationMode={recommendationMode}
        recommendationSelectedKeys={recommendationSelectedKeys}
        onToggleRecommendation={onToggleRecommendation}
        onRemove={onRemoveProduct}
        onChange={onChangeProduct}
        onChoose={onChooseProduct}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={editing ? onCancelEdit : onEdit}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100 transition hover:bg-violet-400/15"
        >
          {editing ? "↩️ إلغاء التعديل" : "✏️ تعديل الرد"}
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-[11px] font-black text-emerald-100 transition hover:bg-emerald-400/15"
        >
          ✅ {recommendationMode && recommendationCount > 0 ? assistedSendButtonText(recommendationCount) : "اعتماد وإرسال"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-200 transition hover:bg-white/[0.08]"
        >
          ❌ تجاهل
        </button>
      </div>
    </div>
  );
}

function ManualReplyComposer({
  conversation,
  value,
  onChange,
  onSend,
  onOpenProductPicker,
  onOpenAvailableBySizePicker,
  onCreateCustomer,
  onLoadDraft,
  onCopyDraft,
  commentDraftText = "",
  isCommentConversation = false,
  loading,
  validationSummary = null,
  confidenceEngineSummary = null,
  aiSuggestionText = "",
  aiSuggestionVisible = false,
  aiSuggestionEditing = false,
  aiSuggestionProductCard = null,
  aiSuggestionProductChoices = [],
  aiSuggestionProductAmbiguous = false,
  aiSuggestionColorChoices = [],
  aiSuggestionColorRequired = false,
  aiSuggestionProductRemoved = false,
  aiSuggestionDeliveryFormat = "",
  aiSuggestionRecommendationMode = false,
  aiSuggestionRecommendationSelectedKeys = null,
  onToggleSuggestionRecommendation,
  aiSuggestionEditText = "",
  onAiSuggestionEditTextChange,
  onCancelEditAiSuggestion,
  onRemoveSuggestionProduct,
  onChangeSuggestionProduct,
  onChooseSuggestionProduct,
  onEditAiSuggestion,
  onApproveAiSuggestion,
  onDismissAiSuggestion,
}) {
  const status = conversation?.conversation_status || conversation?.status || "ai_active";
  const canSendLive = conversation?.live_sending_available === true || isCommentConversation;
  const submitLabel = isCommentConversation ? "إرسال الرد" : "إرسال الآن";
  const submitTitle = isCommentConversation ? "إرسال رد علني على الكومنت" : "Send now through Meta";
  const textareaRef = useRef(null);
  const normalizedValidation = normalizeValidationSummary(validationSummary || {});
  const normalizedConfidence = normalizeConfidenceEngineSummary(confidenceEngineSummary || {});
  // Phase 13.3 — PRESENTATION ONLY. The large validation + confidence panels are removed from the normal
  // operator view; their state is condensed into ONE compact "⚠ يحتاج مراجعة" badge shown only when the EXISTING
  // logic materially recommends review (a real validation violation or a high-risk confidence decision). No
  // decision logic, thresholds, or telemetry change — the full detail stays in the draft/schema for AI Studio.
  const reviewNeeded = normalizedValidation.violationsCount > 0 || normalizedConfidence.decision === "high_risk" || normalizedConfidence.tone === "rose";
  const submit = () => {
    if (clean(value)) onSend();
  };
  const resizeTextarea = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  };
  useEffect(() => {
    resizeTextarea();
  }, [value]);
  if (!conversation) return null;
  if (status === "closed") {
    return <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">المحادثة مغلقة. تم تعطيل الرد اليدوي.</div>;
  }
  return (
    <div className="sticky bottom-0 w-full bg-[#eefaf8] p-2 shadow-[0_-1px_10px_rgba(15,23,42,0.08)] dark:bg-[#20231f] dark:shadow-[0_-1px_10px_rgba(0,0,0,0.22)]">
      {status !== "human_takeover" && canSendLive && !isCommentConversation ? <div className="sr-only">Sending a staff reply will take over this conversation and pause AI automation.</div> : null}
      {isCommentConversation ? (
        <div className="mb-1.5">
          <CommentReplyDraftPanel
            draftText={commentDraftText}
            onLoadDraft={onLoadDraft}
            onCopyDraft={onCopyDraft}
            loading={loading}
          />
        </div>
      ) : null}
      {aiSuggestionVisible && clean(aiSuggestionText) ? (
        <AiSuggestionCard
          text={aiSuggestionText}
          editing={aiSuggestionEditing}
          reviewNeeded={reviewNeeded}
          productCard={aiSuggestionProductCard}
          productChoices={aiSuggestionProductChoices}
          colorChoices={aiSuggestionColorChoices}
          colorRequired={aiSuggestionColorRequired}
          productAmbiguous={aiSuggestionProductAmbiguous}
          productRemoved={aiSuggestionProductRemoved}
          deliveryFormat={aiSuggestionDeliveryFormat}
          channelName={channelLabel(conversation?.channel || conversation?.source)}
          instagramDelivery={String(conversation?.channel || conversation?.source || "").toLowerCase().includes("instagram")}
          recommendationMode={aiSuggestionRecommendationMode}
          recommendationSelectedKeys={aiSuggestionRecommendationSelectedKeys}
          onToggleRecommendation={onToggleSuggestionRecommendation}
          onRemoveProduct={onRemoveSuggestionProduct}
          onChangeProduct={onChangeSuggestionProduct}
          onChooseProduct={onChooseSuggestionProduct}
          editText={aiSuggestionEditText}
          onEditTextChange={onAiSuggestionEditTextChange}
          onCancelEdit={onCancelEditAiSuggestion}
          onEdit={onEditAiSuggestion}
          onApprove={onApproveAiSuggestion}
          onDismiss={onDismissAiSuggestion}
        />
      ) : null}
      <div dir="ltr" className="flex min-w-0 items-end gap-2">
        <div className="flex min-h-12 min-w-0 flex-1 items-end rounded-xl border border-slate-300 bg-white px-2 shadow-[0_1px_3px_rgba(15,23,42,0.18)] transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/15 dark:border-white/15 dark:bg-[#1b1e1b] dark:shadow-none dark:focus-within:border-amber-300/50 dark:focus-within:ring-amber-300/10">
          <button
            type="button"
            onClick={() => onOpenProductPicker?.()}
            disabled={loading}
            title="Attach product"
            aria-label="Attach product"
            className="mb-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-slate-100"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            data-ai-inbox-composer="true"
            dir={isRtlText(value) ? "rtl" : "auto"}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              resizeTextarea();
            }}
            onInput={resizeTextarea}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={canSendLive ? "Type your message..." : "Write an internal note. It will not be sent yet."}
            className="min-h-11 min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-2 py-2.5 text-sm font-medium leading-6 text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button type="button" title="Emoji" aria-label="Emoji" className="mb-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-100">
            <Smile className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenAvailableBySizePicker?.()}
            disabled={loading}
            title="Available products"
            aria-label="Available products"
            className="mb-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-slate-100"
          >
            <FileText className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={loading || !clean(value) || !canSendLive}
          title={submitTitle}
          aria-label={submitLabel}
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-[0_6px_16px_rgba(3,105,161,0.28)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 ${normalizedConfidence.decision === "high_risk" || normalizedValidation.violationsCount > 0 ? "bg-amber-500 hover:bg-amber-600" : "bg-sky-700 hover:bg-sky-800"}`}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

function ReplyCorrectionModal({ open, draft, saving, onClose, onChange, onSave }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-3 py-4 backdrop-blur-sm md:items-center">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/98 p-4 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-200">AI correction memory</div>
            <h3 className="mt-1 text-lg font-black text-white">تصحيح رد الـAI</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-100"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">سؤال العميل</div>
            <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-7 text-slate-100">
              {clean(draft.customerQuestion) || "غير متاح"}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">رد الـAI القديم</div>
            <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-7 text-slate-100">
              {clean(draft.aiWrongAnswer) || "غير متاح"}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="block">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الرد الصحيح</div>
            <textarea
              value={draft.employeeCorrectAnswer}
              onChange={(event) => onChange({ employeeCorrectAnswer: event.target.value })}
              rows={5}
              placeholder="اكتب التصحيح هنا..."
              className="min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm font-medium leading-7 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
            />
          </label>
          <div className="space-y-3">
            <label className="block">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">نوع التصحيح</div>
              <select
                value={draft.correctionType}
                onChange={(event) => onChange({ correctionType: event.target.value })}
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/40"
              >
                {replyCorrectionTypes.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Product ID اختياري</div>
              <input
                value={draft.productId}
                onChange={(event) => onChange({ productId: event.target.value })}
                placeholder="123"
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 text-sm font-black text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </label>
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/8 p-3 text-xs leading-6 text-cyan-100">
              التصحيح يُحفظ كذاكرة داخلية فقط. لن يتم إرسال أي رسالة للعميل، ولن يتم تعديل الرسالة القديمة.
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-black text-slate-100">
            إلغاء
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !clean(draft.employeeCorrectAnswer)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            حفظ التصحيح
          </button>
        </div>
      </div>
    </div>
  );
}

const autoReplyModes = [
  { key: "off", label: "Off" },
  { key: "suggest_only", label: "Suggest only" },
  { key: "auto_reply_after_approval", label: "Approval" },
  { key: "fully_automatic", label: "Automatic" },
];

const resolveChannelAutoReplyMode = (channelStatus = {}) => {
  const mode = clean(channelStatus.auto_reply_mode || channelStatus.ai_mode || "").toLowerCase();
  if (["off", "suggest_only", "auto_reply_after_approval", "fully_automatic"].includes(mode)) return mode;
  return channelStatus.ai_replies_enabled === true ? "suggest_only" : "off";
};

const lastEnabledAutoReplyModeKey = (tenantId, channelKey) => `aiInbox:lastEnabledAutoReplyMode:${tenantId}:${channelKey}`;

const isHiddenAiReplyTranscriptMessage = (message = {}) => {
  const status = clean(message.status || message.delivery_status || message.message_status || "").toLowerCase();
  const messageType = clean(message.message_type || message.messageType || "").toLowerCase();
  const source = clean(message.source || message.origin || message.source_path || message.insert_source || "").toLowerCase();
  const deliveryStatus = clean(message.delivery_status || "").toLowerCase();
  return (
    status === "not_sent" ||
    status === "draft" ||
    messageType === "draft" ||
    messageType === "ai_reply_draft" ||
    messageType === "comment_suggestion" ||
    source === "ai_suggestion" ||
    (Boolean(message.manual_message) && !deliveryStatus && source === "manual_message_insert")
  );
};

function AutoReplyModePanel({ channelStatus = {}, mode, onChange, saving }) {
  const channelReady = channelStatus.live_operational === true || channelStatus.effective_enabled === true || channelStatus.last_webhook_received_at || ["sent", "test_sent"].includes(channelStatus.last_send_status);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle icon={Bot} title="Auto reply mode" action={<Pill tone={channelReady ? "emerald" : "amber"}>{channelReady ? "Channel active" : "Setup needed"}</Pill>} />
      <div className="grid gap-2 sm:grid-cols-4">
        {autoReplyModes.map((item) => (
          <button key={item.key} type="button" onClick={() => onChange(item.key)} disabled={saving} className={`h-10 rounded-xl border px-2 text-xs font-black transition disabled:opacity-50 ${mode === item.key ? "border-cyan-300/40 bg-cyan-300 text-slate-950" : "border-white/10 bg-slate-950/70 text-slate-100 hover:border-cyan-300/30"}`}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecommendationsPanel({ products = [], loading, onRefresh, onQuickSend, onSendImages, onCreateDraft }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle
        icon={ShoppingBag}
        title="Matched products"
        action={<button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</button>}
      />
      {products.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {products.slice(0, 6).map((product) => {
            const image = productImage(product);
            const variantLabel = productVariantLabel(product);
            const score = productScore(product);
            const reason = productReason(product);
            return (
              <div key={product.id || product.product_id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                <div className="flex gap-3">
                  {image ? <img src={image} alt={product.name || "منتج"} className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" /> : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-white">{product.name || product.title || "منتج"}</div>
                    <div className="mt-1 text-xs font-bold text-emerald-100">{money(product.final_price || product.price || product.sale_price || 0)}</div>
                    <div className="mt-1 text-xs text-slate-400">{variantLabel}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Pill tone="zinc">{productSource(product)}</Pill>
                      {score ? <Pill tone="cyan">Score {score.toFixed(2)}</Pill> : null}
                    </div>
                  </div>
                </div>
                {reason ? <p dir={isRtlText(reason) ? "rtl" : "auto"} className="mt-2 line-clamp-2 text-[12px] leading-5 text-slate-400">{reason}</p> : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onQuickSend(product)} className="h-9 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2 text-[11px] font-black text-cyan-100">Quick send</button>
                  <button type="button" onClick={() => onSendImages?.(product)} className="h-9 rounded-xl border border-violet-300/20 bg-violet-400/10 px-2 text-[11px] font-black text-violet-100">Send images</button>
                  <button type="button" onClick={() => onCreateDraft(product)} className="h-9 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2 text-[11px] font-black text-emerald-100">Draft order</button>
                  <a href={storefrontProductUrl(product)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] px-2 text-[11px] font-black text-white">Open product</a>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No matched products yet. Refresh after the customer sends a model, color, size, or category.</div>}
    </div>
  );
}

const shippingLocationId = (item = {}) => clean(item.id || item.provider_city_id || item.provider_zone_id || item.provider_district_id);
const shippingLocationLabel = (item = {}) => clean(item.name_ar || item.name_en || item.name || item.city_name_ar || item.zone_name_ar || item.district_name_ar);
const AI_INBOX_SHIPPING_PROVIDERS = [
  { id: "bosta", label: "Bosta" },
  { id: "mylerz", label: "Mylerz" },
  { id: "shipblu", label: "ShipBlu" },
  { id: "in_store_delivery", label: "توصيل المتجر" },
];

function InboxOrderComposer({ open, conversation = {}, products = [], busy = false, headers = {}, onClose, onSubmit }) {
  const profile = conversation?.customer_profile || {};
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingProvider, setShippingProvider] = useState("bosta");
  const [shippingCityId, setShippingCityId] = useState("");
  const [shippingZoneId, setShippingZoneId] = useState("");
  const [shippingDistrictId, setShippingDistrictId] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [landmark, setLandmark] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [cityArea, setCityArea] = useState("");
  const [shippingLocations, setShippingLocations] = useState({ cities: [], zones: [], districts: [], loading: false });
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    const firstProduct = asArray(products)[0] || null;
    setProductId(clean(firstProduct?.product_id || firstProduct?.id));
    setQuantity(1);
    setSize(clean(conversation?.channel_metadata?.last_size || profile.preferred_size || ""));
    setColor(clean(conversation?.channel_metadata?.last_color || ""));
    setCustomerName(firstUsefulCustomerName(conversation?.customer_name, profile.name, profile.display_name));
    setCustomerPhone(clean(profile.phone || conversation?.customer_phone || conversation?.channel_metadata?.resolved_phone || ""));
    setShippingProvider(clean(profile.shipping_provider || profile.shipping_provider_id || conversation?.shipping_provider || "bosta").toLowerCase());
    setShippingCityId(clean(profile.shipping_city_id || conversation?.shipping_city_id || ""));
    setShippingZoneId(clean(profile.shipping_zone_id || conversation?.shipping_zone_id || ""));
    setShippingDistrictId(clean(profile.shipping_district_id || profile.district_id || conversation?.shipping_district_id || ""));
    setStreetAddress(clean(profile.street_address || profile.address || conversation?.customer_address || ""));
    setBuildingNumber(clean(profile.building_number || conversation?.building_number || ""));
    setFloorNumber(clean(profile.floor_number || conversation?.floor_number || ""));
    setApartmentNumber(clean(profile.apartment_number || conversation?.apartment_number || ""));
    setLandmark(clean(profile.landmark || conversation?.landmark || ""));
    setGovernorate(clean(profile.governorate || conversation?.governorate || ""));
    setCityArea(clean(profile.city_area || profile.area || conversation?.city_area || ""));
    setNotes("");
  }, [conversation?.session_id, open, products]);

  useEffect(() => {
    if (!open || shippingProvider !== "bosta") return;
    let active = true;
    setShippingLocations((current) => ({ ...current, loading: true }));
    api.get("/shipping/cities?provider=bosta&dropoff=1", { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, cities: asArray(data?.cities) })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, cities: [] })))
      .finally(() => active && setShippingLocations((current) => ({ ...current, loading: false })));
    return () => { active = false; };
  }, [headers, open, shippingProvider]);

  useEffect(() => {
    if (!open || shippingProvider !== "bosta" || !shippingCityId) {
      setShippingLocations((current) => ({ ...current, zones: [], districts: [] }));
      return;
    }
    let active = true;
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(shippingCityId)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, zones: asArray(data?.zones), districts: [] })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, zones: [], districts: [] })));
    return () => { active = false; };
  }, [headers, open, shippingCityId, shippingProvider]);

  useEffect(() => {
    if (!open || shippingProvider !== "bosta" || !shippingZoneId) {
      setShippingLocations((current) => ({ ...current, districts: [] }));
      return;
    }
    let active = true;
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(shippingZoneId)}`, { headers, suppressErrorStatuses: [404, 500] })
      .then((data) => active && setShippingLocations((current) => ({ ...current, districts: asArray(data?.districts) })))
      .catch(() => active && setShippingLocations((current) => ({ ...current, districts: [] })));
    return () => { active = false; };
  }, [headers, open, shippingProvider, shippingZoneId]);

  if (!open) return null;
  const selectedProduct = asArray(products).find((item) => clean(item.product_id || item.id) === clean(productId)) || null;
  const unitPrice = Number(selectedProduct?.final_price || selectedProduct?.price || selectedProduct?.sale_price || 0) || 0;
  const stock = Number(selectedProduct?.total_stock ?? selectedProduct?.stock ?? 0) || 0;
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  const selectedCity = shippingLocations.cities.find((item) => shippingLocationId(item) === shippingCityId) || null;
  const selectedZone = shippingLocations.zones.find((item) => shippingLocationId(item) === shippingZoneId) || null;
  const selectedDistrict = shippingLocations.districts.find((item) => shippingLocationId(item) === shippingDistrictId) || null;
  const shippingComplete = shippingProvider === "bosta"
    ? Boolean(shippingCityId && shippingZoneId && shippingDistrictId && streetAddress && buildingNumber)
    : Boolean(governorate && cityArea && streetAddress);
  const canSubmit = Boolean(selectedProduct && customerName && customerPhone && shippingProvider && shippingComplete) && safeQuantity <= stock && !busy;
  return (
    <div className="fixed inset-0 z-[140] flex justify-end bg-slate-950/75 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section dir="rtl" className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#111512] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">AI Inbox Order</div>
            <h2 className="mt-1 text-2xl font-black text-white">إنشاء طلب من المحادثة</h2>
            <p className="mt-1 text-sm text-slate-400">راجع بيانات العميل والمنتج قبل إنشاء المسودة. لن يُخصم المخزون قبل تأكيد الطلب.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white"><XCircle className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2 font-black text-white"><User className="h-4 w-4 text-emerald-300" />بيانات العميل</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="اسم العميل *" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="رقم الهاتف *" inputMode="tel" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-1 flex items-center gap-2 font-black text-white"><Truck className="h-4 w-4 text-cyan-300" />شركة الشحن وبيانات التوصيل</div>
            <p className="mb-3 text-xs text-slate-400">اختار شركة الشحن. مع Bosta هنستخدم قائمة المدن والمناطق والأحياء المعتمدة عند الشركة لضمان قبول الشحنة.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-black text-slate-300">شركة الشحن *</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="شركة الشحن">
                  {AI_INBOX_SHIPPING_PROVIDERS.map((provider) => {
                    const active = shippingProvider === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setShippingProvider(provider.id);
                          setShippingCityId("");
                          setShippingZoneId("");
                          setShippingDistrictId("");
                        }}
                        className={`h-11 rounded-xl border px-2 text-xs font-black transition ${active ? "border-amber-300 bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/30" : "border-white/10 bg-slate-950/70 text-slate-200 hover:border-white/25"}`}
                      >
                        {provider.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {shippingProvider === "bosta" ? (
                <>
                  <select value={shippingCityId} onChange={(event) => { setShippingCityId(event.target.value); setShippingZoneId(""); setShippingDistrictId(""); }} disabled={shippingLocations.loading} className="h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white outline-none disabled:opacity-50">
                    <option value="">{shippingLocations.loading ? "تحميل المدن..." : "المدينة *"}</option>
                    {shippingLocations.cities.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                  <select value={shippingZoneId} onChange={(event) => { setShippingZoneId(event.target.value); setShippingDistrictId(""); }} disabled={!shippingCityId} className="h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white outline-none disabled:opacity-50">
                    <option value="">المنطقة *</option>
                    {shippingLocations.zones.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                  <select value={shippingDistrictId} onChange={(event) => setShippingDistrictId(event.target.value)} disabled={!shippingZoneId} className="h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm font-bold text-white outline-none disabled:opacity-50 sm:col-span-2">
                    <option value="">الحي *</option>
                    {shippingLocations.districts.map((item) => <option key={shippingLocationId(item)} value={shippingLocationId(item)}>{shippingLocationLabel(item)}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <input value={governorate} onChange={(event) => setGovernorate(event.target.value)} placeholder="المحافظة *" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
                  <input value={cityArea} onChange={(event) => setCityArea(event.target.value)} placeholder="المدينة / المنطقة *" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
                </>
              )}

              <div className="sm:col-span-2 flex items-center gap-2 pt-1 text-xs font-black text-slate-300"><MapPin className="h-4 w-4 text-rose-300" />العنوان التفصيلي</div>
              <textarea value={streetAddress} onChange={(event) => setStreetAddress(event.target.value)} placeholder="اسم الشارع والعنوان بالتفصيل *" className="min-h-20 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm font-bold text-white outline-none sm:col-span-2" />
              <input value={buildingNumber} onChange={(event) => setBuildingNumber(event.target.value)} placeholder={shippingProvider === "bosta" ? "رقم المبنى *" : "رقم المبنى"} className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} placeholder="الدور" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} placeholder="رقم الشقة" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={landmark} onChange={(event) => setLandmark(event.target.value)} placeholder="علامة مميزة" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2 font-black text-white"><ShoppingBag className="h-4 w-4 text-amber-300" />المنتج والمخزون</div>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm font-black text-white outline-none">
              <option value="">اختر منتجًا من المنتجات المطابقة</option>
              {asArray(products).map((product) => <option key={product.product_id || product.id} value={product.product_id || product.id}>{product.name || product.title} — المتاح {Number(product.total_stock ?? product.stock ?? 0) || 0}</option>)}
            </select>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="المقاس" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="اللون" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
              <input value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} min="1" type="number" placeholder="الكمية" className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none" />
            </div>
            {selectedProduct ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm font-black"><span className={safeQuantity <= stock ? "text-emerald-100" : "text-rose-200"}>المخزون: {stock} — المطلوب: {safeQuantity}</span><span className="text-white">الإجمالي: {money(unitPrice * safeQuantity)}</span></div> : null}
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات الطلب" className="min-h-20 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm font-bold text-white outline-none" />
          {!shippingComplete ? <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs font-bold text-amber-100">أكمل بيانات الشحن المطلوبة لتفعيل إنشاء المسودة.</div> : null}
          <button type="button" disabled={!canSubmit} onClick={() => onSubmit?.(selectedProduct, {
            quantity: safeQuantity,
            size,
            color,
            customer_name: customerName,
            customer_phone: customerPhone,
            customer_address: streetAddress,
            governorate: shippingProvider === "bosta" ? shippingLocationLabel(selectedCity) : governorate,
            city_area: shippingProvider === "bosta" ? shippingLocationLabel(selectedDistrict) || shippingLocationLabel(selectedZone) : cityArea,
            shipping_provider: shippingProvider,
            shipping_provider_id: shippingProvider,
            shipping_city_id: shippingCityId,
            shipping_zone_id: shippingZoneId,
            shipping_district_id: shippingDistrictId,
            district_id: shippingDistrictId,
            street_address: streetAddress,
            building_number: buildingNumber,
            floor_number: floorNumber,
            apartment_number: apartmentNumber,
            landmark,
            notes,
          })} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><ShoppingCart className="h-5 w-5" />إنشاء مسودة الطلب</button>
        </div>
      </section>
    </div>
  );
}

function SalesCloserPanel({ plan = {}, products = [], conversation = {}, loading, onRefresh, onTakeover, onUseText, onCreateDraft, onPaymentAction, onOpenProductPicker }) {
  const intent = plan.intent || {};
  const lead = plan.lead || {};
  const actions = asArray(plan.suggested_actions);
  const memory = plan.memory || {};
  const followup = plan.followup || {};
  const primary = plan.primary_product || products.find((product) => Number(product.total_stock || product.stock || 0) > 0) || products[0] || null;
  const leadTone = lead.label === "hot" ? "rose" : lead.label === "warm" ? "amber" : "cyan";
  const needsHuman = needsHumanAttention(conversation);
  const recommendedStep = needsHuman
    ? "Human review recommended because this conversation is escalated."
    : primary
      ? "تم العثور على سياق منتج. ابدأ بالتوفر وخطوة تالية واضحة."
      : intent.size
        ? "Ask the customer for product name or photo."
        : "Ask for size before recommending stock.";
  const practicalActions = [
    { key: "ask_size", label: "Ask for size", enabled: !intent.size, action: () => onUseText(intent.product_model ? `تمام، المتوفر على ${intent.product_model}، تقولي المقاس اللي محتاجه؟` : "تمام، تقولي المقاس اللي محتاجه؟") },
    { key: "ask_product", label: "Ask for product clarification", enabled: !primary, action: () => onUseText("ممكن تبعتلي اسم المنتج أو صورة أوضح عشان أجيب لك الأنسب؟") },
    { key: "recommend_alternative", label: "Recommend alternative", enabled: Boolean(primary || products.length), action: () => onUseText(followup.alternative_message || "لو المقاس أو اللون ده غير متوفر، أقدر أرشح لك بديل قريب جدًا.") },
    { key: "escalate_human", label: "Escalate to human", enabled: true, action: onTakeover },
    { key: "draft_order", label: "Draft order", enabled: Boolean(primary), action: () => primary && onCreateDraft?.(primary, { reserve: false }) },
    { key: "reserve_stock", label: "Reserve stock", enabled: Boolean(primary), action: () => primary && onCreateDraft?.(primary, { reserve: true }) },
    { key: "available_by_size", label: "المتاح بالمقاس", enabled: true, action: () => onOpenProductPicker?.({ sizeMode: true, allowMultiple: true }) },
    { key: "payment_link", label: "Send payment link", enabled: true, action: () => onPaymentAction?.("payment_link") },
    { key: "follow_up", label: "Follow up", enabled: Boolean(followup.low_stock_message || followup.ten_minute_message), action: () => onUseText(followup.low_stock_message || followup.ten_minute_message || "هتابع معاك أول ما يتوفر المقاس المناسب.") },
  ];
  const chips = [
    intent.product_model ? `Model: ${intent.product_model}` : "",
    intent.size ? `Size: ${intent.size}` : "",
    intent.color ? `Color: ${intent.color}` : "",
    intent.quantity ? `Qty: ${intent.quantity}` : "",
    intent.budget ? `Budget: ${money(intent.budget)}` : "",
    intent.urgency ? `Urgency: ${intent.urgency}` : "",
  ].filter(Boolean);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle
        icon={Brain}
        title="AI Next Step"
        action={<button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Analyze</button>}
      />
      <div className="mb-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">Recommended next step</div>
          <Pill tone={leadTone}>{lead.label || "بارد"} / {Number(lead.score || 0).toFixed(0)}%</Pill>
        </div>
        <p className="mt-2 text-sm font-black leading-6 text-white">{recommendedStep}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-950/50 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Confidence</div>
            <div className="mt-1 text-sm font-black text-white">{Number(lead.score || 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl bg-slate-950/50 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Reason</div>
            <div className="mt-1 line-clamp-2 text-sm font-bold text-slate-200">{clean(plan.reason || plan.explanation || plan.summary || intent.reason || recommendedStep)}</div>
          </div>
          <div className="rounded-xl bg-slate-950/50 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Suggested action</div>
            <div className="mt-1 text-sm font-black text-white">{actions[0]?.label || "Continue conversation"}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Pill tone={leadTone}>{(lead.label || "بارد")} محتمل</Pill>
              <span className="text-xl font-black text-white">{Number(lead.score || 0).toFixed(0)}%</span>
            </div>
            <div className="text-xs leading-5 text-slate-400">Purchase intent: <span className="font-black text-slate-100">{intent.purchase_intent || "unknown"}</span></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.length ? chips.map((chip) => <Pill key={chip} tone="zinc">{chip}</Pill>) : <span className="text-sm text-slate-500">Waiting for product, size, color, or buying signal.</span>}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {practicalActions.map((action) => {
              const Icon = action.key === "follow_up" ? Flame : action.key === "escalate_human" ? Handshake : action.key === "payment_link" ? CreditCard : action.key === "reserve_stock" ? PackageCheck : action.key === "draft_order" ? ShoppingCart : action.key === "available_by_size" ? Ruler : MessageSquareText;
              return (
                <button key={action.key} type="button" onClick={action.action || (() => {})} disabled={loading || action.enabled === false} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-slate-100 disabled:text-slate-500 disabled:opacity-60">
                  <Icon className="h-4 w-4" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-3">
          {primary ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
              <div className="flex gap-3">
                {productImage(primary) ? <img src={productImage(primary)} alt={primary.name || "منتج"} className="h-20 w-20 rounded-xl object-cover" loading="lazy" /> : <span className="grid h-20 w-20 place-items-center rounded-xl bg-white/[0.06]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{primary.name || primary.title || "Matched product"}</div>
                  <div className="mt-1 text-xs text-emerald-100">{money(primary.final_price || primary.price)} / {primary.stock_state || primary.availability || "stock unknown"}</div>
                  <div className="mt-1 text-xs text-slate-500">{productVariantLabel(primary)}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill tone="zinc">{productSource(primary)}</Pill>
                    {productScore(primary) ? <Pill tone="cyan">Score {productScore(primary).toFixed(2)}</Pill> : null}
                  </div>
                  {productReason(primary) ? <p dir={isRtlText(productReason(primary)) ? "rtl" : "auto"} className="mt-2 line-clamp-2 text-[12px] leading-5 text-slate-400">{productReason(primary)}</p> : null}
                  <button type="button" onClick={() => onUseText(`${primary.name || primary.title}\n${money(primary.final_price || primary.price)}\n${storefrontProductUrl(primary)}`.trim())} className="mt-2 inline-flex h-8 items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100">Quick send card</button>
                </div>
              </div>
            </div>
          ) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No product match yet. Ask for model, category, size, color, or budget.</div>}
          {actions.length ? <div className="grid gap-2 sm:grid-cols-2">
            {actions.slice(0, 4).map((action) => (
              <div key={action.key} className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-100">{action.label}</span>
                  <Pill tone={action.priority === "high" ? "rose" : action.priority === "low" ? "zinc" : "cyan"}>{action.priority || "normal"}</Pill>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{action.enabled === false ? "Needs more data" : clean(action.reason || action.description || action.summary || "Suggested")}</div>
              </div>
            ))}
          </div> : null}
          <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-black text-slate-100"><BadgePercent className="h-4 w-4 text-amber-200" />الذاكرة</div>
            <div className="flex flex-wrap gap-1.5">
              {memory.preferred_size ? <Pill tone="zinc">Size {memory.preferred_size}</Pill> : null}
              {asArray(memory.preferred_colors).slice(0, 3).map((item) => <Pill key={item} tone="zinc">{item}</Pill>)}
              {asArray(memory.favorite_models).slice(0, 3).map((item) => <Pill key={item} tone="zinc">{item}</Pill>)}
              {!memory.preferred_size && !asArray(memory.preferred_colors).length && !asArray(memory.favorite_models).length ? <span className="text-xs text-slate-500">ستتحسن الذاكرة مع استمرار المحادثة.</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const confirmationStatusMeta = (status = "") => {
  const key = clean(status).toLowerCase();
  if (key === "confirmed") return { label: "تم التأكيد من العميل", tone: "emerald" };
  if (key === "edit_requested") return { label: "العميل طلب تعديل", tone: "amber" };
  if (key === "cancelled_by_customer") return { label: "ألغاه العميل", tone: "rose" };
  if (key === "pending_confirmation") return { label: "بانتظار التأكيد", tone: "cyan" };
  return { label: key || "Unknown", tone: "zinc" };
};

function CustomerContextCard({ conversation = {} }) {
  const messages = uniqueMessages(conversation?.messages);
  const latest = [...messages].reverse().find((message) => message.detected_intent || message.customer_message || message.ai_answer) || {};
  const profile = conversation?.customer_profile || {};
  const identityName = isMessengerConversation(conversation) ? messengerDisplayName(conversation) : getConversationDisplayName(conversation);
  const avatarUrl = customerAvatarUrl(conversation);
  const channelMetadata = conversation?.channel_metadata || {};
  const latestMemory = latest.memory_changes || latest.memory || {};
  const channelMemory = channelMetadata.ai_memory || channelMetadata.aiMemory || conversation?.ai_memory || conversation?.aiMemory || latestMemory || {};
  const memorySources = [channelMemory, channelMetadata.ai_memory, channelMetadata.aiMemory, conversation?.ai_memory, conversation?.aiMemory, latestMemory].filter(Boolean);
  const productFromMemory = (source = {}) => {
    const prefs = source.preferences || {};
    return source.last_product ||
    source.lastProduct ||
    source.lastProductCard ||
    prefs.last_product ||
    prefs.lastProduct ||
    prefs.lastProductCard ||
    asArray(source.last_product_cards)[0] ||
    asArray(source.lastProductCards)[0] ||
    asArray(prefs.last_product_cards)[0] ||
    asArray(prefs.lastProductCards)[0] ||
    (source.last_product_id || source.lastProductId || prefs.last_product_id || prefs.lastProductId ? {
      id: source.last_product_id || source.lastProductId || prefs.last_product_id || prefs.lastProductId,
      name: source.last_product_name || source.lastProductName || prefs.last_product_name || prefs.lastProductName || "",
      product_name: source.last_product_name || source.lastProductName || prefs.last_product_name || prefs.lastProductName || "",
    } : null);
  };
  const lastProduct = memorySources.map(productFromMemory).find(Boolean) || conversation?.current_product || conversation?.product || channelMetadata.current_product || channelMetadata.last_viewed_product || null;
  const lastSize = profile.preferred_size || channelMemory.last_selected_size || channelMemory.selectedSize || channelMemory.activeSize || conversation?.channel_metadata?.last_size || "";
  const lastProductLabel = lastProduct?.name || lastProduct?.title || lastProduct?.product_name || lastProduct?.id || lastProduct?.product_id || "لا يوجد سياق منتج";
  const escalation = clean(conversation?.escalation_reason || conversation?.ai_escalation_reason);
  const memoryScore = profile.memory_score ?? conversation?.lead_score ?? latestMemory.memory_score ?? 0;
  const lastOrder = asArray(profile.previous_orders)[0] || conversation?.last_order || conversation?.order || null;
  const confirmationMeta = confirmationStatusMeta(lastOrder?.status);
  const handleManualOrderAction = async (action) => {
    if (!lastOrder?.id || !action) return;
    try {
      await api.post(`/whatsapp/order-confirmation/${encodeURIComponent(lastOrder.id)}/action`, { action });
      toast.success(action === "confirm" ? "تم التأكيد من العميل" : action === "edit" ? "العميل طلب تعديل" : "ألغاه العميل");
    } catch (error) {
      toast.error(error?.message || "Failed to update order confirmation");
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/55 p-4">
      <div className="mb-3 flex items-center gap-3">
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-12 w-12 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" /> : <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.07] text-slate-200"><User className="h-5 w-5" /></span>}
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">سياق العميل</div>
          <div className="mt-1 text-lg font-black text-white">{displayFallback(identityName, "No CRM match yet")}</div>
        </div>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Info label="Matched CRM customer" value={profile.id ? `Profile #${profile.id}` : "No CRM match yet"} />
        <Info label="Phone / external ID" value={profile.phone || conversation?.phone || conversation?.external_customer_id || "Not set yet"} />
        <Info label="Channel" value={channelLabel(conversation?.channel || conversation?.source)} />
        <Info label="المقاس المفضل" value={profile.preferred_size || channelMemory.last_selected_size || "غير محدد بعد"} />
        <Info label="آخر منتج" value={lastProductLabel} />
        <Info label="Last intent" value={latest.detected_intent || conversation?.detected_intent || "Not set yet"} />
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Info label="Sentiment" value={profile.customer_sentiment || "neutral"} />
        <Info label="درجة الذاكرة" value={Number(memoryScore || 0).toFixed(0)} />
        <Info label="Last order" value={lastOrder?.invoice_number || lastOrder?.order_number || lastOrder?.id || "No order yet"} />
        <Info label="Last size" value={lastSize || "Not set yet"} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Pill tone={sentimentTone(profile.customer_sentiment)}>{profile.customer_sentiment || "neutral"}</Pill>
        {lastProduct ? <Pill tone="cyan">آخر منتج {lastProductLabel}</Pill> : null}
        {lastOrder ? <Pill tone={confirmationMeta.tone}>{confirmationMeta.label}</Pill> : null}
      </div>
      {lastOrder ? (
        <div className="mb-3 rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Order confirmation</div>
              <div className="mt-1 truncate text-sm font-black text-white">{lastOrder.invoice_number || lastOrder.order_number || lastOrder.id}</div>
              <div className="mt-1 text-xs text-slate-400">{confirmationMeta.label}</div>
            </div>
            <Pill tone={confirmationMeta.tone}>{confirmationMeta.label}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => handleManualOrderAction("confirm")} className="inline-flex items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/15">تأكيد يدوي</button>
            <button type="button" onClick={() => handleManualOrderAction("edit")} className="inline-flex items-center justify-center rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100 transition hover:bg-amber-400/15">تعديل يدوي</button>
            <button type="button" onClick={() => handleManualOrderAction("cancel")} className="inline-flex items-center justify-center rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs font-black text-rose-100 transition hover:bg-rose-400/15">إلغاء يدوي</button>
          </div>
        </div>
      ) : null}
      {needsHumanAttention(conversation) ? (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
          Human mode active{escalation ? ` / ${escalation}` : ""}{conversation?.last_escalation_keyword ? ` / ${conversation.last_escalation_keyword}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function DebugField({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-xs font-black text-slate-100">{clean(value) || "غير معروف"}</div>
    </div>
  );
}

function DebugStatusBadge({ type = "neutral", children }) {
  const tones = {
    sent: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    failed: "border-rose-300/25 bg-rose-400/10 text-rose-100",
    skipped: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    called: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    none: "border-rose-300/25 bg-rose-400/10 text-rose-100",
    neutral: "border-white/10 bg-white/[0.055] text-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${tones[type] || tones.neutral}`}>
      {type === "sent" || type === "called" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {type === "failed" || type === "none" ? <XCircle className="h-3.5 w-3.5" /> : null}
      {type === "skipped" ? <PauseCircle className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

function AiDebugPanel({ open, loading, error, data, onToggle, onRefresh }) {
  const [showRaw, setShowRaw] = useState(false);
  const memory = data?.memory || {};
  const events = asArray(data?.debug_events);
  const confidence = data?.confidence === null || data?.confidence === undefined ? "" : Number(data.confidence).toFixed(2);
  const latestEvent = events[0] || {};
  const visualAttributes = memory.lastVisualAttributes || memory.lastVisualAnalysis || latestEvent.visual_analysis || latestEvent.visual_attributes || {};
  const visualPipeline = latestEvent.visual_pipeline || data?.visual_pipeline || {};
  const visualPro = visualPipeline.visual_search_pro || data?.visual_search_pro || {};
  const visualTopCandidates = asArray(visualPro.top_5_candidates || visualPipeline.top_image_matches || memory.lastVisualMatches).slice(0, 5);
  const visualColors = asArray(visualPro.colors || visualAttributes.primaryColors || visualAttributes.mainColors || visualAttributes.colors).join(", ");
  const preferredSizes = asArray(visualPro.preferredSizes || memory.preferredSizes).join(", ");
  const preferredBrands = asArray(visualPro.preferredBrands || memory.preferredBrands).join(", ");
  const preferredColors = asArray(visualPro.preferredColors || memory.preferredColors).join(", ");
  const unifiedReply = data?.unified_reply || data?.channel_reply || {};
  const unifiedProducts = asArray(unifiedReply.product_cards || data?.suggested_products);
  const unifiedImageCards = asArray(unifiedReply.image_cards || unifiedReply.visual_attachments || data?.visual_attachments);
  const unifiedQuickReplies = asArray(unifiedReply.quick_replies || unifiedReply.suggested_quick_replies);
  const unifiedActions = asArray(unifiedReply.actions || data?.suggested_actions);
  const unifiedHandoff = unifiedReply.handoff || data?.handoff || {};
  const outboundStatus = clean(data?.lastOutboundStatus);
  const outboundDecision = clean(data?.lastOutboundDecision);
  const skipReason = clean(data?.lastOutboundSkipReason);
  const metaSendResult = [
    data?.lastMetaSendCode ? `Meta code ${data.lastMetaSendCode}` : "",
    data?.lastOutboundError ? shortText(data.lastOutboundError, 90) : "",
  ].filter(Boolean).join(" / ");
  const lastReplyPreview = shortText(latestEvent.reply_preview || data?.last_outbound_signature_preview || "", 180);
  const outboundBadgeType = outboundStatus.toLowerCase().includes("fail") || data?.lastOutboundError
    ? "failed"
    : outboundStatus.toLowerCase().includes("skip") || skipReason
      ? "skipped"
      : outboundStatus || outboundDecision.toLowerCase().includes("sent")
        ? "sent"
        : "neutral";
  const outboundBadgeLabel = outboundBadgeType === "failed" ? "فشل" : outboundBadgeType === "skipped" ? "متخطى" : outboundBadgeType === "sent" ? "تم الإرسال" : "غير معروف";
  return (
    <div className="mb-4 rounded-2xl border border-violet-300/15 bg-violet-400/[0.045] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-300/10 text-violet-100 ring-1 ring-violet-300/20"><Brain className="h-4 w-4" /></span>
          <div>
            <div className="text-sm font-black text-white">AI Debug</div>
            <div className="text-xs text-slate-500">Intent, route, memory, and recent decisions</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {open ? (
            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          ) : null}
          <button type="button" onClick={onToggle} className="inline-flex h-9 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 text-xs font-black text-violet-100">
            {open ? <EyeOff className="h-4 w-4" /> : <InfoIcon className="h-4 w-4" />}
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          {error ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
          {loading && !data ? <LoadingBlock text="جارٍ تحميل بيانات التشخيص..." /> : null}
          {data ? (
            <>
              <div className="flex flex-wrap gap-2">
                <DebugStatusBadge type={outboundBadgeType}>{outboundBadgeLabel}</DebugStatusBadge>
                <DebugStatusBadge type={latestEvent.graph_api_called ? "called" : "none"}>{latestEvent.graph_api_called ? "تم استدعاء Graph API" : "لا يوجد استدعاء Graph"}</DebugStatusBadge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <DebugField label="Intent" value={data.current_intent} />
                <DebugField label="Confidence" value={confidence} />
                <DebugField label="Route / brain" value={data.route} />
                <DebugField label="Outbound status" value={outboundStatus} />
                <DebugField label="Outbound decision" value={outboundDecision} />
                <DebugField label="Skip reason" value={skipReason} />
                <DebugField label="Meta send result" value={metaSendResult || (data.tokenPresent === true ? "Token present" : data.tokenPresent === false ? "Token missing" : "")} />
                <DebugField label="Active product" value={memory.activeProductId} />
                <DebugField label="Active size" value={memory.activeSize} />
                <DebugField label="Active color" value={memory.activeColor} />
                <DebugField label="Buying stage" value={memory.buyingStage} />
                <DebugField label="Last reply preview" value={lastReplyPreview} />
                <DebugField label="Unified reply preview" value={data.unified_reply_preview || lastReplyPreview} />
                <DebugField label="Unified intent" value={unifiedReply.intent || data.current_intent || ""} />
                <DebugField label="المنتجات الموحّدة" value={`${unifiedProducts.length} بطاقة`} />
                <DebugField label="بطاقات الصور الموحّدة" value={`${unifiedImageCards.length} بطاقة`} />
                <DebugField label="Unified quick replies" value={`${unifiedQuickReplies.length} items`} />
                <DebugField label="Unified actions" value={`${unifiedActions.length} items`} />
                <DebugField label="Handoff state" value={unifiedHandoff?.needs_human_support ? `handoff / ${unifiedHandoff.reason || "human_review"}` : unifiedHandoff?.conversation_status || "ai_active"} />
                <DebugField label="Visual confidence" value={visualPro.visual_confidence ?? memory.lastVisualConfidence ?? visualAttributes.confidence ?? ""} />
                <DebugField label="Brand guess" value={visualPro.brand_guess || visualAttributes.brand || visualAttributes.brand_guess || ""} />
                <DebugField label="Model guess" value={visualPro.model_guess || visualAttributes.modelFamily || visualAttributes.model_guess || ""} />
                <DebugField label="الألوان" value={visualColors} />
                <DebugField label="Correction used" value={visualPro.correction_used === true ? "true" : visualPro.correction_used === false ? "false" : ""} />
                <DebugField label="Top rank reason" value={visualPro.reason_why_candidate_ranked_first || ""} />
                <DebugField label="درجة تفضيل العميل" value={visualPro.customerPreferenceScore !== undefined ? Number(visualPro.customerPreferenceScore || 0).toFixed(2) : ""} />
                <DebugField label="المقاسات المفضلة" value={preferredSizes} />
                <DebugField label="Preferred brands" value={preferredBrands} />
                <DebugField label="الألوان المفضلة" value={preferredColors} />
                <DebugField label="Boost reason" value={visualPro.why_candidate_was_boosted || ""} />
              </div>

              {visualTopCandidates.length ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                  <SectionTitle icon={Brain} title="Visual candidates" />
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {visualTopCandidates.map((candidate, index) => {
                      const breakdown = candidate?.score_breakdown || candidate?.breakdown || {};
                      return (
                        <div key={`${candidate?.product_id || candidate?.productId || "candidate"}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-slate-100">#{index + 1} منتج {candidate?.product_id || candidate?.productId || "غير معروف"}</span>
                            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[11px] font-black text-cyan-100">{Number(candidate?.score || candidate?.finalScore || breakdown.finalScore || 0).toFixed(2)}</span>
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <DebugField label="Variant" value={candidate?.variant_id || candidate?.variantId || ""} />
                            <DebugField label="Color" value={candidate?.color || ""} />
                            <DebugField label="Source image product" value={candidate?.sourceImageProductId || candidate?.source_image_product_id || candidate?.product_id || candidate?.productId || ""} />
                            <DebugField label="Source title" value={candidate?.sourceTitle || candidate?.source_title || ""} />
                            <DebugField label="Final title" value={candidate?.finalTitle || candidate?.final_title || ""} />
                            <DebugField label="Final URL" value={candidate?.finalUrl || candidate?.final_url || ""} />
                            <DebugField label="Score breakdown" value={shortText(JSON.stringify(breakdown), 220)} />
                            <DebugField label="Rank reason" value={breakdown.reasonWhyRankedFirst || candidate?.reasonWhyRankedFirst || ""} />
                            <DebugField label="Preference score" value={breakdown.customerPreferenceScore !== undefined ? Number(breakdown.customerPreferenceScore || 0).toFixed(2) : ""} />
                            <DebugField label="Boosted by" value={breakdown.whyCandidateWasBoosted || candidate?.whyCandidateWasBoosted || ""} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {unifiedProducts.length || unifiedImageCards.length || unifiedQuickReplies.length || unifiedActions.length ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                  <SectionTitle icon={MessageSquareText} title="Unified reply payload" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {unifiedProducts.length ? <DebugField label="بطاقات المنتجات" value={unifiedProducts.slice(0, 3).map((item) => item.name || item.title || item.product_name || item.id || "").filter(Boolean).join(" آ· ") || `${unifiedProducts.length} بطاقة`} /> : null}
                    {unifiedImageCards.length ? <DebugField label="بطاقات الصور" value={unifiedImageCards.slice(0, 3).map((item) => item.title || item.name || item.subtitle || item.url || "").filter(Boolean).join(" آ· ") || `${unifiedImageCards.length} بطاقة`} /> : null}
                    {unifiedQuickReplies.length ? <DebugField label="Quick replies" value={unifiedQuickReplies.slice(0, 4).map((item) => item.label || item.text || item.title || item).filter(Boolean).join(" آ· ") || `${unifiedQuickReplies.length} items`} /> : null}
                    {unifiedActions.length ? <DebugField label="Actions" value={unifiedActions.slice(0, 4).map((item) => item.label || item.text || item.title || item.action || item.type || item).filter(Boolean).join(" آ· ") || `${unifiedActions.length} items`} /> : null}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                <SectionTitle icon={Clock3} title="Recent AI decisions" />
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {events.length ? events.map((event, index) => {
                    const eventStatus = event.skip_reason || event.skipped_duplicate ? "skipped" : event.graph_api_called ? "sent" : "neutral";
                    const eventDecision = event.skip_reason || event.handled_reason || (event.graph_api_called ? "sent_to_meta" : "no_outbound_call");
                    return (
                      <div key={`${event.timestamp || "event"}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-500">{absoluteTime(event.timestamp) || "وقت غير معروف"}</span>
                          <DebugStatusBadge type={event.graph_api_called ? "called" : "none"}>{event.graph_api_called ? "تم استدعاء Graph API" : "لا يوجد استدعاء Graph"}</DebugStatusBadge>
                          {eventStatus === "skipped" ? <DebugStatusBadge type="skipped">متخطى</DebugStatusBadge> : eventStatus === "sent" ? <DebugStatusBadge type="sent">تم الإرسال</DebugStatusBadge> : null}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <DebugField label="Intent" value={event.classified_intent} />
                          <DebugField label="Route" value={event.selected_route} />
                          <DebugField label="Confidence" value={event.confidence !== null && event.confidence !== undefined ? Number(event.confidence).toFixed(2) : ""} />
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <DebugField label="حالة الإرسال" value={eventStatus === "neutral" ? "لا يوجد استدعاء Graph" : eventStatus} />
                          <DebugField label="Outbound decision" value={eventDecision} />
                        </div>
                        {event.reply_preview ? <p className="mt-2 rounded-lg bg-cyan-300/5 p-2 text-xs leading-5 text-cyan-100" dir={isRtlText(event.reply_preview) ? "rtl" : "auto"}>{shortText(event.reply_preview, 180)}</p> : null}
                      </div>
                    );
                  }) : <EmptyBlock text="لم يتم حفظ أي قرارات تشخيص لهذه المحادثة بعد." />}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                <button type="button" onClick={() => setShowRaw((value) => !value)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100">
                  {showRaw ? <EyeOff className="h-4 w-4" /> : <InfoIcon className="h-4 w-4" />}
                  {showRaw ? "Hide raw debug" : "Show raw debug"}
                </button>
                {showRaw ? (
                  <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-white/10 bg-black/35 p-3 text-[11px] leading-5 text-slate-300">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TraceJsonBlock({ value }) {
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-200">
      {JSON.stringify(value || {}, null, 2)}
    </pre>
  );
}

function AiTraceModal({ open, loading, error, data, onClose, onRefresh }) {
  if (!open) return null;
  const latestTrace = data?.latestTrace || asArray(data?.traces)[0] || null;
  const steps = asArray(latestTrace?.trace?.steps);
  const summary = latestTrace?.trace?.summary || {};
  const statusTone = latestTrace?.status === "failed" ? "rose" : latestTrace?.status === "finished" ? "emerald" : "amber";
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 p-3 backdrop-blur-sm md:p-6">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-cyan-100">
              <Brain className="h-4 w-4" />
              أثر الذكاء الاصطناعي
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {latestTrace ? `${latestTrace.channel} / ${latestTrace.session_id} / ${absoluteTime(latestTrace.created_at)}` : "سجل أحدث قرار لرد الذكاء الاصطناعي"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {latestTrace ? <Pill tone={statusTone}>{latestTrace.status || "running"}</Pill> : null}
            <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <button type="button" onClick={onClose} className="h-9 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10">Close</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
          {loading && !latestTrace ? <LoadingBlock text="جارٍ تحميل تتبع الذكاء الاصطناعي..." /> : null}
          {!loading && !latestTrace ? <EmptyBlock text="لم يتم تسجيل أي تتبع للذكاء الاصطناعي لهذه المحادثة بعد." /> : null}
          {latestTrace ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <DebugField label="Trace ID" value={latestTrace.id} />
                <DebugField label="External message" value={latestTrace.external_message_id} />
                <DebugField label="Summary" value={shortText(JSON.stringify(summary), 180)} />
              </div>
              {latestTrace.error ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-rose-100">Trace error</div>
                  <TraceJsonBlock value={latestTrace.error} />
                </div>
              ) : null}
              <div className="space-y-3">
                {steps.map((step, index) => {
                  const selectedIds = asArray(step?.data?.selected_product_ids);
                  const rejectedIds = asArray(step?.data?.rejected_product_ids);
                  return (
                    <div key={`${step.step || "step"}-${step.at || index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-300/10 text-xs font-black text-cyan-100 ring-1 ring-cyan-300/20">{index + 1}</span>
                          <div>
                            <div className="text-sm font-black text-white">{step.step || "trace_step"}</div>
                            <div className="text-[11px] font-bold text-slate-500">{absoluteTime(step.at)}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
          {selectedIds.length ? <Pill tone="emerald">المحدد {selectedIds.join(", ")}</Pill> : null}
                          {rejectedIds.length ? <Pill tone="amber">Rejected {rejectedIds.length}</Pill> : null}
                        </div>
                      </div>
                      <TraceJsonBlock value={step.data} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CustomerProfilePanel({ conversation, canSyncMessenger = false, syncing = false, onSyncMessengerProfile }) {
  const profile = conversation?.customer_profile || {};
  const identityName = isMessengerConversation(conversation) ? messengerDisplayName(conversation) : getConversationDisplayName(conversation);
  const avatarUrl = customerAvatarUrl(conversation);
  const crmLabel = profile.id ? `#${profile.id}` : "";
  const channel = conversation?.channel || conversation?.source || "web_chat";
  const channelName = getConversationSourceLabel(conversation);
  const cityName = clean(profile.city || profile.city_area || "");
  const lastOrder = asArray(profile.previous_orders)[0] || conversation?.last_order || conversation?.order || null;
  const confirmationMeta = confirmationStatusMeta(lastOrder?.status);
  const handleManualOrderAction = async (action) => {
    if (!lastOrder?.id || !action) return;
    try {
      await api.post(`/whatsapp/order-confirmation/${encodeURIComponent(lastOrder.id)}/action`, { action });
      toast.success(action === "confirm" ? "تم تأكيد الطلب" : action === "edit" ? "تم تسجيل طلب التعديل" : "تم إلغاء الطلب");
    } catch (error) {
      toast.error(error?.message || "Failed to update order confirmation");
    }
  };
  return (
    <aside className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-2.5">
          <div className="flex flex-row-reverse items-start gap-2.5">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
            ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-slate-200">
              <User className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="truncate text-[15px] font-black leading-5 text-white">{identityName || "عميل غير معروف"}</div>
              <Pill tone={isWhatsappChannel(channel) ? "emerald" : "cyan"}>{channelName}</Pill>
            </div>
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-2.5 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">CRM</div>
            <div className="min-w-0 text-right text-[12px] font-black leading-5 text-white">{crmLabel || "—"}</div>
          </div>
          {cityName ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-2.5 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Location</div>
              <div className="min-w-0 text-right text-[12px] font-black leading-5 text-white">{cityName}</div>
            </div>
          ) : null}
        </div>
      </div>
      {lastOrder ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Order confirmation</div>
              <div className="mt-1 truncate text-sm font-black text-white">{lastOrder.invoice_number || lastOrder.order_number || lastOrder.id}</div>
              <div className="mt-1 text-xs text-slate-300">{confirmationMeta.label}</div>
            </div>
            <Pill tone={confirmationMeta.tone}>{confirmationMeta.label}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => void handleManualOrderAction("confirm")} className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-2 text-[11px] font-black text-emerald-100">تأكيد يدوي</button>
            <button type="button" onClick={() => void handleManualOrderAction("edit")} className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 py-2 text-[11px] font-black text-amber-100">تعديل يدوي</button>
            <button type="button" onClick={() => void handleManualOrderAction("cancel")} className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-2.5 py-2 text-[11px] font-black text-rose-100">إلغاء يدوي</button>
          </div>
        </div>
      ) : null}
      <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">مزيد من ذاكرة العميل</summary>
        <div className="mt-3 space-y-2">
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">المقاس المفضل</div>
            <div className="mt-1 text-sm font-black text-white">{profile.preferred_size || "غير معروف"}</div>
          </div>
          <TagRow label="الألوان" values={profile.preferred_colors} />
          <TagRow label="Models" values={profile.preferred_models} />
          <Info label="Memory score" value={profile.memory_score ?? conversation?.lead_score ?? 0} />
          <MiniList title="Viewed products" items={asArray(profile.viewed_products)} empty="No viewed products." />
          <MiniList title="Abandoned products" items={asArray(profile.abandoned_products)} empty="No abandoned products." />
          <MiniList title="Previous orders" items={asArray(profile.previous_orders)} empty="No previous orders in memory." />
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
            <SectionTitle icon={MessageSquareText} title="المشاعر والذاكرة" />
            <div className="mb-3 flex flex-wrap gap-2">
              <Pill tone={sentimentTone(profile.customer_sentiment)}>{profile.customer_sentiment || "neutral"}</Pill>
              {asArray(profile.sentiment_history).length ? <Pill tone="violet">{asArray(profile.sentiment_history).length} history</Pill> : null}
            </div>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {asArray(profile.memory_notes).length ? asArray(profile.memory_notes).slice(0, 12).map((note) => <div key={note.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">{note.key || note.type}: {JSON.stringify(note.value || {})}</div>) : <div className="text-sm text-slate-500">{profile.conversation_summary || "No memory notes yet."}</div>}
            </div>
          </div>
        </div>
      </details>
    </aside>
  );
}

function Info({ label, value, fallback = "Not set yet" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-white">{clean(value) || fallback}</div>
    </div>
  );
}

function TagRow({ label, values = [] }) {
  const items = asArray(values).filter(Boolean);
  return (
    <div>
      <div className="mb-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.slice(0, 8).map((item) => <Pill key={item}>{item}</Pill>) : <span className="text-sm text-slate-500">Not set yet</span>}
      </div>
    </div>
  );
}

function MiniList({ title, items = [], empty }) {
  const list = asArray(items);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle icon={ShoppingBag} title={title} />
      <div className="space-y-2">
        {list.length ? list.slice(0, 5).map((item, index) => (
          <div key={item.id || item.order_id || item.name || index} className="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm">
            <div className="font-black text-white">{item.name || item.product_name || item.invoice_number || item.id || "Item"}</div>
            {item.price || item.total_amount ? <div className="mt-1 text-xs text-emerald-100">{money(item.price || item.total_amount)}</div> : null}
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-3 text-sm text-slate-500">{empty}</div>}
      </div>
    </div>
  );
}

function OrderDraftPanel({ conversation, drafts, onAction, busy }) {
  const conversationDrafts = asArray(conversation?.draft_orders);
  const visibleDrafts = conversationDrafts.length ? conversationDrafts : asArray(drafts).slice(0, 4);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle icon={ShoppingCart} title="Order draft panel" />
      <div className="space-y-3">
        {visibleDrafts.length ? visibleDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} onAction={onAction} busy={busy} />) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No draft for this conversation.</div>}
      </div>
    </div>
  );
}

function DraftCard({ draft, onAction, busy }) {
  const item = asArray(draft.items)[0] || {};
  const metadata = draft.ai_agent_metadata || {};
  const stockStatus = item.stock_status || metadata.stock_status || "unknown";
  const confidence = Number(draft.ai_agent_confidence || metadata.confidence || 0);
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-black text-white">{draft.invoice_number || `AI-${draft.id}`}</div>
          <div className="mt-1 text-sm text-slate-400">{draft.customer_name || "Customer"} / {draft.customer_phone || "No phone"}</div>
        </div>
        <Pill tone={draft.ai_agent_status === "confirmed" ? "emerald" : draft.ai_agent_status === "cancelled" ? "rose" : draft.ai_agent_status === "human_handoff" ? "amber" : "cyan"}>{draft.ai_agent_status || draft.status}</Pill>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-slate-300">
        <Info label="المنتج" value={item.product_name || metadata.product_name || "غير معروف"} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Info label="المتغير / المقاس / اللون" value={item.variant_name || [metadata.size, metadata.color].filter(Boolean).join(" / ") || "غير معروف"} />
          <Info label="Quantity" value={item.quantity || metadata.quantity || 1} />
          <Info label="Price" value={money(item.price || draft.total_amount || draft.total || item.total_amount)} />
          <Info label="Stock" value={stockStatus} />
          <Info label="Confidence" value={confidence ? confidence.toFixed(2) : "n/a"} />
          <Info label="Customer data" value={[draft.customer_name, draft.customer_phone, draft.city_area || draft.governorate].filter(Boolean).join(" / ") || "Incomplete"} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onAction(draft, "confirm")} disabled={busy || draft.ai_agent_status !== "ai_draft"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 text-xs font-black text-slate-950 disabled:opacity-50"><PackageCheck className="h-4 w-4" />Confirm Order</button>
        <button type="button" onClick={() => { window.location.href = `/orders/${draft.id}`; }} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-white"><ArrowUpRight className="h-4 w-4" />Edit Draft</button>
        <button type="button" onClick={() => onAction(draft, "cancelled")} disabled={busy || draft.ai_agent_status === "confirmed"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50"><XCircle className="h-4 w-4" />Reject / Cancel</button>
        <button type="button" onClick={() => onAction(draft, "human_handoff")} disabled={busy || draft.ai_agent_status === "confirmed"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50"><Handshake className="h-4 w-4" />Assign to human</button>
        <button type="button" onClick={() => onAction(draft, "ai_draft")} disabled={busy || draft.ai_agent_status === "confirmed"} className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><Bot className="h-4 w-4" />Resume AI</button>
      </div>
    </div>
  );
}

function SalesIntelligencePanel({ conversation = {}, recommendationIntel = null, salesCloserPlan = {} }) {
  const state = conversation.sales_conversation_state || conversation.sales_intelligence?.state || {};
  const journeyEvents = asArray(conversation.sales_journey_events || conversation.sales_intelligence?.journeyEvents);
  const conversion = conversation.conversion_probability || conversation.sales_intelligence?.conversion || recommendationIntel?.conversion_probability || {};
  const followUp = conversation.follow_up_recommendation || conversation.sales_intelligence?.followUp || recommendationIntel?.follow_up_recommendation || {};
  const suggestions = asArray(conversation.cross_sell_suggestions || conversation.sales_intelligence?.crossSellSuggestions || recommendationIntel?.cross_sell_suggestions || salesCloserPlan.cross_sell_suggestions);
  const stateBadge = state.badge || {};
  const stateReasonLabel = clean(state.state_reason || "").replace(/_/g, " ");
  const objectionLabel = state.current_state === "OBJECTION_HANDLING" || /price_or_value_objection/i.test(clean(state.state_reason || ""))
    ? "اعتراض على السعر"
    : "";
  const score = Number(conversion.score || 0);
  const scoreLevel = clean(conversion.level || "").replace(/_/g, " ");
  const reasons = asArray(conversion.reasons);
  const risks = asArray(conversion.risk_flags);
  const eventLabels = {
    PRODUCT_VIEWED: "تمت مشاهدة المنتج",
    PRODUCT_MATCHED: "تطابق المنتج",
    PRICE_ASKED: "تم سؤال السعر",
    SIZE_ASKED: "تم سؤال المقاس",
    SIZE_SELECTED: "تم اختيار المقاس",
    COLOR_SELECTED: "تم اختيار اللون",
    IMAGES_REQUESTED: "تم طلب الصور",
    ALTERNATIVE_REQUESTED: "تم طلب بديل",
    OBJECTION_PRICE: "اعتراض على السعر",
    DRAFT_ORDER_CREATED: "تم إنشاء المسودة",
    PAYMENT_LINK_SENT: "تم إرسال رابط الدفع",
    PAYMENT_PROOF_REQUESTED: "تم طلب إثبات الدفع",
    ORDER_CONFIRMED: "Order confirmed",
    FOLLOW_UP_SENT: "Follow-up suggested",
    HUMAN_TAKEOVER_STARTED: "Human takeover",
    HUMAN_TAKEOVER_ENDED: "Back to AI",
    STATE_CHANGED: "State changed",
  };

  return (
    <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-4">
      <SectionTitle icon={BadgePercent} title="Sales intelligence" />
      <div className="flex flex-wrap gap-2">
        <Pill tone={stateBadge.tone || "cyan"}>{stateBadge.label || state.current_state || "DISCOVERY"}</Pill>
        {objectionLabel ? <Pill tone="amber">{objectionLabel}</Pill> : null}
        {state.state_reason && !objectionLabel ? <Pill tone="zinc">{stateReasonLabel}</Pill> : null}
        {state.confidence ? <Pill tone="zinc">{Math.round(Number(state.confidence || 0) * 100)}% confidence</Pill> : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-white">Conversion probability</div>
            <Pill tone={score >= 85 ? "emerald" : score >= 65 ? "cyan" : score >= 40 ? "amber" : "rose"}>{score}/100</Pill>
          </div>
          <div className="mt-2 text-2xl font-black text-white">{scoreLevel || "low"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reasons.slice(0, 3).map((reason) => <Pill key={reason} tone="zinc">{reason}</Pill>)}
          </div>
          {risks.length ? <div className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500">Risk flags</div> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {risks.slice(0, 3).map((risk) => <Pill key={risk} tone="amber">{risk}</Pill>)}
          </div>
          {conversion.recommended_action ? <div className="mt-3 text-sm text-slate-300">الإجراء الموصى به: <span className="font-black text-white">{conversion.recommended_action}</span></div> : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-white">Follow-up</div>
            <Pill tone={followUp.follow_up_needed ? "amber" : "zinc"}>{followUp.follow_up_needed ? "Needed" : "Not needed"}</Pill>
          </div>
          {followUp.follow_up_reason ? <div className="mt-2 text-sm text-slate-300">{followUp.follow_up_reason}</div> : <div className="mt-2 text-sm text-slate-500">No follow-up recommendation right now.</div>}
          {followUp.suggested_follow_up_message ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-slate-100">{followUp.suggested_follow_up_message}</div> : null}
          {followUp.suggested_follow_up_at ? <div className="mt-3 text-xs font-bold text-slate-500">Suggested at {absoluteTime(followUp.suggested_follow_up_at)}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-white">Sales journey</div>
            <Pill tone="zinc">{journeyEvents.length} events</Pill>
          </div>
          <div className="mt-3 space-y-2">
            {journeyEvents.length ? journeyEvents.slice(0, 5).map((event, index) => (
              <div key={`${event.event_type}-${event.created_at}-${index}`} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-white">{eventLabels[event.event_type] || event.event_type}</div>
                  {event.metadata?.message ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{String(event.metadata.message)}</div> : null}
                </div>
                <div className="shrink-0 text-[11px] font-bold text-slate-500">{relativeTime(event.created_at)}</div>
              </div>
            )) : <div className="text-sm text-slate-500">No sales journey events yet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-white">Cross-sell / Upsell</div>
            <Pill tone="zinc">{suggestions.length}</Pill>
          </div>
          <div className="mt-3 space-y-2">
            {suggestions.length ? suggestions.slice(0, 4).map((item, index) => (
              <div key={`${item.product_id || item.type || index}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-white">{item.type || "suggestion"}</div>
                  <Pill tone="cyan">{Math.round(Number(item.confidence || 0) * 100)}%</Pill>
                </div>
                <div className="mt-1 text-xs text-slate-400">{item.reason || "catalog suggestion"}</div>
                {item.suggested_message ? <div className="mt-2 text-sm leading-6 text-slate-200">{item.suggested_message}</div> : null}
              </div>
            )) : <div className="text-sm text-slate-500">No cross-sell suggestions right now.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RightToolsTabsPanel({
  activeTab,
  onTabChange,
  conversation,
  channelStatus = {},
  loading = false,
  assignName = "",
  onAssignNameChange,
  onAction,
  mode,
  onModeChange,
  modeSaving = false,
  recommendations,
  salesCloser,
  drafts = [],
  onRefreshRecommendations,
  onQuickSend,
  onSendImages,
  onCreateDraft,
  onRefreshSalesCloser,
  onTakeover,
  onUseText,
  onPaymentAction,
  onOpenAiTrace,
  aiTrace,
  onSyncMessengerProfile,
  profileSyncing = false,
  onDebugMessengerProfile,
  profileDebugging = false,
  onResetAiState,
  resettingAiState = false,
}) {
  if (!conversation) return null;
  const profile = conversation.customer_profile || {};
  const notes = asArray(profile.memory_notes);
  const tabItems = [
    { key: "customer", label: "Customer", icon: User },
    { key: "ai", label: "AI", icon: Bot },
    { key: "orders", label: "Orders", icon: ShoppingCart },
    { key: "notes", label: "Notes", icon: MessageSquareText },
  ];

  return (
    <aside className="hidden h-full w-[280px] max-w-[280px] shrink-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] xl:flex">
      <div className="shrink-0 border-b border-white/10 p-2">
        <div className="grid grid-cols-2 gap-1">
          {tabItems.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border px-2 text-[11px] font-black transition ${
                  active ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-slate-950/55 text-slate-200 hover:border-white/20"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {activeTab === "customer" ? (
          <div className="space-y-3">
            <CustomerProfilePanel
              conversation={conversation}
              canSyncMessenger={canSyncMessengerProfile(conversation)}
              syncing={profileSyncing}
              onSyncMessengerProfile={onSyncMessengerProfile}
            />
          </div>
        ) : null}

        {activeTab === "ai" ? (
          <div className="space-y-3">
            <ConversationActions
              conversation={conversation}
              channelStatus={channelStatus}
              loading={loading}
              assignName={assignName}
              onAssignNameChange={onAssignNameChange}
              onAction={onAction}
            />
            <AutoReplyModePanel
              channelStatus={channelStatus}
              mode={mode}
              onChange={onModeChange}
              saving={modeSaving}
            />
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <SectionTitle icon={Bot} title="محرك رد الذكاء الاصطناعي" action={aiTrace?.loading ? <Pill tone="cyan">جاري الكتابة...</Pill> : null} />
              <div className="mt-3 grid gap-2">
                <button type="button" onClick={() => onOpenAiTrace?.()} disabled={aiTrace?.loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">
                  {aiTrace?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                  أثر الذكاء الاصطناعي
                </button>
                <button type="button" onClick={() => onSyncMessengerProfile?.()} disabled={profileSyncing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50">
                  {profileSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  مزامنة ملف ماسنجر
                </button>
                <button type="button" onClick={() => onDebugMessengerProfile?.()} disabled={profileDebugging} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50">
                  {profileDebugging ? <Loader2 className="h-4 w-4 animate-spin" /> : <InfoIcon className="h-4 w-4" />}
                  تشخيص ملف ماسنجر
                </button>
                <button type="button" onClick={() => onResetAiState?.()} disabled={resettingAiState} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50">
                  {resettingAiState ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  إعادة ضبط حالة الذكاء الاصطناعي
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "orders" ? (
          <div className="space-y-3">
            <RecommendationsPanel
              products={recommendations?.sessionId === conversation.session_id ? recommendations.products : []}
              loading={recommendations?.loading}
              onRefresh={onRefreshRecommendations}
              onQuickSend={onQuickSend}
              onSendImages={onSendImages}
              onCreateDraft={onCreateDraft}
            />
            <OrderDraftPanel
              conversation={conversation}
              drafts={conversation?.draft_orders?.length ? conversation.draft_orders : drafts}
              onAction={onPaymentAction}
              busy={loading}
            />
          </div>
        ) : null}

        {activeTab === "notes" ? (
          <div className="space-y-3">
            <SalesIntelligencePanel
              conversation={conversation}
              recommendationIntel={recommendations?.sessionId === conversation.session_id ? recommendations.intelligence : null}
              salesCloserPlan={salesCloser?.sessionId === conversation.session_id ? salesCloser.plan : {}}
            />
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <SectionTitle icon={MessageSquareText} title="Notes" />
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Summary</div>
                  <div className="mt-1 text-sm font-black leading-6 text-white">{profile.conversation_summary || conversation.customer_note || "No notes yet."}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Recent memory notes</div>
                  <div className="mt-2 space-y-2">
                    {notes.length ? notes.slice(0, 5).map((note) => (
                      <div key={note.id || note.key || JSON.stringify(note)} className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs leading-5 text-slate-300">
                        {note.key || note.type || "note"}: {JSON.stringify(note.value || {})}
                      </div>
                    )) : <div className="text-sm text-slate-500">No memory notes yet.</div>}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Customer snapshot</div>
                  <div className="mt-2 space-y-1 text-sm text-slate-300">
                    <div className="font-black text-white">{getConversationDisplayName(conversation) || "Customer"}</div>
                    <div dir="ltr">{clean(conversation.phone || conversation.customer_phone || conversation.external_customer_id || conversation.customer_profile?.phone) || "No phone"}</div>
                    <div>{channelLabel(conversation.channel || conversation.source)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default function AiInbox() {
  const navigate = useNavigate();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const pageVisible = usePageVisible();
  const realtimeStatus = useRealtimeStatus();
  const socketHealthy = realtimeStatus.connected && !realtimeStatus.connecting;
  const [filter, setFilter] = useState("all");
  const [messagePlatformFilter, setMessagePlatformFilter] = useState("all");
  const [commentPlatformFilter, setCommentPlatformFilter] = useState("all");
  const [leadFilter, setLeadFilter] = useState("all");
  const [leadSort, setLeadSort] = useState("recent");
  const [favoriteFilter, setFavoriteFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [mobileView, setMobileView] = useState("list");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSocialCommentId, setSelectedSocialCommentId] = useState("");
  const [inbox, setInbox] = useState({ conversations: [], followups: [] });
  const [drafts, setDrafts] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [channelStatus, setChannelStatus] = useState({});
  const [aiAssistantGlobalEnabled, setAiAssistantGlobalEnabled] = useState(true);
  const [aiAssistantGlobalSaving, setAiAssistantGlobalSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [recommendations, setRecommendations] = useState({ sessionId: "", products: [], intelligence: null, loading: false });
  const [salesCloser, setSalesCloser] = useState({ sessionId: "", plan: {}, loading: false });
  const [aiReply, setAiReply] = useState({ sessionId: "", text: "", loading: false, error: "", validation: null, confidence_engine: null });
  const [modeSaving, setModeSaving] = useState(false);
  const [unseenSessions, setUnseenSessions] = useState([]);
  const [toolsTab, setToolsTab] = useState("customer");
  const [profileOpen, setProfileOpen] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(min-width: 1440px)").matches
  ));
  const showLegacyProfileOverlay = false;
  const [customerDrawer, setCustomerDrawer] = useState({ open: false, customer: null, customerId: "", context: {} });
  const [orderComposerOpen, setOrderComposerOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  useEffect(() => {
    const handleCustomerAction = () => {
      window.setTimeout(() => {
        const editor = document.querySelector('[data-ai-inbox-composer="true"]');
        editor?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        editor?.focus?.();
      }, 80);
    };
    window.addEventListener("m1:ai-inbox-customer-action", handleCustomerAction);
    return () => window.removeEventListener("m1:ai-inbox-customer-action", handleCustomerAction);
  }, []);
  useEffect(() => {
    const handleMessageReply = (event) => {
      const sender = clean(event?.detail?.sender || "الرسالة");
      const quotedText = clean(event?.detail?.text).replace(/\s+/g, " ").slice(0, 240);
      if (!quotedText) return;
      setReplyText(`↪ ${sender}: ${quotedText}\n\n`);
      window.setTimeout(() => {
        const editor = document.querySelector('[data-ai-inbox-composer="true"]');
        editor?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        editor?.focus?.();
      }, 80);
    };
    window.addEventListener("m1:ai-inbox-message-reply", handleMessageReply);
    return () => window.removeEventListener("m1:ai-inbox-message-reply", handleMessageReply);
  }, []);
  const [editingAiDraft, setEditingAiDraft] = useState(false);
  const [dismissedAiSuggestionKey, setDismissedAiSuggestionKey] = useState("");
  // Phase 11.2 — employee control over the grounded product attachment on the suggestion.
  const [suggestionProductRemoved, setSuggestionProductRemoved] = useState(false);
  const [suggestionChosenCard, setSuggestionChosenCard] = useState(null);
  // Phase 13.4 — RECOMMENDATION multi-select. When the grounded suggestion is a recommendation batch
  // (send_package.selection_semantics === "recommendation") the operator may pick up to MAX_BATCH_PRODUCTS
  // grounded products to send together with the approved reply. Ordered, canonical-identity keyed, and scoped to
  // the current draft (reset by the activeAiSuggestionKey effect). Identity disambiguation stays single-select.
  const [suggestionRecommendationCards, setSuggestionRecommendationCards] = useState([]);
  // Phase 11.2 — inline edit buffer for the AI suggestion (separate from the manual composer).
  const [aiSuggestionEditText, setAiSuggestionEditText] = useState("");
  const [availableBySizeSending, setAvailableBySizeSending] = useState(false);
  const [productCardPickerConfig, setProductCardPickerConfig] = useState({ open: false, sizeMode: false, allowMultiple: false, selectMode: false });
  const [productCardSending, setProductCardSending] = useState(false);
  const [assignNameDraft, setAssignNameDraft] = useState({ sessionId: "", value: "" });
  const [leadAssignEmployeeId, setLeadAssignEmployeeId] = useState("");
  const [leadActionLoading, setLeadActionLoading] = useState("");
  const [socialComments, setSocialComments] = useState({ items: [], loading: false, error: "" });
  const [socialReplySettings, setSocialReplySettings] = useState({
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
  });
  const [selectedSocialThread, setSelectedSocialThread] = useState({ post: null, comments: [], loading: false, error: "" });
  const [selectedSocialTemplate, setSelectedSocialTemplate] = useState({ template: null, loading: false, error: "" });
  const [socialCommentActionLoading, setSocialCommentActionLoading] = useState("");
  const [socialCommentsFilter, setSocialCommentsFilter] = useState("all");
  const [socialCommentsDebug, setSocialCommentsDebug] = useState({ request_url: "", tenant_id: "", status: "", count: "", error: "" });
  const [inboxSection, setInboxSection] = useState("conversations");
  const [aiDebug, setAiDebug] = useState({ sessionId: "", open: false, loading: false, data: null, error: "" });
  const [aiTrace, setAiTrace] = useState({ sessionId: "", open: false, loading: false, data: null, error: "" });
  const [profileSyncing, setProfileSyncing] = useState(false);
  const [profileDebugging, setProfileDebugging] = useState(false);
  const [resettingAiState, setResettingAiState] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [correctionModal, setCorrectionModal] = useState({ open: false, draft: buildReplyCorrectionDraft() });
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [leadFunnelExpanded, setLeadFunnelExpanded] = useState(false);
  const [isConversationExpanded, setIsConversationExpanded] = useState(false);
  // The element handed to the Fullscreen API — the same wrapper that becomes the
  // full-viewport overlay, so expanded styling and real fullscreen agree.
  const fullscreenHostRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ tone: "", text: "" });
  const [userIsNearBottom, setUserIsNearBottom] = useState(true);
  const pollIntervalRef = useRef(null);
  const requestSeqRef = useRef(0);
  const socialWorkspaceLoadSeqRef = useRef(0);
  const socialWorkspaceLoadStartRef = useRef(0);
  const socialWorkspaceLoadKeyRef = useRef("");
  const isRefreshingRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  // Threads already primed from the shared cache, and threads already
  // revalidated against the server this session (one revalidation per thread,
  // so a failing hydrate can never become a retry loop).
  const cachePrimedThreadsRef = useRef(new Set());
  const hydratedThreadsRef = useRef(new Set());
  // Timestamp of the last successful list load — powers the focus/visibility
  // freshness window (the ERP shell emits far more visibility events than the PWA).
  const lastListLoadAtRef = useRef(0);
  // In-flight guards for send (double-click must produce exactly one request).
  const sendingReplyRef = useRef(false);
  const sendingProductCardsRef = useRef(false);
  const isHydratingConversationRef = useRef(false);
  const isAppendingNewMessageRef = useRef(false);
  const previousConversationKeyRef = useRef("");
  const refreshQueueRef = useRef(null);
  const requestRefreshRef = useRef(null);
  const refreshStateRef = useRef({
    pageVisible: false,
    socketHealthy: false,
  });

  const openCustomerDrawer = useCallback((customer = {}, context = {}) => {
    const customerProfile = customer?.customer_profile || customer?.profile || {};
    const channelMetadata = customer?.channel_metadata || {};
    const customerId = clean(
      customer360Identifier(customer) ||
        context.customerId ||
        customer.customer_id ||
        customer.erp_customer_id ||
        customer.phone ||
        customerProfile.phone ||
        channelMetadata.resolved_phone ||
        channelMetadata.phone ||
        customer.external_customer_id ||
        customer.session_id ||
        customer.conversation_id ||
        customer.commenter_id ||
        ""
    );
    setCustomerDrawer({
      open: true,
      customer: {
        ...customer,
        id: customerId,
        customer_name:
          firstUsefulCustomerName(customer.customer_name, customer.commenter_name, customer.author_name, customer.from_name, customerProfile.name, customerProfile.display_name) ||
          "Customer",
        customer_avatar_url: clean(customer.customer_avatar_url || customer.commenter_profile_picture_url || customerProfile.avatar_url || customerProfile.profile_pic_url || ""),
        platform: clean(customer.platform || context.platform || customerProfile.platform || ""),
        customer_profile: customerProfile,
        external_customer_id: clean(customer.external_customer_id || customerProfile.external_customer_id || ""),
      },
      customerId,
      context: {
        platform: clean(context.platform || customer.platform || ""),
        postId: clean(context.postId || customer.post_id || customer.postId || ""),
        commentId: clean(context.commentId || customer.comment_id || customer.commentId || ""),
        pageId: clean(context.pageId || customer.page_id || customer.pageId || ""),
        source: clean(context.source || customer.source || "conversation"),
        lastActiveAt: clean(context.lastActiveAt || customer.last_message_at || customer.last_activity_at || customer.updated_at || ""),
        summary: clean(context.summary || customer.latest_message_preview || customer.summary || ""),
        customerName: clean(customer.customer_name || customer.commenter_name || customer.author_name || customer.from_name || ""),
      },
    });
  }, []);
  const previousLatestMessageKeyRef = useRef("");
  const restoreScrollStateRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const pinToBottomAfterRefreshRef = useRef(false);
  const messengerProfileSyncAttemptedRef = useRef(new Set());
  const selectedSessionIdRef = useRef("");
  const selectedSocialCommentIdRef = useRef("");
  const selectedSocialCommentFetchKeyRef = useRef("");
  const markReadSignatureRef = useRef("");
  const inboxSectionRef = useRef(inboxSection);
  const selectedConversationCacheRef = useRef(null);
  const lastEnabledAutoReplyModeRef = useRef({});

  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);
  useEffect(() => {
    selectedSocialCommentIdRef.current = selectedSocialCommentId;
  }, [selectedSocialCommentId]);
  useEffect(() => {
    selectedSocialCommentFetchKeyRef.current = "";
  }, []);
  useEffect(() => {
    inboxSectionRef.current = inboxSection;
  }, [inboxSection]);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (isRefreshingRef.current) {
      const queuedRefresh = refreshQueueRef.current;
      refreshQueueRef.current = {
        source: "filters",
        silent: queuedRefresh?.silent === false ? false : silent,
      };
      return;
    }
    isRefreshingRef.current = true;
    isHydratingConversationRef.current = true;
    // Snapshot whether the transcript is pinned to the bottom BEFORE the reload mutates
    // the DOM, so a refresh keeps the user on the latest messages instead of snapping to
    // the top of the thread. Read synchronously here (pre-fetch) so it can't race a
    // scroll-reset event fired during the re-render.
    {
      const pinScroller = transcriptScrollRef.current;
      pinToBottomAfterRefreshRef.current = Boolean(
        pinScroller && pinScroller.scrollHeight - pinScroller.scrollTop - pinScroller.clientHeight <= 140
      );
    }
    const seq = ++requestSeqRef.current;
    // Which channels this refresh covers. A specific tab is exactly one request;
    // "All" is one bounded request per message channel. Declared out here because
    // both the warm-cache read and the network round below need them.
    const warmChannels = channelsForFilter(channelFilter);
    // Cache entries are per-channel (keyed by the backend channel name), never one
    // giant unscoped "all" blob — a merged blob would re-introduce exactly the
    // starvation we are fixing as soon as it got clipped by the row cap. Also
    // reused as the per-channel fallback if a channel request fails below.
    const cachedPages = await Promise.all(
      warmChannels.map((ch) => inboxCache.primeList(ch).then((r) => asArray(r?.conversations)).catch(() => []))
    );
    if (!silent) {
      // Warm start (stale-while-revalidate): render cached conversation summaries
      // immediately and skip the blocking spinner while the channels revalidate.
      const cachedRows = mergeConversationPages(cachedPages, conversationKey);
      if (seq === requestSeqRef.current && cachedRows.length) {
        setInbox((current) => (asArray(current.conversations).length ? current : {
          conversations: cachedRows.map((c) => ({ ...c, conversation_key: c.conversation_key || conversationKey(c) })),
          followups: asArray(current.followups),
        }));
        setLoading(false); // show cached now; revalidate without a spinner
      } else if (seq === requestSeqRef.current) {
        setLoading(true);
      }
    }
    if (!silent) setSocialComments((current) => ({ ...current, loading: true, error: "" }));
    if (!silent) setSocialCommentsDebug((current) => ({ ...current, error: "" }));
    setError("");
    try {
      // Only the conversation list blocks first render. Drafts, analytics,
      // channel status, the global-AI flag and the employees directory are NOT
      // required to show conversations, so they load in a deferred, non-blocking
      // wave after the list is usable (see below).
      // NOTE: no `message_limit` here. This endpoint is summary-only server-side
      // (it always embeds exactly the latest message per conversation), so the
      // param was dead weight. The open thread hydrates from
      // /conversations/:id/messages instead.
      // Fair per-channel retrieval. One global limit let the largest channel
      // evict the others; each channel now gets its own guaranteed window and the
      // pages are merged client-side. When a specific channel tab is selected we
      // issue exactly ONE request for that channel — never fetch-all-and-filter.
      // This is still one logical refresh: the in-flight guard and the freshness
      // window above already gate the whole block, so mount/visibility/focus/
      // socket/SWR cannot multiply these into duplicate rounds.
      const fetchChannelPage = (backendChannel) => api.get("/ai-inbox/conversations", {
        params: {
          tenant_id: tenantId,
          filter,
          channel_filter: backendChannel,
          search: debouncedSearch,
          limit: channelWindow(backendChannel),
        },
        headers,
        perfComponent: `AiInbox.conversations.${backendChannel}`,
      }).then((payload) => asArray(payload?.conversations));

      const requestedChannels = warmChannels;
      const settled = await Promise.allSettled(requestedChannels.map(fetchChannelPage));
      if (seq !== requestSeqRef.current) return;
      lastListLoadAtRef.current = Date.now();

      // Failure isolation: a channel that fails falls back to its own cached page
      // so one bad endpoint cannot blank the inbox or silently delete a channel.
      const failedChannels = [];
      const channelPages = settled.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        failedChannels.push(requestedChannels[index]);
        return asArray(cachedPages[index]);
      });
      if (failedChannels.length) {
        console.warn("[ai-inbox] channel page failed, served from cache:", failedChannels.join(", "));
      }
      const inboxPayload = { conversations: channelPages.flat(), followups: [] };
      const conversations = mergeConversationPages(channelPages, conversationKey);
      const activeSection = inboxSectionRef.current || "conversations";
      const activeConversationSelectedId = selectedSessionIdRef.current;
      const activeSocialCommentSelectedId = selectedSocialCommentIdRef.current;
      const cachedSelected = selectedConversationCacheRef.current;
      let nextConversations = conversations;
      setInbox((current) => {
        const existingByKey = new Map(asArray(current.conversations).map((item) => [item.conversation_key || conversationKey(item), item]));
        nextConversations = conversations.map((summary) => {
          const key = summary.conversation_key || conversationKey(summary);
          const existing = existingByKey.get(key) || (cachedSelected?.conversation_key === key ? cachedSelected : null);
          if (!existing) return summary;
          const mergedMessages = mergeMessagesByIdentity([
            ...asArray(existing.messages),
            ...asArray(summary.messages),
          ]);
          return {
            ...existing,
            ...summary,
            // Phase 13.2 — never let a stale list/cache page overwrite a newer/cleared AI draft (monotonic).
            ...reconcileConversationDraft(existing, summary),
            messages: mergedMessages,
            message_count: Math.max(Number(existing.message_count || 0), Number(summary.message_count || 0), mergedMessages.length),
            older_messages_available: existing.older_messages_available ?? summary.older_messages_available,
            next_messages_before: existing.next_messages_before || summary.next_messages_before || "",
            next_messages_before_id: existing.next_messages_before_id || summary.next_messages_before_id || "",
          };
        });
        if (activeConversationSelectedId && !nextConversations.some((item) => item.conversation_key === activeConversationSelectedId) && cachedSelected?.conversation_key === activeConversationSelectedId) {
          nextConversations = [cachedSelected, ...nextConversations];
        }
        const selectedSnapshot = nextConversations.find((item) => item.conversation_key === activeConversationSelectedId);
        if (selectedSnapshot) selectedConversationCacheRef.current = selectedSnapshot;
        return { conversations: nextConversations, followups: asArray(inboxPayload.followups) };
      });
      // Persist compact summaries (messages stripped inside inboxCache) for the
      // next warm open. Debounced + fail-safe in the shared module. Each channel
      // is stored under its OWN key so a warm "All" open reads four independent
      // pages and merges them — a single merged blob would be clipped by the row
      // cap and could starve a channel again. A channel served from cache after a
      // failure is not rewritten: that would just echo stale data back.
      requestedChannels.forEach((backendChannel, index) => {
        if (failedChannels.includes(backendChannel)) return;
        inboxCache.saveList(channelPages[index], backendChannel);
      });
      if (activeSection === "conversations" && !activeConversationSelectedId && nextConversations[0]?.conversation_key) {
        setSelectedSessionId(nextConversations[0].conversation_key);
      }
      // Conversation list is usable now — unblock render BEFORE fetching the
      // non-essential secondary data so it never gates the list.
      if (!silent) setLoading(false);
      Promise.all([
        api.get("/ai-agent/orders/drafts", { params: { tenant_id: tenantId, limit: 50 }, headers, perfComponent: "AiInbox.drafts" }).catch(() => ({ drafts: [] })),
        api.get("/ai-agent/analytics", { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.analytics" }).catch(() => ({ analytics: {} })),
        api.get("/ai-agent/channels/status", { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.channels" }).catch(() => ({ channels: {} })),
        api.get("/ai-agent/settings/ai-assistant-global", { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.globalAi" }).catch(() => ({ ai_assistant_global_enabled: true })),
        api.get("/employees", { params: { active: true, limit: 200 }, headers, perfComponent: "AiInbox.employees" }).catch(() => ({ employees: [] })),
      ]).then(([draftsPayload, analyticsPayload, channelPayload, globalAiPayload, employeesPayload]) => {
        if (seq !== requestSeqRef.current) return;
        setDrafts(asArray(draftsPayload.drafts));
        setAnalytics(analyticsPayload.analytics || {});
        setChannelStatus(channelPayload.channels || {});
        setAiAssistantGlobalEnabled(globalAiPayload?.ai_assistant_global_enabled !== false);
        setEmployees(asArray(employeesPayload?.employees || employeesPayload?.data || employeesPayload || []));
      }).catch(() => {});

      const socialCommentsRequestUrl = `/api/social-comments/posts?tenant_id=${encodeURIComponent(tenantId)}&limit=50`;
      const socialSettingsRequestUrl = `/api/social-comments/auto-reply/settings?tenant_id=${encodeURIComponent(tenantId)}`;
      if (socialCommentsDebugEnabled()) {
        console.info("[ai-support] social_comments_request", {
          request_url: socialCommentsRequestUrl,
          tenant_id: tenantId,
        });
      }
      // Social comments are a SEPARATE section — they are never required to show
      // conversations. Detached from the awaited path so the comments endpoint
      // can't hold isRefreshingRef (and therefore the refresh queue) open.
      void (async () => {
      try {
        const [postsPayload, settingsPayload] = await Promise.all([
          api.get("/social-comments/posts", {
            params: { tenant_id: tenantId, limit: 50 },
            headers,
            perfComponent: "AiInbox.socialCommentsPosts",
          }),
          api.get("/social-comments/auto-reply/settings", {
            params: { tenant_id: tenantId },
            headers,
            perfComponent: "AiInbox.socialCommentsSettings",
          }).catch(() => ({ settings: null })),
        ]);
        if (seq !== requestSeqRef.current) return;
        const items = asArray(postsPayload.posts || postsPayload.items || postsPayload.data?.posts || postsPayload.data?.items).filter(Boolean).map((item) => normalizeSocialCommentPost(item));
        const status = Number(postsPayload?.__status || 200) || 200;
        if (socialCommentsDebugEnabled()) {
          console.info("[ai-support] social_comments_response", {
            request_url: socialCommentsRequestUrl,
            tenant_id: tenantId,
            status,
            count: items.length,
          });
        }
        setSocialComments({ items, loading: false, error: "" });
        setSocialReplySettings({
          generic_enabled: Boolean(settingsPayload?.settings?.generic_enabled),
          generic_like_enabled: settingsPayload?.settings?.generic_like_enabled !== false,
          generic_reply_enabled: settingsPayload?.settings?.generic_reply_enabled !== false,
          generic_template: clean(settingsPayload?.settings?.generic_template || ""),
          mode: clean(settingsPayload?.settings?.mode || "manual_approval") || "manual_approval",
        });
        setSocialCommentsDebug({
          request_url: socialCommentsRequestUrl,
          tenant_id: tenantId,
          status,
          count: items.length,
          error: "",
        });
        if (activeSection === "social_comments" && !activeSocialCommentSelectedId && items[0]) {
          setSelectedSocialCommentId(socialCommentIdentity(items[0]));
          setSelectedSessionId("");
          setSelectedSocialThread({ post: null, comments: [], loading: true, error: "" });
        }
      } catch (socialCommentsError) {
        if (seq !== requestSeqRef.current) return;
        const status = Number(socialCommentsError?.status || socialCommentsError?.responseBody?.status || 0) || "";
        const message = socialCommentsError?.responseBody?.message || socialCommentsError?.message || "تعذر تحميل منشورات التعليقات";
        if (socialCommentsDebugEnabled()) {
          console.error("[ai-support] social_comments_request_failed", {
            request_url: socialCommentsRequestUrl,
            tenant_id: tenantId,
            status,
            error: message,
          });
        }
        setSocialComments({ items: [], loading: false, error: message });
        setSocialCommentsDebug({
          request_url: socialCommentsRequestUrl,
          tenant_id: tenantId,
          status,
          count: 0,
          error: message,
        });
      }
      })();
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err?.message || "تعذر تحميل صندوق محادثات الذكاء الاصطناعي");
      // The detached social-comments block never started, so clear its spinner here.
      setSocialComments((current) => ({ ...current, loading: false }));
    } finally {
      if (seq === requestSeqRef.current && !silent) setLoading(false);
      if (seq === requestSeqRef.current) {
        isRefreshingRef.current = false;
        window.requestAnimationFrame(() => {
          isHydratingConversationRef.current = false;
        });
        const queuedRefresh = refreshQueueRef.current;
        if (queuedRefresh && refreshStateRef.current.pageVisible) {
          refreshQueueRef.current = null;
          requestRefreshRef.current?.(queuedRefresh.source, {
            silent: queuedRefresh.silent,
            force: true,
          });
        }
      }
    }
  }, [channelFilter, debouncedSearch, filter, headers, tenantId]);

  // Shared inboxCache housekeeping: expiry sweep on mount, and wipe on logout /
  // user switch so one account's cached inbox is never shown to the next.
  useEffect(() => {
    inboxCache.sweep();
    const onAuthUser = (event) => { if (!event?.detail?.user) inboxCache.clearAllCache(); };
    const onAuthExpired = () => inboxCache.clearAllCache();
    window.addEventListener("erp:auth-user-updated", onAuthUser);
    window.addEventListener("erp:auth-expired", onAuthExpired);
    return () => {
      window.removeEventListener("erp:auth-user-updated", onAuthUser);
      window.removeEventListener("erp:auth-expired", onAuthExpired);
    };
  }, []);

  const requestRefresh = useCallback(
    (source = "manual", { silent = true, force = false } = {}) => {
      if (!pageVisible && source === "polling") return;

      if (!pageVisible && source !== "visibility") {
        if (!refreshQueueRef.current) {
          refreshQueueRef.current = { source, silent };
        }
        return;
      }

      if (isRefreshingRef.current) {
        if (!refreshQueueRef.current) {
          refreshQueueRef.current = { source, silent };
        }
        return;
      }

      if (refreshQueueRef.current && !force) return;
      if (refreshQueueRef.current && force) refreshQueueRef.current = null;
      void loadAll({ silent });
    },
    [loadAll, pageVisible]
  );

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  useEffect(
    () => () => {
      refreshQueueRef.current = null;
    },
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    Promise.resolve().then(loadAll);
  }, [loadAll]);

  useEffect(() => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (!pageVisible || socketHealthy) return undefined;
    pollIntervalRef.current = window.setInterval(() => {
      requestRefresh("polling", { silent: true });
    }, 24000);
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [pageVisible, requestRefresh, socketHealthy]);

  useEffect(() => {
    const previous = refreshStateRef.current;
    refreshStateRef.current = { pageVisible, socketHealthy };

    if (!pageVisible) return;

    if (!previous.pageVisible) {
      // Freshness window: the ERP shell flips visibility far more often than the
      // standalone PWA (tab/window switches, overlays). Re-showing a list we
      // loaded seconds ago must not refetch — the cached/current data stays on
      // screen. Past the window we revalidate in the background as before.
      if (Date.now() - lastListLoadAtRef.current < VISIBILITY_FRESH_MS) return;
      requestRefresh("visibility", { silent: true, force: true });
      return;
    }

    if (!previous.socketHealthy && socketHealthy) {
      requestRefresh("socket", { silent: true, force: true });
    }
  }, [pageVisible, requestRefresh, socketHealthy]);

  useEffect(() => {
    const refresh = () => {
      if (pageVisible) requestRefresh("socket", { silent: true, force: true });
    };
    const onMessage = (payload = {}) => {
      const sessionId = payload.session_id || payload.message?.session_id || "";
      const channel = payload.channel || payload.message?.channel || payload.message?.source || "";
      const channelKey = normalizeConversationChannel({ channel });
      const conversationKey = channelKey === "whatsapp"
        ? normalizeWhatsappSessionIdentity(sessionId, payload.message?.resolved_phone || payload.message?.phone || "")
        : channelKey && channelKey !== "unknown"
          ? (String(sessionId).startsWith(`${channelKey}:`) ? sessionId : `${channelKey}:${sessionId}`)
          : sessionId;
      const incoming = payload.message || null;
      if (incoming?.sender_type === "customer" || incoming?.customer_message) {
        setToast({ tone: "cyan", text: "ردّ العميل" });
      }
      if (incoming?.id || incoming?.dedupe_key || incoming?.external_message_id) {
        let skipped = false;
        const incomingProductCards = normalizeProductCardsValue(incoming.product_cards || incoming.productCards);
        const incomingPreview =
          incoming.customer_message ||
          incoming.message_text ||
          incoming.ai_answer ||
          incoming.staff_message ||
          (incoming.message_type === "product_card" ? productCardPreviewText(incomingProductCards) : "");
        if (clean(conversationKey) === clean(selectedSessionIdRef.current)) {
          isAppendingNewMessageRef.current = true;
        }
        setInbox((current) => ({
          ...current,
          conversations: asArray(current.conversations).map((conversation) => {
            if (conversationKey !== sessionId) {
              if (conversation.conversation_key !== conversationKey) return conversation;
            } else if (conversation.session_id !== sessionId) {
              return conversation;
            }
            const messageKeyValue = messageKey(incoming);
            if (asArray(conversation.messages).some((message) => messageKey(message) === messageKeyValue)) {
              skipped = true;
              return conversation;
            }
            const mergedMessages = mergeMessagesByIdentity([...asArray(conversation.messages), incoming]);
            const senderType = clean(incoming.sender_type).toLowerCase();
            const isInbound = senderType === "customer" || (Boolean(clean(incoming.customer_message)) && senderType !== "staff");
            const isStaffReply = senderType === "staff";
            const currentUnreadCount = Number(conversation.unread_count || conversation.unread || 0);
            const nextUnreadCount = isInbound
              ? Math.max(1, currentUnreadCount + 1)
              : isStaffReply
                ? 0
                : currentUnreadCount;
            return {
              ...conversation,
              messages: mergedMessages,
              message_count: Math.max(
                Number(conversation.message_count || asArray(conversation.messages).length),
                mergedMessages.length
              ),
              latest_message_preview: incomingPreview || conversation.latest_message_preview,
              last_activity_at: incoming.created_at || new Date().toISOString(),
              unread_count: nextUnreadCount,
              pending_count: nextUnreadCount,
              unread: nextUnreadCount > 0,
            };
          }),
        }));
      }
      if (conversationKey && conversationKey !== selectedSessionId) {
        setUnseenSessions((current) => [...new Set([conversationKey, ...current])].slice(0, 20));
      }
    };
    const offMessage = subscribeRealtime("ai_inbox:message", onMessage);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", refresh);
    return () => {
      offMessage();
      offRefresh();
    };
  }, [pageVisible, requestRefresh, selectedSessionId]);

  useEffect(() => {
    if (!toast.text) return undefined;
    const timer = window.setTimeout(() => setToast({ tone: "", text: "" }), 3200);
    return () => window.clearTimeout(timer);
  }, [toast.text]);

  const conversations = asArray(inbox.conversations);
  const conversationPanelConversations = useMemo(
    () => conversations.filter((conversation) => isConversationChannel(normalizeConversationChannel(conversation))),
    [conversations]
  );
  const socialCommentPanelConversations = useMemo(
    () => conversations.filter((conversation) => isSocialCommentChannel(normalizeConversationChannel(conversation))),
    [conversations]
  );
  const activePanelConversations = inboxSection === "social_comments" ? socialCommentPanelConversations : conversationPanelConversations;
  const filteredConversations = useMemo(() => {
    const items = [...conversations];
    const activeChannelFilterAllowed = inboxSection === "social_comments"
      ? isSocialCommentChannel(channelFilter)
      : isConversationChannel(channelFilter);
    const matchesLeadFilter = (conversation = {}) => {
      const temperature = conversationLeadTemperature(conversation);
      if (leadFilter === "all") return true;
      if (leadFilter === "needs_human") return needsHumanAttention(conversation);
      return temperature === leadFilter;
    };
    const matchesFavoriteFilter = (conversation = {}) => {
      if (favoriteFilter === "all") return true;
      const isFavorite = conversation?.is_favorite === true || clean(conversation?.is_favorite).toLowerCase() === "true";
      return isFavorite;
    };
    const sortValue = (conversation = {}) => {
      const score = conversationLeadScore(conversation);
      const updatedAt = new Date(conversation.last_message_at || conversation.last_activity_at || conversation.updated_at || conversation.created_at || 0).getTime();
      const favoriteRank = conversation.is_favorite === true || clean(conversation.is_favorite).toLowerCase() === "true" ? 1 : 0;
      if (leadSort === "favorites_first") {
        return { primary: favoriteRank, secondary: updatedAt };
      }
      return leadSort === "lead_score_desc"
        ? { primary: score, secondary: updatedAt }
        : { primary: updatedAt, secondary: score };
    };
    const matchesChannelFilter = (conversation = {}) => {
      if (channelFilter === "all" || !activeChannelFilterAllowed) return true;
      return normalizeConversationChannel(conversation) === channelFilter;
    };
    const matchesInboxFilter = (conversation = {}) => {
      if (filter === "all") return true;
      if (filter === "messages") return isMessageThread(conversation) && matchesMessagePlatform(conversation, messagePlatformFilter);
      if (filter === "comments") return isSocialCommentThread(conversation) && matchesCommentPlatform(conversation, commentPlatformFilter);
      if (filter === "needs_reply") {
        const status = clean(
          conversation.needs_human ||
            conversation.needs_reply ||
            conversation.reply_status ||
            conversation.automation_status ||
            conversation.auto_reply_mode ||
            conversation.ai_status ||
            conversation.status ||
            conversation.delivery_status ||
            ""
        ).toLowerCase();
        return needsHumanAttention(conversation) || ["needs_human", "needs_reply", "failed", "waiting", "pending", "manual_review", "review"].includes(status);
      }
      return true;
    };
    const sorted = items.filter(matchesInboxFilter).filter(matchesLeadFilter).filter(matchesFavoriteFilter).filter(matchesChannelFilter).sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (right.primary !== left.primary) return right.primary - left.primary;
      if (right.secondary !== left.secondary) return right.secondary - left.secondary;
      return clean(b.session_id || b.conversation_key || b.conversation_id || "").localeCompare(clean(a.session_id || a.conversation_key || a.conversation_id || ""));
    });
    return sorted;
  }, [channelFilter, commentPlatformFilter, conversations, filter, inboxSection, leadFilter, leadSort, messagePlatformFilter, favoriteFilter]);
  const visibleConversations = useMemo(
    () => (inboxSection === "conversations" ? filteredConversations : []),
    [filteredConversations, inboxSection]
  );
  const visibleSocialComments = useMemo(() => {
    if (inboxSection !== "social_comments") return [];
    return [...asArray(socialComments.items)]
      .filter((item) => labelMatchesFilter(item, socialCommentsFilter))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [inboxSection, socialComments.items, socialCommentsFilter]);
  const channelSummaries = useMemo(() => {
    const buckets = new Map();
    const totalUnread = activePanelConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || conversation.unread || 0), 0);
    for (const conversation of activePanelConversations) {
      const key = normalizeConversationChannel(conversation);
      const existing = buckets.get(key) || {
        key,
        label: channelBadgeLabel(key),
        count: 0,
        unread: 0,
        tone: isWhatsappChannel(key) ? "emerald" : key === "instagram" ? "rose" : key === "facebook" || key === "messenger" ? "cyan" : "zinc",
      };
      existing.count += 1;
      existing.unread += Number(conversation.unread_count || conversation.unread || 0);
      buckets.set(key, existing);
    }
    return {
      all: { key: "all", label: "All", count: activePanelConversations.length, unread: totalUnread, tone: "zinc" },
      channels: [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
  }, [activePanelConversations]);
  const leadPipelineSummary = useMemo(() => {
    const counts = {
      new: 0,
      contacted: 0,
      interested: 0,
      negotiation: 0,
      won: 0,
      lost: 0,
    };
    const sourceCounts = {
      facebook_comment: 0,
      instagram_comment: 0,
      messenger: 0,
    };
    for (const conversation of activePanelConversations) {
      const status = conversationLeadStatus(conversation);
      counts[status] = (counts[status] || 0) + 1;
      const sourceKey = leadSourceKey(conversation);
      if (Object.prototype.hasOwnProperty.call(sourceCounts, sourceKey)) {
        sourceCounts[sourceKey] += 1;
      }
    }
    return {
      counts,
      sourceCounts,
      total: conversations.length,
      funnel: [
        { key: "new", label: "New" },
        { key: "contacted", label: "Contacted" },
        { key: "interested", label: "Interested" },
        { key: "won", label: "Won" },
      ],
      sourceOrder: [
        { key: "facebook_comment", label: "Facebook Comment" },
        { key: "instagram_comment", label: "Instagram Comment" },
        { key: "messenger", label: "Messenger" },
      ],
    };
  }, [activePanelConversations]);
  const fixedChannelSummaries = useMemo(() => {
    const byKey = new Map(channelSummaries.channels.map((item) => [item.key, item]));

    const fixedChannelOrder = inboxSection === "social_comments" ? socialCommentChannelOrder : conversationChannelOrder;
    return fixedChannelOrder.map((key) => ({
      key,
      label: channelBadgeLabel(key),
      count: Number(byKey.get(key)?.count || 0),
      unread: Number(byKey.get(key)?.unread || 0),
      tone: byKey.get(key)?.tone || "zinc",
    }));
  }, [channelSummaries.channels, inboxSection]);
  const realMetaCount = conversationPanelConversations.filter((item) => item.is_live_meta || isMetaChannel(item.channel || item.source)).length;
  const conversationPanelCount = conversationPanelConversations.length;
  const socialCommentsPanelCount = asArray(socialComments.items).length;
  const selectedConversationThread = useMemo(
    () => conversations.find((item) => item.conversation_key === selectedSessionId || item.session_id === selectedSessionId || conversationKey(item) === clean(selectedSessionId)) ||
      (selectedConversationCacheRef.current?.conversation_key === selectedSessionId ? selectedConversationCacheRef.current : null) ||
      conversations[0] ||
      null,
    [conversations, selectedSessionId]
  );
  const socialCommentIdentity = useCallback((item) => {
    const safeItem = item || {};
    return clean(
      safeItem.post_link_key ||
      safeItem.postLinkKey ||
      safeItem.product_link_identity?.post_link_key ||
      safeItem.product_link_identity?.product_link_key ||
      safeItem.product_link_identity?.post_id ||
      safeItem.permalink_url ||
      safeItem.post_permalink_url ||
      safeItem.platform_post_id ||
      safeItem.source_post_id ||
      safeItem.canonical_post_id ||
      safeItem.final_canonical_post_id ||
      safeItem.conversationId ||
      safeItem.sessionId ||
      safeItem.postId ||
      safeItem.id ||
      safeItem.commentId ||
      `${safeItem.platform || "social"}:${safeItem.postId || safeItem.commentId || ""}`
    );
  }, []);
  const selectedSocialComment = useMemo(
    () => visibleSocialComments.find((item) => socialCommentIdentity(item) === clean(selectedSocialCommentId)) ||
      visibleSocialComments[0] ||
      null,
    [selectedSocialCommentId, socialCommentIdentity, visibleSocialComments]
  );
  const isSocialMode = inboxSection === "social_comments";
  const isConversationMode = inboxSection === "conversations";
  const isAnalyticsMode = inboxSection === "analytics";
  const isAutomationMode = inboxSection === "automation";
  const activeMainItem = isSocialMode
    ? (selectedSocialComment || visibleSocialComments[0] || null)
    : isConversationMode
      ? (selectedConversationThread || visibleConversations[0] || null)
      : null;
  const selectedConversation = isConversationMode ? activeMainItem : null;
  const selectedSocialCommentPost = useMemo(
    () => normalizeSocialCommentPost(selectedSocialComment || {}),
    [selectedSocialComment]
  );
  const selectedSocialThreadPost = useMemo(
    () => normalizeSocialCommentPost(selectedSocialThread?.post || selectedSocialComment || {}),
    [selectedSocialThread?.post, selectedSocialComment]
  );
  const selectedSocialThreadComments = useMemo(
    () => asArray(selectedSocialThread?.comments).filter(Boolean).map((comment) => normalizeSocialCommentThreadComment(comment)),
    [selectedSocialThread?.comments]
  );
  const selectedSocialCommentPostId = clean(
    selectedSocialCommentPost.postLinkKey ||
      selectedSocialCommentPost.post_link_key ||
      selectedSocialCommentPost.platformPostId ||
      selectedSocialCommentPost.platform_post_id ||
      selectedSocialCommentPost.sourcePostId ||
      selectedSocialCommentPost.source_post_id ||
      selectedSocialCommentPost.postId ||
      selectedSocialCommentPost.conversationId ||
      selectedSocialCommentPost.id ||
      ""
  );
  const selectedSocialCommentPlatform = clean(selectedSocialCommentPost.platform || "facebook");
  const selectedSocialCommentFetchKey = useMemo(
    () =>
      clean(
        selectedSocialCommentPost.postLinkKey ||
          selectedSocialCommentPost.post_link_key ||
          selectedSocialCommentPost.platformPostId ||
          selectedSocialCommentPost.platform_post_id ||
          selectedSocialCommentPost.sourcePostId ||
          selectedSocialCommentPost.source_post_id ||
          selectedSocialCommentPost.postId ||
          selectedSocialCommentPost.id ||
          selectedSocialCommentPost.conversationId ||
          ""
      ),
    [selectedSocialCommentPost]
  );
  useEffect(() => {
    if (!isSocialMode) {
      if (selectedSocialThread.post || selectedSocialThread.comments.length) {
        setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
      }
      return;
    }
    const postId = selectedSocialCommentFetchKey || selectedSocialCommentPostId;
    if (!postId) {
      setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
      return;
    }
    let cancelled = false;
    const previousFetchKey = clean(selectedSocialCommentFetchKeyRef.current || "");
    const workspaceSeq = ++socialWorkspaceLoadSeqRef.current;
    const perfStart = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
    socialWorkspaceLoadStartRef.current = perfStart;
    const workspaceCacheKey = socialWorkspaceCacheKey({
      tenantId,
      postId,
      platform: selectedSocialCommentPlatform,
    });
    socialWorkspaceLoadKeyRef.current = workspaceCacheKey;
    selectedSocialCommentFetchKeyRef.current = postId;
    setSelectedSocialThread((current) => ({
      ...current,
      post: normalizeSocialCommentPost(selectedSocialComment || null),
      comments: [],
      loading: true,
      error: "",
    }));
    setSelectedSocialTemplate((current) => ({
      ...current,
      loading: true,
      error: "",
    }));
    const logPerf = (label, startedAt = perfStart) => {
      if (!DEBUG_SOCIAL_COMMENTS) return;
      const now = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
      console.log(label, {
        tenant_id: clean(tenantId),
        post_id: postId,
        platform: selectedSocialCommentPlatform,
        duration_ms: Math.max(0, Math.round(now - startedAt)),
      });
    };
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        if (cancelled || workspaceSeq !== socialWorkspaceLoadSeqRef.current) return;
        logPerf("WORKSPACE_STAGE_1_MS");
        logPerf("WORKSPACE_STAGE_3_MS");
      });
    }
    const cachedWorkspace = ENABLE_SOCIAL_FAST_CENTER ? readSocialWorkspaceCache(workspaceCacheKey) : null;
    if (cachedWorkspace?.thread) {
      setSelectedSocialThread({
        post: normalizeSocialCommentPost(cachedWorkspace.thread.post || selectedSocialCommentPost || null),
        comments: asArray(cachedWorkspace.thread.comments).filter(Boolean).map((comment) => normalizeSocialCommentThreadComment(comment)),
        loading: false,
        error: "",
      });
    }
    if (cachedWorkspace?.template) {
      setSelectedSocialTemplate({
        template: cachedWorkspace.template.template || null,
        loading: false,
        error: "",
      });
    }
    void (async () => {
      try {
        const platformValue = selectedSocialCommentPlatform;
        if (DEBUG_SOCIAL_COMMENTS) {
          console.info("SOCIAL_COMMENTS_FETCH_KEY_TRACE", {
            selected_title: clean(selectedSocialCommentPost.caption || ""),
            selected_post_link_key: clean(selectedSocialCommentPost.postLinkKey || selectedSocialCommentPost.post_link_key || ""),
            fetch_post_id: postId,
            previous_fetch_key: previousFetchKey,
            request_started: true,
            response_applied: false,
            ignored_stale_response: false,
            comments_count: 0,
          });
        }
        const threadData = cachedWorkspace?.thread
          ? cachedWorkspace.thread
          : await api.get(`/social-comments/posts/${encodeURIComponent(postId)}/comments`, {
              params: {
                tenant_id: tenantId,
                platform: platformValue,
              },
              headers,
              perfComponent: "AiInbox.socialCommentThread",
            }).then((threadPayload) => {
              const nextThread = {
                post: threadPayload.post || selectedSocialCommentPost || null,
                comments: asArray(threadPayload.comments).filter(Boolean).map((comment) => normalizeSocialCommentThreadComment(comment)),
              };
              const currentCache = readSocialWorkspaceCache(workspaceCacheKey) || {};
              primeSocialWorkspaceCache(workspaceCacheKey, {
                ...currentCache,
                thread: nextThread,
              });
              logPerf("WORKSPACE_STAGE_2_MS");
              return nextThread;
            });
        if (cancelled || workspaceSeq !== socialWorkspaceLoadSeqRef.current) return;
        const applied = clean(selectedSocialCommentFetchKeyRef.current || "") === postId;
        if (DEBUG_SOCIAL_COMMENTS) {
          console.info("SOCIAL_COMMENTS_FETCH_KEY_TRACE", {
            selected_title: clean(selectedSocialCommentPost.caption || ""),
            selected_post_link_key: clean(selectedSocialCommentPost.postLinkKey || selectedSocialCommentPost.post_link_key || ""),
            fetch_post_id: postId,
            previous_fetch_key: previousFetchKey,
            request_started: false,
            response_applied: applied,
            ignored_stale_response: !applied,
            comments_count: asArray(threadData.comments).length,
          });
        }
        if (!applied) return;
        setSelectedSocialThread({
          post: normalizeSocialCommentPost(threadData.post || selectedSocialCommentPost || null),
          comments: asArray(threadData.comments).filter(Boolean).map((comment) => normalizeSocialCommentThreadComment(comment)),
          loading: false,
          error: "",
        });
      } catch (error) {
        if (cancelled || workspaceSeq !== socialWorkspaceLoadSeqRef.current) return;
        setSelectedSocialThread({
          post: selectedSocialCommentPost,
          comments: [],
          loading: false,
          error: error?.message || "تعذر تحميل تفاصيل البوست",
        });
      }
    })();
    void (async () => {
      try {
        const platformValue = selectedSocialCommentPlatform;
        const templateData = cachedWorkspace?.template
          ? cachedWorkspace.template
          : await api.get(`/social-comments/posts/${encodeURIComponent(postId)}/template`, {
              params: {
                tenant_id: tenantId,
                platform: platformValue,
              },
              headers,
              perfComponent: "AiInbox.socialCommentTemplate",
            }).then((templatePayload) => {
              const nextTemplate = { template: templatePayload.template || null };
              const currentCache = readSocialWorkspaceCache(workspaceCacheKey) || {};
              primeSocialWorkspaceCache(workspaceCacheKey, {
                ...currentCache,
                template: nextTemplate,
              });
              logPerf("WORKSPACE_STAGE_4_MS");
              return nextTemplate;
            }).catch(() => ({ template: null }));
        if (cancelled || workspaceSeq !== socialWorkspaceLoadSeqRef.current) return;
        setSelectedSocialTemplate({
          template: templateData.template || null,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (cancelled || workspaceSeq !== socialWorkspaceLoadSeqRef.current) return;
        setSelectedSocialTemplate({
          template: null,
          loading: false,
          error: error?.message || "تعذر تحميل القالب",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [headers, isSocialMode, selectedSocialCommentFetchKey, selectedSocialCommentPlatform, selectedSocialCommentPost, selectedSocialCommentPostId, tenantId]);

  useEffect(() => {
    if (!DEBUG_SOCIAL_COMMENTS || !isSocialMode || !selectedSocialCommentPostId) return;
    if (selectedSocialThread.loading || selectedSocialTemplate.loading) return;
    const activeKey = socialWorkspaceCacheKey({
      tenantId,
      postId: selectedSocialCommentPostId,
      platform: selectedSocialCommentPlatform,
    });
    if (!activeKey || socialWorkspaceLoadKeyRef.current !== activeKey) return;
    const now = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
    console.log("WORKSPACE_STAGE_5_MS", {
      tenant_id: clean(tenantId),
      post_id: selectedSocialCommentPostId,
      platform: selectedSocialCommentPlatform,
      duration_ms: Math.max(0, Math.round(now - socialWorkspaceLoadStartRef.current)),
    });
    console.log("WORKSPACE_TOTAL_VISIBLE_MS", {
      tenant_id: clean(tenantId),
      post_id: selectedSocialCommentPostId,
      platform: selectedSocialCommentPlatform,
      duration_ms: Math.max(0, Math.round(now - socialWorkspaceLoadStartRef.current)),
    });
    socialWorkspaceLoadKeyRef.current = "";
  }, [isSocialMode, selectedSocialCommentPlatform, selectedSocialCommentPostId, selectedSocialTemplate.loading, selectedSocialThread.loading, tenantId]);
  const saveSocialReplySettings = async () => {
    try {
      const payload = await api.post(
        "/social-comments/auto-reply/settings",
        {
          tenant_id: tenantId,
          ...socialReplySettings,
        },
        { headers, perfComponent: "AiInbox.socialReplySettings" }
      );
      setSocialReplySettings({
        generic_enabled: Boolean(payload?.settings?.generic_enabled),
        generic_like_enabled: payload?.settings?.generic_like_enabled !== false,
        generic_reply_enabled: payload?.settings?.generic_reply_enabled !== false,
        generic_template: clean(payload?.settings?.generic_template || ""),
        mode: clean(payload?.settings?.mode || "manual_approval") || "manual_approval",
      });
      setToast({ tone: "emerald", text: "تم حفظ إعدادات الرد التلقائي" });
    } catch (saveError) {
      setToast({ tone: "rose", text: saveError?.message || "تعذر حفظ الإعدادات" });
    }
  };
  const saveSocialPostTemplate = async () => {
    const postId = clean(selectedSocialComment?.post_id || selectedSocialComment?.conversation_id || selectedSocialComment?.id || "");
    if (!postId) return;
    try {
      const payload = await api.post(
        `/social-comments/posts/${encodeURIComponent(postId)}/template`,
        {
          tenant_id: tenantId,
          platform: clean(selectedSocialComment?.platform || "facebook"),
          ...selectedSocialTemplate.template,
        },
        { headers, perfComponent: "AiInbox.socialPostTemplateSave" }
      );
      setSelectedSocialTemplate({
        template: payload.template || null,
        loading: false,
        error: "",
      });
      setToast({ tone: "emerald", text: "تم حفظ قالب البوست" });
      await loadAll({ silent: true });
    } catch (templateError) {
      setToast({ tone: "rose", text: templateError?.message || "تعذر حفظ قالب البوست" });
    }
  };
  const handleSocialCommentAction = async (comment = {}, action = "") => {
    const commentId = clean(comment?.comment_id || comment?.id || comment?.external_message_id || comment?.provider_message_id || "");
    if (!commentId) return;
    const postId = clean(selectedSocialComment?.post_id || selectedSocialComment?.conversation_id || selectedSocialComment?.id || comment?.post_id || comment?.conversation_id || "");
    const platformValue = clean(selectedSocialComment?.platform || comment?.platform || "facebook");
    setSocialCommentActionLoading(`${action}:${commentId}`);
    try {
      if (action === "reply") {
        await api.post(
          `/social-comments/comments/${encodeURIComponent(commentId)}/auto-reply-send`,
          {
            tenant_id: tenantId,
            platform: platformValue,
            post_id: postId,
          },
          { headers, perfComponent: "AiInbox.socialCommentReply" }
        );
        await loadAll({ silent: true });
        return;
      }
      if (action === "ignore") {
        await api.post(
          `/social-comments/comments/${encodeURIComponent(commentId)}/ignore`,
          {
            tenant_id: tenantId,
            platform: platformValue,
            post_id: postId,
            reason: "ignore",
          },
          { headers, perfComponent: "AiInbox.socialCommentIgnore" }
        );
        await loadAll({ silent: true });
        return;
      }
      if (action === "private_message") {
        setToast({ tone: "amber", text: "إرسال الرسالة الخاصة غير مفعّل بعد في هذه الواجهة" });
        return;
      }
      if (action === "lead") {
        setToast({ tone: "amber", text: "إنشاء Lead من التعليق غير مفعّل بعد في هذه الواجهة" });
      }
    } catch (error) {
      setToast({ tone: "rose", text: error?.message || "تعذر تنفيذ الإجراء" });
    } finally {
      setSocialCommentActionLoading("");
    }
  };
  const getActiveItemId = useCallback(() => {
    if (isSocialMode) return clean(selectedSocialComment?.post_link_key || selectedSocialComment?.postLinkKey || selectedSocialComment?.conversation_id || selectedSocialComment?.session_id || selectedSocialComment?.post_id || selectedSocialComment?.id || "");
    return clean(selectedConversationThread?.conversation_key || selectedConversationThread?.session_id || selectedConversationThread?.conversation_id || conversationKey(selectedConversationThread || {}));
  }, [conversationKey, isSocialMode, selectedConversationThread?.conversation_id, selectedConversationThread?.conversation_key, selectedConversationThread?.session_id, selectedSocialComment?.conversation_id, selectedSocialComment?.id, selectedSocialComment?.post_id, selectedSocialComment?.post_link_key, selectedSocialComment?.session_id]);
  const activeItemId = getActiveItemId();
  useEffect(() => {
    console.log("[ai-inbox-section]", {
      inboxSection,
      visibleConversations: visibleConversations.length,
      visibleSocialComments: visibleSocialComments.length,
      selectedConversationId: isSocialMode ? "" : selectedConversation?.session_id || selectedConversation?.conversation_key || selectedConversation?.conversation_id || "",
      selectedSocialCommentId: isSocialMode ? selectedSocialComment?.id || "" : "",
      activeItemId,
    });
  }, [activeItemId, inboxSection, isSocialMode, selectedConversation?.conversation_id, selectedConversation?.conversation_key, selectedConversation?.session_id, selectedSocialComment?.id, visibleConversations.length, visibleSocialComments.length]);
  useEffect(() => {
    if (inboxSection === "social_comments") {
      const nextSelected = visibleSocialComments[0] || null;
      const selectedKey = clean(selectedSocialCommentIdRef.current);
      const hasActiveSelection = selectedKey && visibleSocialComments.some((item) => socialCommentIdentity(item) === selectedKey);
      if (!visibleSocialComments.length) {
        if (selectedSocialCommentIdRef.current) setSelectedSocialCommentId("");
        return;
      }
      if (!hasActiveSelection && socialCommentIdentity(nextSelected)) {
        setSelectedSocialCommentId(socialCommentIdentity(nextSelected));
        setSelectedSessionId("");
        setMobileView("chat");
      }
      return;
    }

    if (inboxSection !== "conversations") {
      return;
    }

    const nextSelected = visibleConversations[0] || null;
    const selectedKey = clean(selectedSessionIdRef.current);
    const hasActiveSelection = selectedKey && visibleConversations.some((item) => item.conversation_key === selectedKey || item.session_id === selectedKey || conversationKey(item) === selectedKey);
    if (!visibleConversations.length) {
      if (selectedSessionIdRef.current) setSelectedSessionId("");
      return;
    }
    if (!hasActiveSelection && nextSelected?.conversation_key) {
      setSelectedSessionId(nextSelected.conversation_key);
      setSelectedSocialCommentId("");
    }
  }, [inboxSection, socialCommentIdentity, visibleConversations, visibleSocialComments]);
  const selectedConversationRouteId = useMemo(
    () => clean(selectedConversation?.session_id || selectedConversation?.conversation_key || selectedConversation?.conversation_id || conversationKey(selectedConversation || {})),
    [selectedConversation]
  );
  const syncTranscriptScrollProximity = useCallback((scroller = transcriptScrollRef.current) => {
    if (!scroller) return;
    setUserIsNearBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 140);
  }, []);
  const openSocialCommentThread = useCallback((item = {}) => {
    const nextSelectionKey = clean(
      item?.post_link_key ||
        item?.postLinkKey ||
        item?.platform_post_id ||
        item?.platformPostId ||
        item?.source_post_id ||
        item?.sourcePostId ||
        item?.post_id ||
        item?.postId ||
        item?.id ||
        socialCommentIdentity(item) ||
        ""
    );
    setSelectedSocialCommentId(nextSelectionKey || socialCommentIdentity(item));
    setSelectedSessionId("");
    setSelectedSocialThread({
      post: normalizeSocialCommentPost(item),
      comments: [],
      loading: true,
      error: "",
    });
    console.info("AI_INBOX_OPEN_SOCIAL_COMMENT", {
      post_id: clean(item?.post_link_key || item?.platform_post_id || item?.source_post_id || item?.post_id || item?.conversation_post_id || item?.thread_post_id || socialCommentIdentity(item) || ""),
      comment_id: clean(item?.comment_id || item?.external_comment_id || item?.provider_comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || ""),
      platform: clean(item?.platform || item?.source_platform || item?.channel || item?.source || ""),
      tenant: clean(tenantId),
      page_id: clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || ""),
      customer_name: clean(item?.customer_name || item?.commenter_name || item?.author_name || item?.from_name || item?.metadata?.customer_name || item?.metadata?.commenter_name || ""),
      selection_mode: "local_state",
    });
    setMobileView("chat");
    setReplyText("");
    setUnseenSessions((current) => current.filter((id) => id !== clean(item?.conversation_key || item?.session_id || item?.conversation_id || socialCommentIdentity(item) || "")));
  }, [socialCommentIdentity, tenantId]);

  const handleSelectConversation = useCallback((item) => {
    const kind = getInboxItemKind(item);
    if (kind === "comment") {
      openSocialCommentThread(item);
    } else {
      const nextConversationId = clean(
        item?.conversation_key ||
        conversationKey(item) ||
        item?.session_id ||
        item?.conversation_id ||
        item?.id ||
        ""
      );
      if (!nextConversationId) return;
      selectedConversationCacheRef.current = item;
      setSelectedSessionId(nextConversationId);
      setSelectedSocialCommentId("");
      setMobileView("chat");
      setReplyText("");
      setUnseenSessions((current) => current.filter((id) => id !== nextConversationId));
    }
  }, [openSocialCommentThread]);
  const patchConversation = useCallback((identifier, updater) => {
    const target = clean(identifier);
    setInbox((current) => ({
      ...current,
      conversations: asArray(current.conversations).map((conversation) => {
        if (conversation.conversation_key !== target && conversation.session_id !== target) return conversation;
        const next = updater(conversation);
        return { ...next, messages: mergeMessagesByIdentity(next.messages) };
      }),
    }));
  }, []);
  const toggleConversationFavorite = useCallback(async (item) => {
    const sessionId = clean(item?.session_id || item?.conversation_id || "");
    const conversationIdentifier = clean(item?.conversation_key || sessionId);
    if (!sessionId || !conversationIdentifier) return;
    const previousFavorite = item?.is_favorite === true || clean(item?.is_favorite).toLowerCase() === "true";
    const nextFavorite = !previousFavorite;
    patchConversation(conversationIdentifier, (conversation) => ({ ...conversation, is_favorite: nextFavorite }));
    try {
      const payload = await api.patch(
        aiAgentInboxEndpoint(sessionId, "/favorite"),
        { tenant_id: tenantId, is_favorite: nextFavorite },
        { headers, perfComponent: "AiInbox.toggleFavorite" }
      );
      const updatedConversation = payload?.conversation || {};
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        ...updatedConversation,
        is_favorite: updatedConversation.is_favorite === undefined ? nextFavorite : Boolean(updatedConversation.is_favorite),
      }));
      setToast({
        tone: nextFavorite ? "emerald" : "amber",
        text: nextFavorite ? "تمت إضافة المحادثة إلى المفضلة." : "تمت إزالة المحادثة من المفضلة.",
      });
    } catch (err) {
      patchConversation(conversationIdentifier, (conversation) => ({ ...conversation, is_favorite: previousFavorite }));
      setToast({ tone: "rose", text: err?.message || "فشل تحديث حالة المفضلة." });
    }
  }, [api, headers, patchConversation, setToast, tenantId]);
  useEffect(() => {
    if (inboxSection === "conversations" && selectedConversation?.session_id) {
      selectedConversationCacheRef.current = selectedConversation;
    }
  }, [inboxSection, selectedConversation]);
  useEffect(() => {
    if (inboxSection !== "conversations" || !selectedConversation?.session_id) return;
    const unreadCount = Number(selectedConversation.unread_count || selectedConversation.unread || 0);
    if (unreadCount <= 0) return;
    const sessionId = clean(selectedConversation.session_id);
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    const signature = `${sessionId}:${selectedConversation.last_activity_at || selectedConversation.updated_at || ""}`;
    if (markReadSignatureRef.current === signature) return;
    markReadSignatureRef.current = signature;
    const readAt = new Date().toISOString();
    patchConversation(conversationIdentifier, (conversation) => ({
      ...conversation,
      unread_count: 0,
      unseen_count: 0,
      pending_count: 0,
      unread: false,
      read_at: readAt,
    }));
    void api.post(
      aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/read"),
      {
        tenant_id: tenantId,
        conversation_id: sessionId,
        channel: selectedConversation.channel || selectedConversation.source || "",
      },
      { headers, perfComponent: "AiInbox.markRead" }
    ).catch((markError) => {
      console.warn("[AiInbox] mark-read failed", {
        conversation_id: sessionId,
        status: markError?.status || 0,
        message: markError?.message || "",
      });
      markReadSignatureRef.current = "";
    });
  }, [headers, inboxSection, patchConversation, selectedConversation, selectedConversationRouteId, tenantId]);
  const syncMessengerProfile = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!selectedConversation?.session_id || !canSyncMessengerProfile(selectedConversation)) return;
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    const externalCustomerId = clean(selectedConversation.external_customer_id || "");
    const attemptKey = `${sessionId}:${externalCustomerId}`;
    if (!silent && messengerProfileSyncAttemptedRef.current.has(attemptKey)) return;
    messengerProfileSyncAttemptedRef.current.add(attemptKey);
    setProfileSyncing(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/sync-messenger-profile"), {
        tenant_id: tenantId,
        external_customer_id: externalCustomerId,
      }, { headers, perfComponent: "AiInbox.syncMessengerProfile" });
      if (payload.conversation) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          messages: asArray(payload.conversation.messages).length ? payload.conversation.messages : conversation.messages,
        }));
      } else {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          customer_name: payload.customer_name || payload.display_name || payload.facebook_name || payload.messenger_name || conversation.customer_name,
          customer_avatar_url: payload.customer_avatar_url || conversation.customer_avatar_url,
          customer_profile: {
            ...(conversation.customer_profile || {}),
            name: payload.customer_name || payload.display_name || payload.facebook_name || payload.messenger_name || conversation.customer_profile?.name || "",
            display_name: payload.display_name || payload.customer_name || conversation.customer_profile?.display_name || "",
            facebook_name: payload.facebook_name || payload.display_name || payload.customer_name || conversation.customer_profile?.facebook_name || "",
            messenger_name: payload.messenger_name || payload.display_name || payload.customer_name || conversation.customer_profile?.messenger_name || "",
            avatar_url: payload.customer_avatar_url || conversation.customer_profile?.avatar_url || "",
            profile_pic_url: payload.customer_avatar_url || conversation.customer_profile?.profile_pic_url || "",
          },
        }));
      }
      if (!silent) setToast({ tone: "emerald", text: "Profile synced" });
      await loadAll({ silent: true });
    } catch (err) {
      console.warn("[AiInbox][messenger-profile-sync-failed]", {
        conversation_id: sessionId,
        external_customer_id: externalCustomerId,
        message: err?.message || "",
      });
      if (!silent) setToast({ tone: "rose", text: "تعذر جلب ملف ماسنجر" });
      setError(err?.message || "تعذر جلب ملف ماسنجر");
    } finally {
      setProfileSyncing(false);
    }
  }, [headers, loadAll, messengerProfileSyncAttemptedRef, patchConversation, selectedConversation, selectedConversationRouteId, setError, setProfileSyncing, setToast, tenantId]);
  useEffect(() => {
    if (!selectedConversation || !canSyncMessengerProfile(selectedConversation)) return;
    const currentName = clean(selectedConversation.customer_name || selectedConversation.customer_profile?.name || "");
    // Only skip the profile sync when the stored name is already a genuine real name.
    // Also sync when it's generic, an external id, OR actually a message (new-conversation
    // placeholder), so the real Facebook name + avatar replace it in the chat and Customer 360.
    if (currentName && !isGenericCustomerName(currentName) && !isLikelyMessengerExternalId(currentName) && !looksLikeMessageName(currentName)) return;
    const sessionId = clean(selectedConversation.session_id || "");
    const externalCustomerId = clean(selectedConversation.external_customer_id || "");
    const attemptKey = `${sessionId}:${externalCustomerId}`;
    if (messengerProfileSyncAttemptedRef.current.has(attemptKey)) return;
    messengerProfileSyncAttemptedRef.current.add(attemptKey);
    void syncMessengerProfile({ silent: true });
  }, [selectedConversation, syncMessengerProfile]);
  useEffect(() => {
    const scroller = transcriptScrollRef.current;
    if (!selectedConversation?.session_id || !scroller) return undefined;

    const restoreState = restoreScrollStateRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!scroller) return;
      const pinBottomAfterRefresh = pinToBottomAfterRefreshRef.current;
      pinToBottomAfterRefreshRef.current = false;
      if (restoreState) {
        scroller.scrollTop = Math.max(0, restoreState.scrollTop + (scroller.scrollHeight - restoreState.scrollHeight));
        restoreScrollStateRef.current = null;
        syncTranscriptScrollProximity(scroller);
        isLoadingOlderRef.current = false;
        isAppendingNewMessageRef.current = false;
        return;
      }

      const conversationKey = selectedConversation.conversation_key || selectedConversation.session_id || "";
      const latestVisibleMessage = uniqueMessages(selectedConversation?.messages)
        .slice()
        .reverse()
        .find((message) => !isHiddenAiReplyTranscriptMessage(message));
      const latestMessageKey = messageKey(latestVisibleMessage || {});
      const conversationChanged = previousConversationKeyRef.current !== conversationKey;
      const latestMessageAppended = latestMessageKey && latestMessageKey !== previousLatestMessageKeyRef.current;

      if (conversationChanged || (latestMessageAppended && userIsNearBottom) || pinBottomAfterRefresh) {
        scroller.scrollTop = scroller.scrollHeight;
        setUserIsNearBottom(true);
      } else {
        syncTranscriptScrollProximity(scroller);
      }

      previousConversationKeyRef.current = conversationKey;
      previousLatestMessageKeyRef.current = latestMessageKey;
      isAppendingNewMessageRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversation?.conversation_key, selectedConversation?.messages, selectedConversation?.session_id, syncTranscriptScrollProximity, userIsNearBottom]);
  useEffect(() => {
    const scroller = transcriptScrollRef.current;
    if (!scroller) return undefined;

    const handleScroll = () => {
      syncTranscriptScrollProximity(scroller);
    };

    handleScroll();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [selectedConversation?.session_id, syncTranscriptScrollProximity]);
  const safeConversation = selectedConversation || {};
  const latestCommentReplyDraft = useMemo(() => {
    if (!isCommentConversation(safeConversation)) return "";
    const messages = uniqueMessages(selectedConversation?.messages).slice().reverse();
    const latestSuggestion = messages.find((message) => {
      const type = clean(message?.message_type || "").toLowerCase();
      return type === "comment_suggestion" && clean(message?.ai_answer || "");
    });
    const metadataDraft = clean(
      safeConversation?.channel_metadata?.lead?.suggested_reply ||
        safeConversation?.channel_metadata?.lead_metadata?.suggested_reply ||
        conversationLeadSnapshot(safeConversation)?.suggested_reply ||
        ""
    );
    return clean(latestSuggestion?.ai_answer || metadataDraft || "");
  }, [safeConversation, selectedConversation?.messages]);
  const activeAiReplyDraft = useMemo(
    () => selectedConversation?.ai_reply_draft || selectedConversation?.last_ai_reply_draft || null,
    [selectedConversation?.ai_reply_draft, selectedConversation?.last_ai_reply_draft]
  );
  const activeAiSuggestionText = useMemo(() => {
    const draftText = clean(activeAiReplyDraft?.text || "");
    const aiReplyText = aiReply.sessionId === selectedConversation?.session_id ? clean(aiReply.text || "") : "";
    return draftText || aiReplyText;
  }, [activeAiReplyDraft?.text, aiReply.sessionId, aiReply.text, selectedConversation?.session_id]);
  // Phase 11.2 — authoritative suggestion identity + staleness. The actionable suggestion is derived from the
  // draft's source_message_id, NOT from whatever draft object lingered in local state. A suggestion whose
  // source is OLDER than the latest inbound customer message is stale and must never remain actionable
  // (fixes: an approved/sent suggestion, or a superseded one, surviving after a newer customer message).
  const latestCustomerMessageId = useMemo(() => {
    let maxId = 0;
    for (const m of asArray(selectedConversation?.messages)) {
      const isCustomer = String(m?.sender_type || "").toLowerCase() === "customer" || (clean(m?.customer_message) && !clean(m?.staff_message) && !clean(m?.ai_answer));
      const id = Number(m?.id) || 0;
      if (isCustomer && id > maxId) maxId = id;
    }
    return maxId;
  }, [selectedConversation?.messages]);
  const suggestionSourceId = Number(activeAiReplyDraft?.metadata?.source_message_id) || 0;
  const suggestionStale = latestCustomerMessageId > 0 && suggestionSourceId > 0 && latestCustomerMessageId > suggestionSourceId;
  const activeAiSuggestionKey = useMemo(() => {
    if (!selectedConversation?.session_id || !activeAiSuggestionText) return "";
    const stamp = selectedConversation?.last_ai_reply_draft_updated_at || activeAiReplyDraft?.updated_at || activeAiReplyDraft?.metadata?.updated_at || "";
    // Identity keyed by source_message_id → a new draft (new inbound) is a NEW suggestion: not-dismissed and
    // it resets inline edit / product-selection state via the reset effect below.
    return `${selectedConversation.session_id}:${suggestionSourceId || 0}:${stamp || activeAiSuggestionText.length}`;
  }, [activeAiReplyDraft?.metadata?.updated_at, activeAiReplyDraft?.updated_at, activeAiSuggestionText, selectedConversation?.last_ai_reply_draft_updated_at, selectedConversation?.session_id, suggestionSourceId]);
  // Phase 13.2 — a completed/cleared TOMBSTONE (status "sent"/"cleared") is never actionable, even if a stale
  // payload still carried text (belt-and-suspenders alongside the monotonic merge + empty tombstone text).
  const draftCompleted = ["sent", "cleared"].includes(String(activeAiReplyDraft?.status || "").toLowerCase());
  const aiSuggestionVisible = Boolean(activeAiSuggestionText) && !draftCompleted && dismissedAiSuggestionKey !== activeAiSuggestionKey && !suggestionStale;
  // Grounding facts for the suggestion card (product/size/color/stock/action) so the operator reviews WHY the
  // AI answered as it did before approving. Derived from the persisted draft; null when absent.
  // Phase 11.2 — send-ready product attachment on the suggestion. The single enriched card (unambiguous) is the
  // draft's first product_card; ambiguous choices + delivery format come from metadata.send_package.
  const suggestionDraftCard = useMemo(() => {
    const cards = asArray(activeAiReplyDraft?.product_cards);
    return cards.length ? cards[0] : null;
  }, [activeAiReplyDraft]);
  const suggestionSendPackage = activeAiReplyDraft?.metadata?.send_package || null;
  const effectiveSuggestionCard = suggestionProductRemoved ? null : (suggestionChosenCard || suggestionDraftCard);
  // Phase 13.4 — recommendation (multi-select) vs identity-disambiguation (single-select). The mode comes from the
  // grounded send_package, never inferred from the number of cards. Recommendation lets the operator pick several
  // grounded products to send with the approved reply; disambiguation resolves ONE product identity.
  const suggestionSelectionSemantics = suggestionSendPackage?.selection_semantics || null;
  const isRecommendationSuggestion = suggestionSelectionSemantics === "recommendation";
  const suggestionRecommendationKeys = useMemo(() => new Set(suggestionRecommendationCards.map(productSelectionKey)), [suggestionRecommendationCards]);
  const suggestionDeliveryFormat = useMemo(() => {
    const ch = String(selectedConversation?.channel || selectedConversation?.source || "").toLowerCase();
    if (ch.includes("messenger") || ch === "facebook") return { label: "كارت منتج (Messenger)", kind: "rich_card" };
    if (ch.includes("whatsapp")) return { label: "صورة + لينك", kind: "image_link" };
    if (ch.includes("instagram")) return { label: "نص + لينك المنتج", kind: "text_link" };
    return { label: "لينك المنتج", kind: "text_link" };
  }, [selectedConversation?.channel, selectedConversation?.source]);
  // Reset employee product + text edits whenever a fresh suggestion appears (never mid-edit of the same one).
  useEffect(() => {
    setSuggestionProductRemoved(false);
    setSuggestionChosenCard(null);
    setSuggestionRecommendationCards([]);
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
  }, [activeAiSuggestionKey]);
  // Phase 13 fix — validation/confidence panels share the ONE authoritative current-suggestion identity as the
  // AI Suggested Reply card (aiSuggestionVisible). When there is NO current actionable draft (null / sent / cleared
  // / stale / superseded / dismissed), the panels derive from {} → hidden. They NEVER fall back to stale frontend
  // state (aiReply.*) or a prior conversation's values — so an old suggestion's confidence can't linger.
  const activeAiReplyValidation = useMemo(
    () => normalizeValidationSummary(
      aiSuggestionVisible ? (activeAiReplyDraft?.validation || activeAiReplyDraft?.metadata?.validation || {}) : {}
    ),
    [aiSuggestionVisible, activeAiReplyDraft?.validation, activeAiReplyDraft?.metadata?.validation]
  );
  const activeAiReplyConfidence = useMemo(
    () => normalizeConfidenceEngineSummary(
      aiSuggestionVisible ? (activeAiReplyDraft?.confidence_engine || activeAiReplyDraft?.metadata?.confidence_engine || {}) : {}
    ),
    [aiSuggestionVisible, activeAiReplyDraft?.confidence_engine, activeAiReplyDraft?.metadata?.confidence_engine]
  );
  const activeAiReplyShadow = useMemo(
    () => activeAiReplyDraft?.metadata?.auto_reply_shadow || selectedConversation?.last_ai_reply_draft?.metadata?.auto_reply_shadow || null,
    [activeAiReplyDraft?.metadata?.auto_reply_shadow, selectedConversation?.last_ai_reply_draft?.metadata?.auto_reply_shadow]
  );
  const autoReplyShadowLabel = activeAiReplyShadow?.evaluated
    ? `Auto eligible: ${activeAiReplyShadow.eligible ? "yes" : "no"}`
    : "Auto eligible: n/a";
  const autoReplyShadowTone = activeAiReplyShadow?.evaluated
    ? (activeAiReplyShadow.eligible ? "emerald" : "amber")
    : "zinc";
  const selectedTranscriptRows = useMemo(() => {
    const messages = uniqueMessages(selectedConversation?.messages)
      .filter((message) => !isHiddenAiReplyTranscriptMessage(message))
      .map((message) => normalizeTranscriptMessage(message));
    const reactionsByTarget = new Map();
    messages.forEach((message) => {
      if (clean(message.message_type).toLowerCase() !== "reaction") return;
      const targetId = clean(
        message.external_reply_id ||
          message.reaction_target_message_id ||
          message.reactionTargetMessageId ||
          message.target_message_id
      );
      if (!targetId) return;
      const actorKey = isFromMeMessage(message) ? "staff" : "customer";
      if (!reactionsByTarget.has(targetId)) reactionsByTarget.set(targetId, new Map());
      const reactionsByActor = reactionsByTarget.get(targetId);
      const existing = reactionsByActor.get(actorKey);
      const existingAt = new Date(existing?.created_at || 0).getTime() || 0;
      const nextAt = new Date(message.created_at || 0).getTime() || 0;
      if (!existing || nextAt >= existingAt) reactionsByActor.set(actorKey, message);
    });
    return messages
      .filter((message) => clean(message.message_type).toLowerCase() !== "reaction")
      .map((normalizedMessage) => {
        const productCards = normalizeProductCardsValue(normalizedMessage.product_cards || normalizedMessage.productCards);
        const isProductCardMessage = normalizedMessage.message_type === "product_card" || productCards.length > 0;
        const isCommentMessage =
          normalizedMessage.message_type === "comment_inbound" ||
          (normalizedMessage.thread_kind === "comment" && (normalizedMessage.sender_type === "customer" || normalizedMessage.sender_type === "user" || normalizedMessage.direction === "inbound"));
        const isFromMe = isFromMeMessage(normalizedMessage);
        const isCustomer = Boolean(clean(normalizedMessage.customer_message)) && !isFromMe;
        const isStaff = Boolean(clean(normalizedMessage.staff_message)) && !isProductCardMessage;
        const isAiSender = ["assistant", "ai", "bot", "system"].includes(clean(normalizedMessage.sender_type).toLowerCase());
        const isAi = !isStaff && (isAiSender || Boolean(clean(normalizedMessage.ai_answer)) || (normalizedMessage.direction === "outbound" && !isFromMe));
        if (!isCustomer && !isAi && !isStaff && !isProductCardMessage && !isCommentMessage) return null;
        const providerIds = [...new Set([
          normalizedMessage.provider_message_id,
          normalizedMessage.external_message_id,
          normalizedMessage.whatsapp_message_id,
          normalizedMessage.message_id,
          normalizedMessage.id,
        ].map(clean).filter(Boolean))];
        const reactions = providerIds.flatMap((id) => [...(reactionsByTarget.get(id)?.values() || [])]);
        return {
          key: messageKey(normalizedMessage),
          message: normalizedMessage,
          reactions,
          cards: productCards,
          kind: isProductCardMessage ? "product_card" : isCommentMessage ? "comment" : isCustomer ? "customer" : isStaff ? "staff" : "ai",
          visible: true,
          createdAt: absoluteTime(normalizedMessage.created_at),
          channelLabel: channelLabel(normalizedMessage.channel || selectedConversation?.channel),
          postUrl: commentConversationPostUrl(selectedConversation || normalizedMessage),
          conversationMetadata: selectedConversation?.channel_metadata || selectedConversation?.metadata || {},
          mediaUrls: [
            normalizedMessage.image_url,
            normalizedMessage.media_url,
            normalizedMessage.attachment_url,
            normalizedMessage.file_url,
            normalizedMessage.preview_url,
            normalizedMessage.thumbnail_url,
          ].map(clean).filter(Boolean),
        };
      })
      .filter(Boolean);
  }, [selectedConversation?.channel, selectedConversation?.messages]);
  const selectedTranscriptEvents = useMemo(() => asArray(selectedConversation?.system_events), [selectedConversation?.system_events]);
  const lastCustomerMessage = useMemo(
    () => latestCustomerText(selectedConversation?.messages),
    [selectedConversation?.messages]
  );
  const selectedChannelStatus = selectedConversation?.channel
    ? channelStatus[selectedConversation?.channel] || {}
    : {};
  const selectedTokenActive = Boolean(
    selectedChannelStatus.token_valid ||
      (selectedChannelStatus.page_access_token_configured &&
        !["token_expired", "expired", "invalid", "revoked", "error"].includes(clean(selectedChannelStatus.token_status || selectedChannelStatus.token_health_status).toLowerCase()))
  );
  const selectedMessagingActive = Boolean(selectedChannelStatus.live_operational || selectedChannelStatus.effective_enabled || selectedChannelStatus.messaging_active);
  const conversationExpanded = Boolean(isConversationExpanded && selectedConversation && inboxSection === "conversations");
  const fullscreenConversation = conversationExpanded;
  // The expand button used to only stretch the conversation inside the ERP shell:
  // `fixed inset-0` covers the page but still sits under the browser's own chrome.
  // Expanding now also asks the browser for real fullscreen, so the conversation
  // takes over the entire screen. The click is a genuine user gesture, which is
  // what the Fullscreen API requires. Failure is non-fatal — some browsers and
  // embedded webviews refuse it, and the in-page overlay alone is still a usable
  // expanded view.
  const requestConversationFullscreen = useCallback(() => {
    const host = fullscreenHostRef.current;
    if (!host || document.fullscreenElement) return;
    const request = host.requestFullscreen || host.webkitRequestFullscreen || host.msRequestFullscreen;
    try {
      const result = request?.call(host);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      /* keep the in-page overlay */
    }
  }, []);
  const exitConversationFullscreen = useCallback(() => {
    if (!document.fullscreenElement) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    try {
      const result = exit?.call(document);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);
  const handleToggleConversationExpansion = useCallback(() => {
    setIsConversationExpanded((current) => {
      const next = !current;
      if (next) requestConversationFullscreen();
      else exitConversationFullscreen();
      return next;
    });
  }, [requestConversationFullscreen, exitConversationFullscreen]);
  // Leaving fullscreen by any route the button does not own (Esc, F11, the
  // browser's own control) must collapse the layout too, otherwise the UI stays
  // stuck expanded with no obvious way back.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsConversationExpanded(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);
  const canViewAiDebug = useMemo(() => canViewAiDebugPanel(getCurrentUser?.() || {}), []);
  const openProductCardPicker = useCallback((options = {}) => {
    const selectMode = Boolean(options.selectMode);
    setProductCardPickerConfig({
      open: true,
      sizeMode: Boolean(options.sizeMode),
      // Phase 13.4 — the manual "إرسال منتج" picker is multi-select by default (batch up to MAX_BATCH_PRODUCTS).
      // selectMode (AI single-product identity disambiguation "Change product") stays SINGLE-select.
      allowMultiple: options.allowMultiple !== undefined ? Boolean(options.allowMultiple) : !selectMode,
      selectMode,
    });
  }, []);
  const closeProductCardPicker = useCallback(() => {
    setProductCardPickerConfig({ open: false, sizeMode: false, allowMultiple: false, selectMode: false });
  }, []);
  // Phase 11.2 — "Change Product": pick a real catalog product to attach to the suggestion (does NOT send).
  const normalizeChosenSuggestionCard = (c = {}) => ({
    product_id: c.product_id || c.id || null, id: c.product_id || c.id || null, variant_id: c.variant_id || null,
    product_name: c.product_name || c.name || "", name: c.product_name || c.name || "",
    image_url: c.image_url || c.image || c.thumbnail_url || "",
    storefront_url: c.storefront_url || c.product_url || c.url || "", product_url: c.storefront_url || c.product_url || c.url || "",
    color: c.color || "", size: c.size || "",
    price: c.price ?? c.display_price ?? null, display_price: c.display_price ?? c.price ?? null,
    available_sizes: c.available_sizes || c.sizes || [], grounded: false, in_stock: true,
  });
  const handleProductCardPickerSubmit = (cards = []) => {
    if (productCardPickerConfig.selectMode) {
      const first = asArray(cards)[0];
      if (first) { setSuggestionChosenCard(normalizeChosenSuggestionCard(first)); setSuggestionProductRemoved(false); }
      closeProductCardPicker();
      return Promise.resolve();
    }
    return sendProductCards(cards);
  };
  const openReplyCorrection = useCallback((message = {}) => {
    if (!selectedConversation?.session_id) return;
    setCorrectionModal({
      open: true,
      draft: buildReplyCorrectionDraft({ conversation: selectedConversation, message }),
    });
  }, [selectedConversation]);
  const closeReplyCorrection = useCallback(() => {
    setCorrectionModal({ open: false, draft: buildReplyCorrectionDraft() });
  }, []);
  const patchReplyCorrection = useCallback((patch = {}) => {
    setCorrectionModal((current) => ({
      ...current,
      draft: {
        ...current.draft,
        ...patch,
      },
    }));
  }, []);
  const saveReplyCorrection = useCallback(async () => {
    if (!selectedConversation?.session_id || !correctionModal.draft.messageId || !clean(correctionModal.draft.employeeCorrectAnswer)) return;
    setCorrectionSaving(true);
    setError("");
    try {
      await api.post(
        aiReplyCorrectionEndpoint(selectedConversation.session_id, correctionModal.draft.messageId),
        {
          tenant_id: tenantId,
          customer_question: correctionModal.draft.customerQuestion,
          ai_wrong_answer: correctionModal.draft.aiWrongAnswer,
          employee_correct_answer: correctionModal.draft.employeeCorrectAnswer,
          correction_type: correctionModal.draft.correctionType,
          product_id: correctionModal.draft.productId || null,
          channel: correctionModal.draft.channel || selectedConversation.channel || selectedConversation.source || "",
        },
        { headers, perfComponent: "AiInbox.saveCorrection" }
      );
      setToast({ tone: "emerald", text: "تم حفظ التصحيح" });
      closeReplyCorrection();
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر حفظ التصحيح" });
      setError(err?.message || "تعذر حفظ التصحيح");
    } finally {
      setCorrectionSaving(false);
    }
  }, [closeReplyCorrection, correctionModal.draft.aiWrongAnswer, correctionModal.draft.channel, correctionModal.draft.correctionType, correctionModal.draft.customerQuestion, correctionModal.draft.employeeCorrectAnswer, correctionModal.draft.messageId, correctionModal.draft.productId, headers, selectedConversation?.channel, selectedConversation?.session_id, selectedConversation?.source, tenantId]);

  useEffect(() => {
    if (!selectedConversation?.session_id) return;
    const draftText = clean(activeAiReplyDraft?.text || "");
    if (!draftText) return;
    setAiReply((current) => (
      current.sessionId === selectedConversation.session_id && current.text === draftText
        ? {
            ...current,
            validation: current.validation || activeAiReplyDraft?.validation || activeAiReplyDraft?.metadata?.validation || null,
            confidence_engine: current.confidence_engine || activeAiReplyDraft?.confidence_engine || activeAiReplyDraft?.metadata?.confidence_engine || null,
          }
        : {
            sessionId: selectedConversation.session_id,
            text: draftText,
            loading: false,
            error: "",
            validation: activeAiReplyDraft?.validation || activeAiReplyDraft?.metadata?.validation || null,
            confidence_engine: activeAiReplyDraft?.confidence_engine || activeAiReplyDraft?.metadata?.confidence_engine || null,
          }
    ));
    setReplyText((current) => (clean(current) ? current : draftText));
  }, [activeAiReplyDraft?.text, selectedConversation?.session_id]);

  useEffect(() => {
    setEditingAiDraft(false);
  }, [selectedConversation?.session_id]);

  useEffect(() => {
    const channelKey = clean(selectedConversation?.channel || selectedConversation?.source);
    const currentMode = resolveChannelAutoReplyMode(selectedChannelStatus);
    if (channelKey && currentMode !== "off") {
      lastEnabledAutoReplyModeRef.current[channelKey] = currentMode;
      try {
        window.sessionStorage.setItem(lastEnabledAutoReplyModeKey(tenantId, channelKey), currentMode);
      } catch {
        // Ignore storage failures; the in-memory fallback still works for this session.
      }
    }
  }, [
    selectedChannelStatus.ai_replies_enabled,
    selectedChannelStatus.auto_reply_mode,
    selectedConversation?.channel,
    selectedConversation?.source,
  ]);

  const loadAiDebug = useCallback(async () => {
    if (!selectedConversation?.session_id || !canViewAiDebug) return;
    const sessionId = selectedConversation.session_id;
    setAiDebug((current) => ({ ...current, sessionId, loading: true, error: "" }));
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/ai-debug"), {
        params: { tenant_id: tenantId, channel: selectedConversation.channel || selectedConversation.source || "" },
        headers,
        perfComponent: "AiInbox.aiDebug",
      });
      setAiDebug((current) => ({ ...current, sessionId, loading: false, data: payload, error: "" }));
    } catch (err) {
      setAiDebug((current) => ({ ...current, sessionId, loading: false, error: err?.message || "تعذر تحميل بيانات تشخيص الذكاء الاصطناعي" }));
    }
  }, [canViewAiDebug, headers, selectedConversation?.channel, selectedConversation?.session_id, selectedConversation?.source, tenantId]);

  const toggleAiDebug = useCallback(() => {
    setAiDebug((current) => {
      const open = !current.open;
      return { ...current, open, error: open ? current.error : "" };
    });
  }, []);

  useEffect(() => {
    if (!aiDebug.open || !canViewAiDebug || !selectedConversation?.session_id) return;
    void loadAiDebug();
  }, [aiDebug.open, canViewAiDebug, loadAiDebug, selectedConversation?.session_id]);

  const loadAiTrace = useCallback(async () => {
    if (!selectedConversation?.session_id || !isWhatsappChannel(selectedConversation.channel || selectedConversation.source)) return;
    const sessionId = selectedConversation.session_id;
    setAiTrace((current) => ({ ...current, sessionId, loading: true, error: "" }));
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/ai-trace"), {
        params: { tenant_id: tenantId, channel: "whatsapp", limit: 10 },
        headers,
        perfComponent: "AiInbox.aiTrace",
      });
      setAiTrace((current) => ({ ...current, sessionId, loading: false, data: payload, error: "" }));
    } catch (err) {
      setAiTrace((current) => ({ ...current, sessionId, loading: false, error: err?.message || "تعذر تحميل أثر الذكاء الاصطناعي" }));
    }
  }, [headers, selectedConversation?.channel, selectedConversation?.session_id, selectedConversation?.source, tenantId]);

  const openAiTrace = useCallback(() => {
    setAiTrace((current) => ({ ...current, open: true, error: "" }));
    void loadAiTrace();
  }, [loadAiTrace]);

  const loadOlderMessages = useCallback(async ({ forceHydrate = false } = {}) => {
    if (!selectedConversation?.session_id || olderMessagesLoading || isLoadingOlderRef.current) return;
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    const currentMessages = asArray(selectedConversation.messages);
    // forceHydrate: the window on screen came from the cache, so fetch the
    // newest page (no `before` cursor) to revalidate it against the server.
    const shouldHydrateFullPage = forceHydrate === true
      || (currentMessages.length <= 1 && Number(selectedConversation.message_count || 0) > currentMessages.length);
    const before = shouldHydrateFullPage ? "" : selectedConversation.next_messages_before || currentMessages[0]?.created_at || "";
    const beforeId = shouldHydrateFullPage ? "" : selectedConversation.next_messages_before_id || currentMessages[0]?.id || "";
    if (!shouldHydrateFullPage && !before) return;
    const scroller = transcriptScrollRef.current;
    if (scroller) {
      restoreScrollStateRef.current = {
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      };
    }
    isLoadingOlderRef.current = true;
    setOlderMessagesLoading(true);
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/messages"), {
        params: { tenant_id: tenantId, ...(before ? { before, before_id: beforeId } : {}), limit: 30 },
        headers,
        perfComponent: "AiInbox.messages.loadOlder",
      });
      hydratedThreadsRef.current.add(clean(conversationIdentifier));
      patchConversation(conversationIdentifier, (conversation) => {
        const existing = asArray(conversation.messages);
        const incoming = asArray(payload.messages);
        // Older-page loads prepend (incoming is strictly older). A full-page
        // hydrate may merge over a cache-primed window that reaches FURTHER BACK
        // than this page, and merge keeps first-seen order, so order the result
        // chronologically (falling back to the prepend order when any message
        // lacks a timestamp — e.g. an in-flight optimistic bubble).
        const mergedMessages = shouldHydrateFullPage
          ? inboxCache.orderMessages(
              mergeMessagesByIdentity([...existing, ...incoming]),
              mergeMessagesByIdentity([...incoming, ...existing])
            )
          : mergeMessagesByIdentity([...incoming, ...existing]);
        return {
          ...conversation,
          messages: mergedMessages,
          message_count: payload.total ?? conversation.message_count,
          older_messages_available: Boolean(payload.has_more),
          next_messages_before: payload.next_before || mergedMessages[0]?.created_at || "",
          next_messages_before_id: payload.next_before_id || mergedMessages[0]?.id || "",
          conversationHydrated: true,
        };
      });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر تحميل الرسائل الأقدم" });
    } finally {
      setOlderMessagesLoading(false);
      isLoadingOlderRef.current = false;
    }
  }, [headers, olderMessagesLoading, patchConversation, selectedConversation, selectedConversationRouteId, tenantId]);

  // WARM THREAD (stale-while-revalidate) — shared inboxCache.
  // Opening a conversation renders its cached message window immediately; the
  // authoritative page is fetched by the hydration effect below and merged over
  // it, so the thread never blanks or flashes.
  useEffect(() => {
    const key = clean(selectedConversation?.conversation_key || selectedConversation?.session_id || "");
    if (!key || cachePrimedThreadsRef.current.has(key)) return undefined;
    let active = true;
    inboxCache.primeThread(key).then((cached) => {
      const cachedMessages = asArray(cached?.messages);
      if (!active || !cachedMessages.length) return;
      cachePrimedThreadsRef.current.add(key);
      patchConversation(key, (conversation) => ({
        ...conversation,
        messages: mergeMessagesByIdentity([...cachedMessages, ...asArray(conversation.messages)]),
      }));
    });
    return () => { active = false; };
  }, [patchConversation, selectedConversation?.conversation_key, selectedConversation?.session_id]);

  // Persist the open thread's message window. One funnel covers hydration,
  // older-message loads, realtime appends and optimistic send/reconcile.
  // Debounced + async inside the shared module, so it never blocks rendering.
  useEffect(() => {
    const key = clean(selectedConversation?.conversation_key || selectedConversation?.session_id || "");
    const messages = asArray(selectedConversation?.messages);
    if (key && messages.length) inboxCache.saveThread(key, messages, mergeMessagesByIdentity);
  }, [selectedConversation]);

  useEffect(() => {
    if (!selectedConversation?.session_id) return;
    if (isHydratingConversationRef.current || isLoadingOlderRef.current || isAppendingNewMessageRef.current || isRefreshingRef.current) return;
    const key = clean(selectedConversation.conversation_key || selectedConversation.session_id);
    // A cache-primed thread already shows messages, so the ">1 message" shortcut
    // would skip revalidation entirely and leave it stale. Revalidate it exactly
    // once per session (marked up-front so a failing fetch can't retry-loop).
    const primedNeedsRevalidation = cachePrimedThreadsRef.current.has(key) && !hydratedThreadsRef.current.has(key);
    if (asArray(selectedConversation.messages).length > 1 && !primedNeedsRevalidation) return;
    if (primedNeedsRevalidation) hydratedThreadsRef.current.add(key);
    void loadOlderMessages({ forceHydrate: primedNeedsRevalidation });
  }, [loadOlderMessages, selectedConversation?.messages?.length, selectedConversation?.session_id]);

  const currentAssignName = assignNameDraft.sessionId === selectedConversation?.session_id
    ? assignNameDraft.value
    : selectedConversation?.assigned_user?.name || selectedConversation?.assigned_user_name || "";

  useEffect(() => {
    const nextEmployeeId = clean(
      selectedConversation?.channel_metadata?.assigned_employee_id ||
      selectedConversation?.assigned_user?.id ||
      selectedConversation?.assigned_user_id ||
      ""
    );
    setLeadAssignEmployeeId(nextEmployeeId);
  }, [selectedConversation?.assigned_user?.id, selectedConversation?.assigned_user_id, selectedConversation?.channel_metadata?.assigned_employee_id, selectedConversation?.session_id]);

  const updateAssignName = (value) => {
    setAssignNameDraft({ sessionId: selectedConversation?.session_id || "", value });
  };

  const updateDraft = async (draft, action) => {
    setLoading(true);
    setError("");
    try {
      if (action === "confirm") {
        await api.post("/ai-agent/orders/confirm", { tenant_id: tenantId, order_id: draft.id }, { headers });
      } else {
        await api.patch(`/ai-agent/orders/${draft.id}/status`, { tenant_id: tenantId, status: action }, { headers });
      }
      await loadAll();
    } catch (err) {
      setError(err?.message || "تعذر تحديث المسودة");
    } finally {
      setLoading(false);
    }
  };

  const updateConversationAction = async (action) => {
    if (!selectedConversation?.session_id) return;
    const channel = selectedConversation?.channel || selectedConversation?.source || "";
    setLoading(true);
    setError("");
    try {
      if (action === "takeover") {
        await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/takeover"), { tenant_id: tenantId, channel }, { headers });
      } else if (action === "return") {
        const payload = await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/return-to-ai"), { tenant_id: tenantId, channel }, { headers });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          conversation_status: "ai_active",
          status: "ai_active",
          human_takeover: false,
          ai_paused: false,
          assigned_staff_id: null,
          assigned_user: null,
          assigned_user_id: null,
          assigned_user_name: "",
          takeover_started_at: null,
          taken_over_at: null,
          escalation_reason: null,
          ai_escalation_reason: null,
          last_escalation_keyword: null,
          escalated_at: null,
          returned_to_ai_at: returned.returned_to_ai_at || new Date().toISOString(),
        }));
        setToast({ tone: "emerald", text: "أعيدت المحادثة إلى الذكاء الاصطناعي." });
      } else if (action === "reopen") {
        const payload = await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/reopen"), { tenant_id: tenantId, channel }, { headers });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          conversation_status: "ai_active",
          status: "ai_active",
          closed: false,
          human_takeover: false,
          ai_paused: false,
          assigned_staff_id: null,
          assigned_user: null,
          assigned_user_id: null,
          assigned_user_name: "",
          takeover_started_at: null,
          taken_over_at: null,
          closed_at: null,
          escalation_reason: null,
          ai_escalation_reason: null,
          last_escalation_keyword: null,
          escalated_at: null,
          returned_to_ai_at: returned.returned_to_ai_at || new Date().toISOString(),
        }));
        setToast({ tone: "emerald", text: "تمت إعادة فتح المحادثة وإعادتها إلى الذكاء الاصطناعي." });
      } else if (action === "assign") {
        const payload = await api.patch(aiAgentInboxEndpoint(selectedConversation?.session_id, "/assign"), { tenant_id: tenantId, assigned_user_name: currentAssignName, channel }, { headers, perfComponent: "AiInbox.assign" });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          assigned_user_name: currentAssignName,
          assigned_user: currentAssignName ? { ...(conversation.assigned_user || {}), name: currentAssignName } : conversation.assigned_user,
        }));
      } else if (action === "close") {
        const payload = await api.patch(aiAgentInboxEndpoint(selectedConversation?.session_id, "/close"), { tenant_id: tenantId, channel }, { headers, perfComponent: "AiInbox.close" });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          conversation_status: "closed",
          status: "closed",
          closed_at: returned.closed_at || new Date().toISOString(),
        }));
      }
      if (action === "takeover" || action === "close" || action === "reopen" || action === "return" || action === "assign") {
        await loadAll({ silent: true });
      }
    } catch (err) {
      setError(err?.message || "تعذر تحديث المحادثة");
    } finally {
      setLoading(false);
    }
  };

  const updateConversationLabels = useCallback(async (nextLabels) => {
    if (!selectedConversation?.session_id) return false;
    const labels = normalizeAiInboxConversationLabels(nextLabels);
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    setLeadActionLoading("labels");
    setError("");
    try {
      const payload = await api.patch(aiAgentInboxEndpoint(sessionId, "/labels"), {
        tenant_id: tenantId,
        labels,
      }, { headers, timeoutMs: 12000, perfComponent: "AiInbox.updateConversationLabels" });
      const returned = payload.conversation || {};
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        ...returned,
        conversation_labels: payload.labels || returned.conversation_labels || labels,
        lead_status: payload.lead_status || returned.lead_status || conversation.lead_status,
        channel_metadata: {
          ...(conversation.channel_metadata || {}),
          ...(returned.channel_metadata || {}),
          conversation_labels: payload.labels || returned.conversation_labels || labels,
          lead_status: payload.lead_status || returned.lead_status || conversation.channel_metadata?.lead_status,
        },
        customer_profile: {
          ...(conversation.customer_profile || {}),
          ...(returned.customer_profile || {}),
          conversation_labels: payload.labels || returned.conversation_labels || labels,
        },
      }));
      setToast({ tone: "emerald", text: "تم حفظ Labels العميل" });
      return true;
    } catch (err) {
      setError(err?.message || "تعذر تحديث Labels العميل");
      setToast({ tone: "rose", text: err?.message || "تعذر تحديث Labels العميل" });
      return false;
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, selectedConversation?.conversation_key, selectedConversation?.session_id, tenantId]);

  const debugMessengerProfile = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    setProfileDebugging(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/debug-messenger-profile"), {
        tenant_id: tenantId,
        external_customer_id: selectedConversation.external_customer_id || "",
      }, { headers, perfComponent: "AiInbox.debugMessengerProfile" });
      window.alert(JSON.stringify(payload, null, 2));
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        customer_avatar_url:
          payload.stored_ai_channel_conversations_customer_avatar_url ||
          payload.stored_ai_support_sessions_customer_avatar_url ||
          payload.stored_profile_pic_url ||
          payload.profile_pic ||
          conversation.customer_avatar_url,
        customer_profile: {
          ...(conversation.customer_profile || {}),
          profile_pic:
            payload.stored_customer_profile_profile_pic ||
            payload.stored_profile_pic_url ||
            payload.profile_pic ||
            conversation.customer_profile?.profile_pic ||
            "",
          profile_pic_url:
            payload.stored_profile_pic_url ||
            payload.profile_pic ||
            conversation.customer_profile?.profile_pic_url ||
            "",
          avatar_url:
            payload.stored_profile_pic_url ||
            payload.profile_pic ||
            conversation.customer_profile?.avatar_url ||
            "",
        },
        channel_metadata: {
          ...(conversation.channel_metadata || {}),
          profile_pic:
            payload.stored_channel_metadata_profile_pic ||
            payload.profile_pic ||
            conversation.channel_metadata?.profile_pic ||
            "",
        },
      }));
      await loadAll({ silent: true });
    } catch (err) {
      window.alert(JSON.stringify({ success: false, message: err?.message || "تعذر تشخيص ملف ماسنجر" }, null, 2));
      setError(err?.message || "تعذر تشخيص ملف ماسنجر");
    } finally {
      setProfileDebugging(false);
    }
  };

  const resetAiState = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation.session_id;
    const encodedSessionId = encodeURIComponent(sessionId);
    const resetUrl = `/ai-inbox/conversations/${encodedSessionId}/reset-ai-state`;
    setResettingAiState(true);
    setError("");
    try {
      await api.post(
        resetUrl,
        { tenant_id: tenantId },
        { headers, perfComponent: "AiInbox.resetAiState" }
      );
      setToast({ tone: "emerald", text: "AI state reset successfully" });
      await loadAll({ silent: true });
      if (aiDebug.open && aiDebug.sessionId === sessionId) {
        await loadAiDebug();
      }
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر إعادة ضبط حالة الذكاء الاصطناعي" });
      setError(err?.message || "تعذر إعادة ضبط حالة الذكاء الاصطناعي");
    } finally {
      setResettingAiState(false);
    }
  };

  const saveEditedAiReplyCorrection = async ({ sentMessageId = "", aiReplyDraft = null, employeeCorrectAnswer = "", allowSameText = false, metadata = {} } = {}) => {
    const sessionId = selectedConversation?.session_id;
    const conversation = selectedConversation || {};
    const draft = aiReplyDraft || selectedConversation?.ai_reply_draft || selectedConversation?.last_ai_reply_draft || null;
    const normalizedDraftText = clean(draft?.text || "");
    const correctedText = clean(employeeCorrectAnswer || "");
    if (!sessionId || !sentMessageId || !normalizedDraftText || !correctedText) return;
    if (!allowSameText && normalizedDraftText === correctedText) return;
    if (draft?.status && draft.status !== "not_sent" && draft.status !== "draft") return;

    const customerQuestion = [...asArray(conversation.messages)]
      .slice()
      .reverse()
      .find((item) => clean(item.customer_message || item.message_text || item.last_message || ""));

    await api.post(
      aiReplyCorrectionEndpoint(sessionId, sentMessageId),
      {
        tenant_id: tenantId,
        customer_question: clean(customerQuestion?.customer_message || customerQuestion?.message_text || customerQuestion?.last_message || conversation.latest_message_preview || conversation.last_message || ""),
        ai_wrong_answer: normalizedDraftText,
        employee_correct_answer: correctedText,
        correction_type: draft?.metadata?.correction_type || "other",
        product_id: draft?.metadata?.product_id || null,
        channel: conversation.channel || conversation.source || "",
        metadata: {
          ...(draft?.metadata || {}),
          ...metadata,
        },
      },
      { headers, perfComponent: "AiInbox.aiReplyCorrection" }
    );
  };

  const sendCommentReply = async (overrideText = "", options = {}) => {
    const message = clean(overrideText || replyText);
    if (!selectedConversation?.session_id || !message) return;
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    const targetCommentId = clean(
      options.commentId ||
        options.comment_id ||
        options.external_message_id ||
        options.externalMessageId ||
        options.message?.comment_id ||
        options.message?.external_message_id ||
        selectedConversation?.channel_metadata?.comment_id ||
        selectedConversation?.channel_metadata?.lead?.comment_id ||
        selectedConversation?.external_comment_id ||
        selectedConversation?.comment_id ||
        ""
    );
    if (!targetCommentId) {
      setError("تعذر تحديد الكومنت المرتبط بهذه المحادثة");
      return;
    }
    const now = new Date().toISOString();
    setLoading(true);
    setError("");
    try {
      const payload = await api.post(`/ai-inbox/comments/${encodeURIComponent(targetCommentId)}/reply`, {
        tenant_id: tenantId,
        reply_text: message,
      }, { headers, perfComponent: "AiInbox.commentReply" });
      setToast({ tone: "emerald", text: "Comment reply sent" });
      setReplyText("");
      if (payload.message) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          messages: mergeMessagesByIdentity([...asArray(conversation.messages), payload.message]),
          latest_message_preview: message,
          last_activity_at: payload.message.created_at || now,
          updated_at: payload.message.created_at || now,
        }));
      }
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "فشل إرسال رد الكومنت" });
      setError(err?.message || "تعذر إرسال رد الكومنت");
    } finally {
      setLoading(false);
    }
  };

  const sendManualReply = async (overrideText = "", options = {}) => {
    const message = clean(overrideText || replyText);
    if (!selectedConversation?.session_id || !message) return { ok: false };
    const sessionId = selectedConversation?.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    const clientRequestId = buildClientRequestId();
    const messageIdentityKey = buildMessageIdentityKey({
      tenantId,
      sessionId,
      direction: "outbound",
      clientRequestId,
    });
    const activeDraft = selectedConversation?.ai_reply_draft || selectedConversation?.last_ai_reply_draft || null;
    const validationState = normalizeValidationSummary(
      selectedConversation?.last_ai_reply_validation ||
      activeDraft?.validation ||
      activeDraft?.metadata?.validation ||
      {}
    );
    const confidenceState = normalizeConfidenceEngineSummary(
      selectedConversation?.last_ai_reply_confidence_engine ||
      activeDraft?.confidence_engine ||
      activeDraft?.metadata?.confidence_engine ||
      {}
    );
    const validationWarnings = [
      ...asArray(validationState.violations).map((item) => clean(item?.message || item?.type || item)),
      ...asArray(validationState.warnings).map((item) => clean(item?.message || item?.type || item)),
    ].filter(Boolean);
    const confidenceWarnings = [
      ...asArray(confidenceState.reasons).map((item) => clean(item)),
      ...Object.entries(confidenceState.riskFlags || {}).filter(([, value]) => Boolean(value)).map(([key]) => clean(key)),
    ].filter(Boolean);
    const sendWarnings = [...new Set([...validationWarnings, ...confidenceWarnings])].slice(0, 5);
    const warningCount = sendWarnings.length;
    console.info("[ai-support] sendWarnings", {
      warningCount,
      sendWarnings,
      sessionId,
      validationViolationsCount: validationState.violationsCount,
      validationWarningsCount: validationState.warningsCount,
      confidenceDecision: confidenceState.decision,
      confidenceReasonsCount: confidenceState.reasonsCount,
      confidenceRiskFlagsCount: confidenceState.riskFlagsCount,
    });
    if (warningCount > 0) {
      const confirmed = window.confirm(sendWarnings.join("\n"));
      if (!confirmed) return { ok: false };
    }
    const now = new Date().toISOString();
    const allowSameTextCorrection = options.allowSameTextCorrection === true || editingAiDraft;
    const correctionMetadata = options.correctionMetadata || {};
    const sendFlow = options.flow || (allowSameTextCorrection ? "edit" : "normal");
    // Phase 11.2 A/B — assisted approval comes ONLY from the AI card's Approve (flow:"approve" / explicit flag).
    // The manual composer is always a separate manual-reply path (→ human_takeover), even while the card is in
    // inline-edit mode. The server re-validates this flag against a real current draft.
    const assistedApproval = options.assistedApproval === true || sendFlow === "approve";
    // Atomic in-flight guard: a rapid double-click can fire twice before the
    // disabled state renders. Placed after the (synchronous) confirm prompt and
    // before the optimistic bubble, so a blocked second click neither sends a
    // duplicate request nor leaves a stray "sending" bubble behind.
    if (sendingReplyRef.current) return { ok: false };
    sendingReplyRef.current = true;
    const optimistic = {
      id: `sending-${Date.now()}`,
      session_id: sessionId,
      client_request_id: clientRequestId,
      message_identity_key: messageIdentityKey,
      customer_message: "",
      ai_answer: "",
      staff_message: message,
      sender_type: "staff",
      manual_message: true,
      staff_user_name: "Staff",
      delivery_status: "sending",
      created_at: now,
    };
    patchConversation(conversationIdentifier, (conversation) => ({
      ...conversation,
      messages: [...asArray(conversation.messages), optimistic],
      // Phase 11.2 A/B — assisted approval keeps the conversation assisted; only a manual reply takes over.
      conversation_status: assistedApproval ? (conversation.conversation_status || "ai_active") : "human_takeover",
      status: assistedApproval ? (conversation.status || "ai_active") : "human_takeover",
      ai_paused: assistedApproval ? Boolean(conversation.ai_paused) : true,
      latest_message_preview: message,
      last_activity_at: now,
      updated_at: now,
    }));
    setReplyText("");
    setReplySending(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/send"), { tenant_id: tenantId, message, client_request_id: clientRequestId, message_identity_key: messageIdentityKey, assisted_approval: assistedApproval, product_id: correctionMetadata?.product_id || null, product_disposition: correctionMetadata?.product_disposition || null }, { headers, perfComponent: "AiInbox.sendManualReply" });
      if (payload.message) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ai_reply_draft: null,
          last_ai_reply_draft: null,
          last_ai_reply_validation: null,
          last_ai_reply_confidence_engine: null,
          last_ai_reply_draft_updated_at: null,
          messages: mergeMessagesByIdentity([...asArray(conversation.messages).filter((item) => item.id !== optimistic.id), payload.message]),
          latest_message_preview: message,
          last_activity_at: payload.message.created_at || now,
          updated_at: payload.message.created_at || now,
        }));
        let correctionSaved = true;
        try {
          await saveEditedAiReplyCorrection({
            sentMessageId: payload.message.id || "",
            aiReplyDraft: activeDraft,
            employeeCorrectAnswer: message,
            allowSameText: allowSameTextCorrection,
            metadata: correctionMetadata,
          });
        } catch (error) {
          correctionSaved = false;
          console.warn("[ai-inbox][ai-reply-correction] skipped", {
            session_id: sessionId,
            message_id: payload.message?.id || "",
            error: error?.message || String(error),
          });
          setToast({ tone: "amber", text: "تم الإرسال، لكن لم يتم حفظ التصحيح" });
        }
        setEditingAiDraft(false);
        if (sendFlow === "approve") {
          setToast({ tone: "emerald", text: "تم اعتماد رد الذكاء الاصطناعي وإرساله" });
        } else if (allowSameTextCorrection) {
          setToast({
            tone: correctionSaved ? "emerald" : "amber",
            text: correctionSaved ? "تم إرسال الرد المعدل وحفظ التصحيح للتعلم" : "تم الإرسال، لكن لم يتم حفظ التصحيح",
          });
        } else {
          setToast({ tone: "emerald", text: "Message sent" });
        }
      } else {
        setToast({ tone: "emerald", text: "Message sent" });
      }
      return { ok: true, message: payload?.message || null };
    } catch (err) {
      const failedMessage = err?.responseBody?.failed_message || null;
      const stale = err?.responseBody?.code === "STALE_SUGGESTION";
      // STALE/SUPERSEDED is NOT a provider failure: the server blocked the send because a newer customer message
      // arrived and never called the provider — nothing reached the customer. Present it distinctly (not a red
      // "failed" bubble): drop the optimistic bubble entirely and tell the operator the old suggestion was
      // cancelled. The fresh current suggestion (tied to the newer inbound) is surfaced by the existing
      // source_message_id reconciliation — we never touch it here.
      if (stale) {
        setToast({ tone: "amber", text: "لم يتم الإرسال — وصلت رسالة أحدث من العميل. تم إلغاء الاقتراح القديم." });
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          messages: asArray(conversation.messages).filter((item) => item.id !== optimistic.id),
        }));
        return { ok: false, stale: true, superseded: true };
      }
      const friendlyError = err?.responseBody?.delivery_error || err?.responseBody?.message || err?.message || "فشل الإرسال";
      setToast({ tone: "rose", text: friendlyError });
      setError(friendlyError);
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        messages: failedMessage
          ? mergeMessagesByIdentity([
              ...asArray(conversation.messages).filter((item) => item.id !== optimistic.id),
              failedMessage,
            ])
          : asArray(conversation.messages).map((item) => item.id === optimistic.id ? { ...item, delivery_status: "failed", delivery_error: friendlyError } : item),
      }));
      return { ok: false, stale, error: friendlyError };
    } finally {
      sendingReplyRef.current = false;
      setReplySending(false);
    }
  };

  const sendCurrentReply = async (overrideText = "", options = {}) => {
    if (isCommentConversation(selectedConversation || {})) {
      return sendCommentReply(overrideText);
    }
    return sendManualReply(overrideText, options);
  };

  // Phase 11.2 — inline edit INSIDE the card (does NOT touch the manual composer). The composer stays a
  // separate manual-reply path. Approve & Send uses the inline edited text.
  const handleEditAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionText) return;
    setEditingAiDraft(true);
    setDismissedAiSuggestionKey("");
    setAiSuggestionEditText(activeAiSuggestionText);
  }, [activeAiSuggestionText]);
  const handleCancelEditAiSuggestion = useCallback(() => {
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
  }, []);

  // Phase 11.2 — PACKAGE Approve & Send: send the (approved/edited) TEXT first (stale-guarded), then the approved
  // grounded PRODUCT CARD via the canonical product-card sender. One employee action. If the text send is stale
  // or fails, the card is NOT sent (whole package blocked). Plain async fn (not useCallback) so it always closes
  // over the current sendProductCards, which is defined later in this component.
  const handleApproveAiSuggestion = async () => {
    if (!activeAiSuggestionText) return;
    // Phase 13.4 — IDENTITY DISAMBIGUATION stays single-select: an ambiguous match still requires picking exactly
    // one product (or removing it). RECOMMENDATION mode skips this — the operator may send several (or none).
    if (!isRecommendationSuggestion && suggestionSendPackage?.product_ambiguous && !suggestionChosenCard && !suggestionProductRemoved) {
      setToast({ tone: "amber", text: "فيه أكتر من منتج مطابق — اختر المنتج المطلوب أو احذفه قبل الإرسال" });
      return;
    }
    // Phase 12.2 — the requested size is available in multiple colours: require a colour pick before sending.
    if (!isRecommendationSuggestion && suggestionSendPackage?.color_choice_required && !suggestionChosenCard && !suggestionProductRemoved) {
      setToast({ tone: "amber", text: "المقاس متاح بأكتر من لون — اختار اللون المطلوب قبل الإرسال" });
      return;
    }
    // Phase 13.4 — the set of grounded products to send with the reply. Recommendation batch → the ordered
    // multi-selection; otherwise → the single (kept/chosen) card. Both go through the same FE-sequential sender.
    const card = effectiveSuggestionCard;
    const recommendationCards = isRecommendationSuggestion ? suggestionRecommendationCards : [];
    const cardsToSend = recommendationCards.length ? recommendationCards : (card ? [card] : []);
    const disposition = suggestionProductRemoved
      ? "removed"
      : (recommendationCards.length ? "recommendation_batch" : (suggestionChosenCard ? "changed" : (suggestionDraftCard ? "kept" : "none")));
    // Send the INLINE-edited text when the employee edited the suggestion; otherwise the unchanged suggestion.
    const textToSend = editingAiDraft && clean(aiSuggestionEditText) ? clean(aiSuggestionEditText) : activeAiSuggestionText;
    const result = await sendCurrentReply(textToSend, {
      allowSameTextCorrection: true,
      flow: "approve",
      assistedApproval: true,
      correctionMetadata: {
        source: "ai_suggestion_approved",
        approved_ai_reply: true,
        product_disposition: disposition,
        product_id: cardsToSend[0]?.product_id || cardsToSend[0]?.id || null,
        variant_id: cardsToSend[0]?.variant_id || null,
        product_count: cardsToSend.length,
      },
    });
    // Text failed or was stale (409) → keep the suggestion pending/actionable (do NOT clear the card/selection).
    if (!result?.ok) return;
    // Text succeeded. Send the selected products FE-sequentially (each its own request → honest per-card result).
    let cardOk = true;
    let cardSummary = { total: 0, sent: 0, failed: 0 };
    if (cardsToSend.length) {
      const res = await sendProductCards(cardsToSend, { assistedApproval: true, suppressToast: true });
      cardSummary = res?.summary || cardSummary;
      cardOk = cardSummary.failed === 0;
      if (!cardOk) {
        // Phase 13.4/§22 — text is COMPLETED and the products that sent are completed; only the failed products
        // are surfaced honestly. The suggestion is still consumed (never falsely restored as unsent).
        const failed = cardSummary.total - cardSummary.sent;
        setToast({ tone: "amber", text: cardSummary.sent > 0
          ? `الرد اتبعت و${cardSummary.sent} منتج — فشل إرسال ${failed === 1 ? "منتج واحد" : `${failed} منتجات`}، ابعتهم من زرار المنتج`
          : "الرد اتبعت، لكن إرسال المنتجات فشل — ابعتهم من زرار المنتج" });
      }
    }
    // Phase 11.2 lifecycle — a successful assisted approval CONSUMES the suggestion: remove the actionable card
    // immediately (no page refresh) and reset all local suggestion state so it can never be re-approved. The
    // backend already cleared the draft; dismissing the key also survives any refetch race.
    setDismissedAiSuggestionKey(activeAiSuggestionKey);
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
    setSuggestionProductRemoved(false);
    setSuggestionChosenCard(null);
    setSuggestionRecommendationCards([]);
    // Phase 13 — a completed assisted approval CONSUMES the draft. Optimistically clear the AUTHORITATIVE draft in
    // conversation state to match the backend (which cleared it to {}), so activeAiReplyDraft becomes empty at once
    // and EVERY derived surface (reply card, validation, confidence, grounding facts, product/colour choices,
    // Product-to-Send preview, send-package) collapses immediately — no refetch/cache race can re-show the
    // completed suggestion. Only reached after result.ok (a stale/failed TEXT send returns above and stays actionable).
    const completedTombstone = { status: "sent", text: "", source_message_id: suggestionSourceId || null, metadata: { source_message_id: suggestionSourceId || null }, updated_at: new Date().toISOString() };
    patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conv) => ({ ...conv, ai_reply_draft: completedTombstone, last_ai_reply_draft: completedTombstone, last_ai_reply_draft_updated_at: completedTombstone.updated_at }));
    if (cardOk) {
      const n = cardSummary.sent || cardsToSend.length;
      setToast({ tone: "emerald", text: n > 1
        ? `✓ تم اعتماد وإرسال اقتراح AI مع ${n} منتجات`
        : (n === 1 ? "✓ تم اعتماد وإرسال اقتراح AI مع المنتج" : "✓ تم اعتماد وإرسال اقتراح AI") });
    }
  };

  const handleDismissAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionKey) return;
    setEditingAiDraft(false);
    setDismissedAiSuggestionKey(activeAiSuggestionKey);
  }, [activeAiSuggestionKey]);
  // Phase 11.2 — product-attachment controls on the suggestion.
  const handleRemoveSuggestionProduct = useCallback(() => { setSuggestionProductRemoved(true); setSuggestionChosenCard(null); }, []);
  const handleChangeSuggestionProduct = useCallback(() => { openProductCardPicker({ selectMode: true }); }, [openProductCardPicker]);
  const handleChooseSuggestionProduct = useCallback((choice) => { if (choice) { setSuggestionChosenCard(choice); setSuggestionProductRemoved(false); } }, []);
  // Phase 13.4 — toggle a grounded product in the RECOMMENDATION batch (multi-select, ordered, max 5). Blocking
  // the 6th selection surfaces the limit — never a silent drop.
  const handleToggleRecommendationCard = useCallback((choice) => {
    if (!choice) return;
    setSuggestionRecommendationCards((current) => {
      const { list, blocked } = toggleProductSelection(current, choice, { max: MAX_BATCH_PRODUCTS });
      if (blocked) setToast({ tone: "amber", text: maxBatchReachedText() });
      return list;
    });
  }, []);

  const createLeadCustomer = async () => {
    if (!selectedConversation?.session_id) return;
    setLeadActionLoading("create_customer");
    setError("");
    try {
      const payload = await api.post(aiAgentInboxEndpoint(selectedConversation.session_id, "/create-customer"), {
        tenant_id: tenantId,
      }, { headers, perfComponent: "AiInbox.createLeadCustomer" });
      if (payload?.conversation) {
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          customer_profile: payload.conversation.customer_profile || conversation.customer_profile,
          channel_metadata: payload.conversation.channel_metadata || conversation.channel_metadata,
        }));
      }
      setToast({ tone: "emerald", text: "تم إنشاء العميل" });
      await loadAll({ silent: true });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر إنشاء العميل" });
      setError(err?.message || "تعذر إنشاء العميل");
    } finally {
      setLeadActionLoading("");
    }
  };

  const createLeadOpportunity = async () => {
    if (!selectedConversation?.session_id) return;
    setLeadActionLoading("create_opportunity");
    setError("");
    try {
      const payload = await api.post(aiAgentInboxEndpoint(selectedConversation.session_id, "/create-opportunity"), {
        tenant_id: tenantId,
      }, { headers, perfComponent: "AiInbox.createLeadOpportunity" });
      if (payload?.conversation) {
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          customer_profile: payload.conversation.customer_profile || conversation.customer_profile,
          channel_metadata: payload.conversation.channel_metadata || conversation.channel_metadata,
        }));
      }
      setToast({ tone: "emerald", text: "تم إنشاء فرصة البيع" });
      await loadAll({ silent: true });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر إنشاء فرصة البيع" });
      setError(err?.message || "تعذر إنشاء فرصة البيع");
    } finally {
      setLeadActionLoading("");
    }
  };

  const sendLeadPrivateMessage = async (targetComment = null) => {
    if (!selectedConversation?.session_id) return;
    const defaultMessage = buildLeadPrivateMessageText(selectedConversation, targetComment || {});
    const message = clean(replyText || defaultMessage);
    if (!message) return;
    setLeadActionLoading("private_message");
    try {
      if (isCommentConversation(selectedConversation || {})) {
        await api.post(aiAgentInboxEndpoint(selectedConversation.session_id, "/private-message"), {
          tenant_id: tenantId,
          message,
          comment_id: clean(targetComment?.comment_id || targetComment?.external_message_id || targetComment?.id || ""),
        }, { headers, perfComponent: "AiInbox.privateLeadMessage" });
      } else {
        await sendManualReply(message);
        return;
      }
      setReplyText("");
      setToast({ tone: "emerald", text: "تم إرسال الرسالة الخاصة" });
      await loadAll({ silent: true });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر إرسال الرسالة الخاصة" });
      setError(err?.message || "تعذر إرسال الرسالة الخاصة");
    } finally {
      setLeadActionLoading("");
    }
  };

  const sendLeadCommentReplyQuick = async (targetComment = null) => {
    if (!selectedConversation?.session_id || !isCommentConversation(selectedConversation || {})) return;
    const targetCommentId = clean(targetComment?.comment_id || targetComment?.external_message_id || targetComment?.id || selectedConversation?.channel_metadata?.comment_id || selectedConversation?.channel_metadata?.lead?.comment_id || selectedConversation?.external_comment_id || selectedConversation?.comment_id || "");
    if (!targetCommentId) {
      setError("تعذر تحديد التعليق المطلوب");
      return;
    }
    const message = clean(replyText || buildLeadCommentReplyText(selectedConversation, targetComment || {}));
    if (!message) return;
    setLeadActionLoading("comment_reply");
    try {
      await sendCommentReply(message, { commentId: targetCommentId, message: targetComment });
      await loadAll({ silent: true });
    } finally {
      setLeadActionLoading("");
    }
  };

  const assignLeadEmployee = async () => {
    if (!selectedConversation?.session_id || !leadAssignEmployeeId) return;
    const selectedEmployee = employees.find((item) => String(item.id) === String(leadAssignEmployeeId));
    if (!selectedEmployee) return;
    setLeadActionLoading("assign");
    setError("");
    try {
      const payload = await api.patch(aiAgentInboxEndpoint(selectedConversation.session_id, "/assign"), {
        tenant_id: tenantId,
        assigned_user_id: selectedEmployee.id,
        assigned_user_name: selectedEmployee.full_name || selectedEmployee.name || "",
        channel: selectedConversation.channel || selectedConversation.source || "",
      }, { headers, perfComponent: "AiInbox.assignLead" });
      if (payload?.conversation) {
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          assigned_user: payload.conversation.assigned_user || {
            id: selectedEmployee.id,
            name: selectedEmployee.full_name || selectedEmployee.name || "",
          },
          assigned_user_id: selectedEmployee.id,
          assigned_user_name: selectedEmployee.full_name || selectedEmployee.name || "",
          channel_metadata: payload.conversation.channel_metadata || conversation.channel_metadata,
        }));
      }
      setToast({ tone: "emerald", text: "تم تعيين الموظف" });
      await loadAll({ silent: true });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر تعيين الموظف" });
      setError(err?.message || "تعذر تعيين الموظف");
    } finally {
      setLeadActionLoading("");
    }
  };

  const sendProductCards = useCallback(async (productCards = [], options = {}) => {
    const cards = asArray(productCards)
      .map((card) => ({
        id: card.product_id ?? card.id ?? null,
        product_id: card.product_id ?? card.id ?? null,
        variant_id: card.variant_id ?? card.variantId ?? null,
        product_name: clean(card.product_name || card.name || card.title || ""),
        name: clean(card.product_name || card.name || card.title || ""),
        title: clean(card.product_name || card.name || card.title || ""),
        image_url: clean(card.image_url || card.product_image_url || card.variant_image_url || card.image || card.thumbnail_url || card.media_url || ""),
        image: clean(card.image_url || card.product_image_url || card.variant_image_url || card.image || card.thumbnail_url || card.media_url || ""),
        thumbnail_url: clean(card.image_url || card.product_image_url || card.variant_image_url || card.image || card.thumbnail_url || card.media_url || ""),
        media_url: clean(card.media_url || card.mediaUrl || ""),
        price: Number(card.price ?? card.final_price ?? card.sale_price ?? 0) || 0,
        color: clean(card.color || card.variant_color || ""),
        size: clean(card.size || card.variant_size || ""),
        storefront_url: clean(card.storefront_url || card.product_url || card.url || card.share_url || card.shareUrl || ""),
        product_url: clean(card.storefront_url || card.product_url || card.url || card.share_url || card.shareUrl || ""),
        url: clean(card.storefront_url || card.product_url || card.url || card.share_url || card.shareUrl || ""),
        share_url: clean(card.share_url || card.shareUrl || ""),
      }))
      .filter((card) => card.product_name || card.product_id || card.storefront_url);
    const conversationId = clean(selectedConversation?.session_id || selectedConversation?.conversation_key || selectedConversation?.conversation_id || "");
    if (!conversationId || !cards.length) return { ok: false, results: [], summary: { total: 0, sent: 0, failed: 0 } };

    const previewText = productCardPreviewText(cards) || "إرسال منتج";

    // Atomic in-flight guard — see sendManualReply. Prevents a rapid double-click from sending the batch twice.
    if (sendingProductCardsRef.current) return { ok: false, results: [], summary: { total: 0, sent: 0, failed: 0 }, busy: true };
    sendingProductCardsRef.current = true;
    setProductCardSending(true);
    setError("");

    // Phase 13.4 — FE-SEQUENTIAL per-card send. Each selected card is delivered as its own
    // /product-card/send request (its own client_request_id / message_identity_key), reusing the already-live
    // single-card route path. This yields HONEST per-card partial failure and preserves operator selection order
    // with ZERO change to the live provider send loop. Nothing reached the provider before this explicit call.
    const results = [];
    let needsRefresh = false;
    try {
      for (const card of cards) {
        const key = productSelectionKey(card);
        const cardRequestId = buildClientRequestId();
        const cardIdentityKey = buildMessageIdentityKey({ tenantId, sessionId: conversationId, direction: "outbound", clientRequestId: cardRequestId });
        const cardPreview = productCardPreviewText([card]) || previewText;
        const cardNow = new Date().toISOString();
        try {
          const payload = await api.post(
            aiInboxConversationEndpoint(conversationId, "/product-card/send"),
            {
              tenant_id: tenantId,
              product_cards: [card],
              client_request_id: cardRequestId,
              message_identity_key: cardIdentityKey,
              assisted_approval: options.assistedApproval === true,
            },
            { headers, perfComponent: "AiInbox.sendProductCards" }
          );
          const returnedMessage = payload?.message || null;
          if (returnedMessage) {
            const returnedCards = normalizeProductCardsValue(returnedMessage.product_cards || returnedMessage.productCards || [card]);
            const normalizedCards = returnedCards.length
              ? returnedCards.map((rc) => {
                  const exactUrl = clean(rc.storefront_url || rc.product_url || rc.url || rc.share_url || rc.shareUrl || card.storefront_url || card.product_url || card.url || card.share_url || "");
                  const imageUrl = clean(rc.image_url || rc.product_image_url || rc.variant_image_url || rc.image || rc.thumbnail_url || rc.media_url || card.image_url || card.image || "");
                  const productName = clean(rc.product_name || rc.name || rc.title || rc.display_name || rc.label || card.product_name || card.name || card.title || "");
                  return {
                    ...card, ...rc,
                    product_name: productName, name: productName, title: productName, display_name: productName, label: productName,
                    image_url: imageUrl, product_image_url: clean(rc.product_image_url || card.product_image_url || ""), variant_image_url: clean(rc.variant_image_url || card.variant_image_url || ""),
                    image: imageUrl, thumbnail_url: imageUrl,
                    media_url: clean(rc.media_url || rc.mediaUrl || card.media_url || card.mediaUrl || ""),
                    storefront_url: exactUrl, product_url: exactUrl, url: exactUrl,
                    share_url: clean(rc.share_url || rc.shareUrl || card.share_url || card.shareUrl || ""),
                  };
                })
              : [card];
            patchConversation(conversationId, (conversation) => ({
              ...conversation,
              messages: mergeMessagesByIdentity([...asArray(conversation.messages), { ...returnedMessage, client_request_id: returnedMessage.client_request_id || cardRequestId, message_identity_key: returnedMessage.message_identity_key || cardIdentityKey, product_cards: normalizedCards }]),
              latest_message_preview: returnedMessage.message_text || returnedMessage.staff_message || returnedMessage.customer_message || productCardPreviewText(normalizedCards) || cardPreview,
              last_activity_at: returnedMessage.created_at || cardNow,
              updated_at: returnedMessage.created_at || cardNow,
            }));
          } else {
            needsRefresh = true;
            patchConversation(conversationId, (conversation) => ({ ...conversation, latest_message_preview: cardPreview, last_activity_at: cardNow, updated_at: cardNow }));
          }
          results.push({ key, ok: true });
        } catch (err) {
          results.push({ key, ok: false, error: err?.message || "تعذر إرسال المنتج" });
        }
      }
    } finally {
      sendingProductCardsRef.current = false;
      setProductCardSending(false);
    }

    if (needsRefresh) { try { await loadAll({ silent: true }); } catch { /* non-fatal */ } }
    const summary = summarizeSendResults(results);
    const allOk = summary.failed === 0 && summary.sent > 0;
    if (summary.sent === 0) setError(results.find((r) => r.error)?.error || "تعذر إرسال المنتج");
    if (!options.suppressToast) {
      setToast({ tone: allOk ? "emerald" : summary.sent > 0 ? "amber" : "rose", text: sendOutcomeText(summary) });
      if (allOk) closeProductCardPicker();
    }
    return { ok: allOk, results, summary };
  }, [closeProductCardPicker, headers, loadAll, patchConversation, selectedConversation?.conversation_key, selectedConversation?.session_id, selectedConversationRouteId, tenantId]);

  const sendAvailableBySizeLink = useCallback(
    async ({ message = "" } = {}) => {
      if (!message) return;
      setAvailableBySizeSending(true);
      closeProductCardPicker();
      setToast({ tone: "amber", text: "جاري إرسال رابط المنتجات..." });
      try {
        await sendManualReply(message);
      } finally {
        setAvailableBySizeSending(false);
      }
    },
    [closeProductCardPicker, sendManualReply]
  );

  const loadRecommendations = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    setRecommendations((current) => ({ ...current, sessionId, loading: true }));
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/recommendations"), { params: { tenant_id: tenantId, limit: 8 }, headers, perfComponent: "AiInbox.recommendations" });
      setRecommendations({ sessionId, products: asArray(payload.products), intelligence: payload.sales_intelligence || null, loading: false });
    } catch {
      setRecommendations({ sessionId, products: [], intelligence: null, loading: false });
    }
  };

  const loadSalesCloser = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    setSalesCloser((current) => ({ ...current, sessionId, loading: true }));
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/sales-closer"), { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.salesCloser" });
      setSalesCloser({ sessionId, plan: payload || {}, loading: false });
      if (payload?.products?.length) {
        setRecommendations({ sessionId, products: asArray(payload.products), loading: false });
      }
    } catch {
      setSalesCloser({ sessionId, plan: {}, loading: false });
    }
  };

  useEffect(() => {
    if (!selectedConversation?.session_id) return undefined;
    // Recommendations + sales-closer feed secondary side panels only. They must
    // not compete with the thread hydration for the connection, so they wait for
    // an idle moment after the messages/composer are usable.
    const run = () => {
      void loadRecommendations();
      void loadSalesCloser();
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(run, { timeout: 2000 })
      : window.setTimeout(run, 250);
    return () => {
      if (window.requestIdleCallback && window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [selectedConversation?.session_id]);

  const generateAiReply = async ({ persist = false } = {}) => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    setEditingAiDraft(false);
    setDismissedAiSuggestionKey("");
    setAiReply({ sessionId, text: "", loading: true, error: "", validation: null, confidence_engine: null });
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || sessionId, "/ai-reply"), { tenant_id: tenantId, persist }, { headers, perfComponent: "AiInbox.generateAiReply" });
      const aiReplyDraft = payload.ai_reply_draft || payload.draft || payload.suggestion || null;
      const textValue = clean(aiReplyDraft?.text || payload.reply?.answer || payload.text || "");
      const validation = normalizeValidationSummary(payload.validation || aiReplyDraft?.validation || payload.reply?.validation || {});
      const confidenceEngine = normalizeConfidenceEngineSummary(payload.confidence_engine || aiReplyDraft?.confidence_engine || payload.reply?.confidence_engine || {});
      setReplyText(textValue);
      window.setTimeout(() => {
        setAiReply({ sessionId, text: textValue, loading: false, error: "", validation, confidence_engine: confidenceEngine });
      }, 450);
      if (aiReplyDraft) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ai_reply_draft: aiReplyDraft,
          last_ai_reply_draft: aiReplyDraft,
          last_ai_reply_validation: payload.validation || aiReplyDraft.validation || aiReplyDraft.metadata?.validation || null,
          last_ai_reply_confidence_engine: payload.confidence_engine || aiReplyDraft.confidence_engine || aiReplyDraft.metadata?.confidence_engine || null,
          last_ai_reply_draft_updated_at: aiReplyDraft.updated_at || new Date().toISOString(),
        }));
      }
    } catch (err) {
      setAiReply({ sessionId, text: "", loading: false, error: err?.message || "تعذر إنشاء رد الذكاء الاصطناعي", validation: null, confidence_engine: null });
    }
  };

  const updateAutoReplyMode = async (mode) => {
    const channel = selectedConversation?.channel || selectedConversation?.source;
    if (!channel) return;
    setModeSaving(true);
    setError("");
    try {
      const payload = await api.patch(`/ai-agent/channels/${encodeURIComponent(channel)}/settings`, {
        tenant_id: tenantId,
        auto_reply_mode: mode,
        ai_replies_enabled: mode !== "off",
      }, { headers });
      setChannelStatus(payload.channels || {});
    } catch (err) {
      setError(err?.message || "تعذر تحديث وضع الرد التلقائي");
    } finally {
      setModeSaving(false);
    }
  };

  const toggleGlobalAiAssistant = useCallback(() => {
    void (async () => {
      setAiAssistantGlobalSaving(true);
      setError("");
      try {
        const nextEnabled = !aiAssistantGlobalEnabled;
        const payload = await api.patch("/ai-agent/settings/ai-assistant-global", {
          tenant_id: tenantId,
          ai_assistant_global_enabled: nextEnabled,
          enabled: nextEnabled,
        }, { headers, perfComponent: "AiInbox.globalAiToggle" });
        const resolvedEnabled = payload?.ai_assistant_global_enabled !== false;
        setAiAssistantGlobalEnabled(resolvedEnabled);
        setToast({
          tone: resolvedEnabled ? "emerald" : "amber",
          text: resolvedEnabled
            ? "تم تشغيل مساعد الذكاء الاصطناعي لكل المحادثات."
            : "مساعد الذكاء الاصطناعي متوقف على كل المحادثات.",
        });
        await loadAll({ silent: true });
      } catch (err) {
        setError(err?.message || "تعذر تحديث حالة مساعد الذكاء الاصطناعي العامة");
      } finally {
        setAiAssistantGlobalSaving(false);
      }
    })();
  }, [aiAssistantGlobalEnabled, headers, loadAll, tenantId]);

  const toggleAiEnabled = useCallback(() => {
    if (!selectedConversation?.session_id) return;
    const channel = selectedConversation?.channel || selectedConversation?.source || "";
    const status = selectedConversation?.conversation_status || selectedConversation?.status || "ai_active";
    const nextEnabled = !isConversationAiEnabled(selectedConversation);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = status === "human_takeover"
          ? await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/return-to-ai"), {
              tenant_id: tenantId,
              channel,
            }, { headers, perfComponent: "AiInbox.returnToAi" })
          : await api.patch(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/ai-enabled"), {
              tenant_id: tenantId,
              conversation_id: selectedConversation.session_id,
              external_id: selectedConversation.external_conversation_id || "",
              channel,
              ai_enabled: nextEnabled,
              enabled: nextEnabled,
            }, { headers, perfComponent: "AiInbox.toggleConversationAi" });
        const returnedConversation = payload.conversation || {};
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ...returnedConversation,
          conversation_status: returnedConversation.conversation_status || returnedConversation.status || (status === "human_takeover" ? "ai_active" : conversation.conversation_status),
          status: returnedConversation.status || returnedConversation.conversation_status || (status === "human_takeover" ? "ai_active" : conversation.status),
          human_takeover: returnedConversation.human_takeover !== undefined ? returnedConversation.human_takeover : (status === "human_takeover" ? false : conversation.human_takeover),
          ai_paused: returnedConversation.ai_paused !== undefined ? returnedConversation.ai_paused : (status === "human_takeover" ? false : conversation.ai_paused),
          ai_enabled: returnedConversation.ai_enabled !== undefined ? returnedConversation.ai_enabled : (status === "human_takeover" ? true : nextEnabled),
        }));
        setToast({ tone: "emerald", text: status === "human_takeover" ? "أعيدت المحادثة إلى الذكاء الاصطناعي." : (nextEnabled ? "تم تشغيل AI لهذه المحادثة" : "تم إيقاف AI لهذه المحادثة") });
        await loadAll({ silent: true });
      } catch (err) {
        setError(err?.message || "تعذر تحديث حالة الذكاء الاصطناعي للمحادثة");
      } finally {
        setLoading(false);
      }
    })();
  }, [headers, loadAll, patchConversation, selectedConversation, tenantId]);

  const quickSendProduct = (product) => {
    const textValue = `${product.name || product.title}\n${money(product.final_price || product.price)}\n${storefrontProductUrl(product)}`.trim();
    setReplyText(textValue);
  };

  const reactToMessage = useCallback(async ({ emoji = "", targetMessageId = "", remoteJid = "", targetFromMe = false } = {}) => {
    if (!selectedConversation?.session_id || !targetMessageId) return null;
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/reaction"), {
        tenant_id: tenantId,
        emoji,
        target_message_id: targetMessageId,
        remote_jid: remoteJid,
        target_from_me: targetFromMe,
      }, { headers, perfComponent: "AiInbox.messageReaction" });
      setToast({ tone: "emerald", text: emoji ? `تم إضافة التفاعل ${emoji}` : "تم حذف التفاعل" });
      return payload;
    } catch (reactionError) {
      setToast({ tone: "rose", text: reactionError?.message || "تعذر إرسال التفاعل" });
      throw reactionError;
    }
  }, [headers, selectedConversation, selectedConversationRouteId, tenantId]);

  const createDraftFromProduct = async (product, options = {}) => {
    if (!selectedConversation?.session_id || !product) return;
    setError("");
    setLoading(true);
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation?.session_id, "/create-draft-order"), {
        tenant_id: tenantId,
        product_id: product.product_id || product.id,
        product,
        quantity: options.quantity || 1,
        size: options.size || "",
        color: options.color || "",
        customer_name: options.customer_name || "",
        customer_phone: options.customer_phone || "",
        customer_address: options.customer_address || "",
        governorate: options.governorate || "",
        city_area: options.city_area || "",
        shipping_provider: options.shipping_provider || "",
        shipping_provider_id: options.shipping_provider_id || options.shipping_provider || "",
        shipping_city_id: options.shipping_city_id || "",
        shipping_zone_id: options.shipping_zone_id || "",
        shipping_district_id: options.shipping_district_id || "",
        district_id: options.district_id || options.shipping_district_id || "",
        street_address: options.street_address || options.customer_address || "",
        building_number: options.building_number || "",
        floor_number: options.floor_number || "",
        apartment_number: options.apartment_number || "",
        landmark: options.landmark || "",
        notes: options.notes || "",
        reserve: options.reserve !== false,
        reserve_minutes: options.reserve_minutes || 20,
      }, { headers });
      const paymentAction = asArray(payload.payment_actions).find((item) => item.key === "cash_on_delivery") || null;
      if (paymentAction?.message) setReplyText(paymentAction.message);
      setToast({ tone: "emerald", text: `Draft order ${payload.order?.invoice_number || payload.order?.id || ""} created` });
      setOrderComposerOpen(false);
      await loadAll();
      await loadSalesCloser();
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "Draft order failed" });
      setError(err?.message || "تعذر إنشاء مسودة الطلب");
    } finally {
      setLoading(false);
    }
  };

  const usePaymentAction = (type) => {
    const draft = asArray(selectedConversation?.draft_orders)[0] || {};
    const orderNumber = draft.invoice_number || draft.public_order_number || draft.id || "";
    const total = draft.total_amount || draft.total_price || draft.total || 0;
    if (type === "payment_link") {
      setReplyText(`تمام، ده لينك الدفع للطلب ${orderNumber}: ${draft.id ? `/orders/${draft.id}` : ""}`.trim());
      return;
    }
    setReplyText(`تمام، ممكن الدفع عند الاستلام${total ? ` بإجمالي ${money(total)}` : ""}. ابعتلي الاسم ورقم الموبايل والعنوان لتأكيد الطلب.`);
  };

  const copySuggestedReply = useCallback(async (text) => {
    const value = clean(text);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setToast({ tone: "emerald", text: "Reply copied" });
    } catch {
      setReplyText(value);
      setToast({ tone: "amber", text: "Clipboard unavailable, loaded into composer" });
    }
  }, []);

  const sendProductImages = useCallback((product) => {
    if (!product) return;
    const imageList = [productImage(product), ...asArray(product.images || product.gallery_images || product.image_urls || [])]
      .map((url) => clean(url))
      .filter(Boolean);
    const composed = [
      product.name || product.title || "Product images",
      money(product.final_price || product.price || product.sale_price || 0),
      productVariantLabel(product),
      ...imageList.slice(0, 3),
    ].filter(Boolean).join("\n");
    setReplyText(composed);
  }, []);

  const renderModeTabs = () => (
    <div className="mt-3 inline-flex max-w-full flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          setInboxSection("analytics");
          setSelectedSocialCommentId("");
          setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
          setSelectedSessionId("");
          setMobileView("list");
        }}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
          isAnalyticsMode
            ? "bg-cyan-300 text-slate-950"
            : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
        }`}
      >
        <span>Analytics</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setInboxSection("conversations");
          setSelectedSocialCommentId("");
          setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
          setSelectedSessionId(conversationPanelConversations[0]?.conversation_key || "");
          setMobileView("list");
        }}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
          isConversationMode
            ? "bg-cyan-300 text-slate-950"
            : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
        }`}
        >
        <span>AI Inbox</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isConversationMode ? "bg-slate-950/15 text-slate-950" : "bg-white/10 text-slate-200"}`}>
          {conversationPanelCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setInboxSection("social_comments");
          setSelectedSocialCommentId(socialCommentIdentity(visibleSocialComments[0] || {}));
          setSelectedSessionId("");
          setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
          setMobileView("chat");
        }}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
          isSocialMode
            ? "bg-cyan-300 text-slate-950"
            : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
        }`}
        >
        <span>Social Comments</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isSocialMode ? "bg-slate-950/15 text-slate-950" : "bg-white/10 text-slate-200"}`}>
          {socialCommentsPanelCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setInboxSection("automation");
          setSelectedSocialCommentId("");
          setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
          setSelectedSessionId("");
          setMobileView("list");
        }}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
          isAutomationMode
            ? "bg-cyan-300 text-slate-950"
            : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
        }`}
      >
        <span>? Automation</span>
      </button>
    </div>
  );

  const renderCompactHeader = () => (
    <section dir="ltr" className="shrink-0 rounded-3xl border border-white/10 bg-white/[0.055] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">
            <Bot className="h-4 w-4" />
            AI Social Media Center
          </div>
          <div className="mt-1 text-base font-black text-white">AI Social Media Center</div>
        </div>
        {renderModeTabs()}
      </div>
      {isConversationMode ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 xl:flex-row xl:items-center">
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[11px] font-black ${aiAssistantGlobalEnabled ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>
              <Bot className="h-3.5 w-3.5" />
              AI {aiAssistantGlobalEnabled ? "ON" : "OFF"}
            </span>
            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-white transition hover:border-white/20 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );

  const renderAutomationWorkspace = () => (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="max-w-xl rounded-[24px] border border-white/10 bg-slate-950/55 p-6 text-center">
        <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
          <Sparkles className="h-4 w-4" />
          Automation
        </div>
        <div className="mt-2 text-2xl font-black text-white">قريبًا</div>
        <p className="mt-2 text-sm leading-7 text-slate-300">
          هذا التبويب محجوز لاحقًا لإعدادات الأتمتة العامة بدون تغيير أي منطق backend حالي.
        </p>
      </div>
    </div>
  );

  const renderAnalyticsWorkspace = () => {
    const analyticsValue = (...paths) => {
      for (const path of paths) {
        if (!path) continue;
        const segments = String(path).split(".");
        let current = analytics;
        for (const segment of segments) {
          current = current?.[segment];
          if (current === undefined || current === null) break;
        }
        if (current !== undefined && current !== null && current !== "") return current;
      }
      return null;
    };
    const totalComments = asArray(socialComments.items).reduce((sum, item) => sum + Number(item.comments_count || item.comment_count || 0), 0);
    const newComments = asArray(socialComments.items).reduce((sum, item) => sum + Number(item.new_comments_count || item.new_count || 0), 0);
    const needsReply = asArray(socialComments.items).filter((item) => Number(item.new_comments_count || item.new_count || 0) > 0).length;
    const replied = asArray(socialComments.items).filter((item) => clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent").length;
    const replyRate = Number(analyticsValue("reply_rate", "replyRate", "performance.reply_rate", "metrics.reply_rate") || 0);
    const revenue = analyticsValue("revenue", "total_revenue", "performance.revenue", "metrics.revenue");
    const performance = analyticsValue("performance.score", "performance_score", "score", "metrics.performance_score");
    const engagement = analyticsValue("engagement_rate", "engagementRate", "performance.engagement_rate", "metrics.engagement_rate");
    const cards = [
      { label: "Total conversations", value: conversations.length, tone: "cyan" },
      { label: "Unread / needs support", value: conversations.filter((item) => item.unread || item.needs_human_support).length, tone: "amber" },
      { label: "Reply rate", value: `${Number.isFinite(replyRate) ? replyRate.toFixed(0) : 0}%`, tone: "emerald" },
      { label: "Auto reply", value: aiAssistantGlobalEnabled ? "ON" : "OFF", tone: aiAssistantGlobalEnabled ? "emerald" : "rose" },
      { label: "Comment stats", value: `${totalComments} / ${newComments} new`, tone: "violet" },
      { label: "Revenue", value: revenue ? money(revenue) : "—", tone: "emerald" },
      { label: "Needs reply", value: needsReply, tone: "amber" },
      { label: "Replied", value: replied, tone: "cyan" },
      { label: "Performance", value: performance ? `${Number(performance).toFixed(0)}%` : "—", tone: "zinc" },
      { label: "Engagement", value: engagement ? `${Number(engagement).toFixed(0)}%` : "—", tone: "violet" },
    ];

    return (
      <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
        <div className="grid min-h-0 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
          <section className="min-h-0 space-y-3 overflow-hidden">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <div key={card.label} className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{card.label}</div>
                  <div className={`mt-1.5 text-2xl font-black ${card.tone === "emerald" ? "text-emerald-100" : card.tone === "amber" ? "text-amber-100" : card.tone === "rose" ? "text-rose-100" : card.tone === "violet" ? "text-violet-100" : card.tone === "cyan" ? "text-cyan-100" : "text-white"}`}>{card.value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                <SectionTitle icon={ArrowUpRight} title="Sales journey" action={<Pill tone="zinc">{leadPipelineSummary.total}</Pill>} />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {leadPipelineSummary.funnel.map((item) => (
                    <div key={item.key} className={`rounded-2xl border px-3 py-2 ${leadStatusTone(item.key) === "rose" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : leadStatusTone(item.key) === "amber" ? "border-amber-300/20 bg-amber-400/10 text-amber-100" : leadStatusTone(item.key) === "violet" ? "border-violet-300/20 bg-violet-400/10 text-violet-100" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"}`}>
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] opacity-80">{item.label}</div>
                      <div className="mt-1 text-xl font-black leading-none">{leadPipelineSummary.counts[item.key] || 0}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {leadPipelineSummary.sourceOrder.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                      <div className="mt-1 text-base font-black text-white">{leadPipelineSummary.sourceCounts[item.key] || 0}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                  <SectionTitle icon={Sparkles} title="Performance snapshot" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Reply rate</div>
                      <div className="mt-1.5 text-2xl font-black text-emerald-100">{replyRate ? `${replyRate.toFixed(0)}%` : "—"}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Revenue</div>
                      <div className="mt-1.5 text-2xl font-black text-emerald-100">{revenue ? money(revenue) : "—"}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Performance</div>
                      <div className="mt-1.5 text-2xl font-black text-white">{performance ? `${Number(performance).toFixed(0)}%` : "—"}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Engagement</div>
                      <div className="mt-1.5 text-2xl font-black text-violet-100">{engagement ? `${Number(engagement).toFixed(0)}%` : "—"}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                  <SectionTitle icon={MessageSquareText} title="Comment stats" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Comments</div>
                      <div className="mt-1.5 text-2xl font-black text-white">{totalComments}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">New</div>
                      <div className="mt-1.5 text-2xl font-black text-white">{newComments}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Needs reply</div>
                      <div className="mt-1.5 text-2xl font-black text-amber-100">{needsReply}</div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Replied</div>
                      <div className="mt-1.5 text-2xl font-black text-cyan-100">{replied}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <aside className="space-y-3 overflow-hidden">
            <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
              <SectionTitle icon={Bot} title="Workspace focus" />
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                <p>Analytics now owns every KPI, performance, reply rate, lead funnel, and revenue summary.</p>
                <p>AI Inbox stays dedicated to WhatsApp, Messenger, Instagram DM, and Web Chat only.</p>
                <p>Social Comments becomes a dedicated post-thread workspace for comments only.</p>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
              <SectionTitle icon={ShieldBan} title="Operational note" />
              <div className="mt-3 text-sm leading-6 text-slate-300">
                The yellow assistant warning is only shown when the setting is actually off.
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  };

  const renderSocialCommentsWorkspaceFrame = () => (
    <SocialCommentsWorkspace
        items={visibleSocialComments}
        loading={loading || socialComments.loading}
        error={socialComments.error}
        selectedPost={selectedSocialComment}
        selectedThread={selectedSocialThread}
        selectedTemplate={selectedSocialTemplate}
        globalSettings={socialReplySettings}
        onRefresh={() => void requestRefresh("manual", { silent: true })}
        onSelectPost={openSocialCommentThread}
        onGlobalSettingsChange={setSocialReplySettings}
                  onSaveGlobalSettings={saveSocialReplySettings}
                  onTemplateChange={setSelectedSocialTemplate}
                  onSaveTemplate={saveSocialPostTemplate}
                  onCommentAction={handleSocialCommentAction}
                  onSelectCustomer={openCustomerDrawer}
                  onPrefetchPost={(item) => {
                    const postId = clean(item?.post_id || item?.conversation_id || item?.id || "");
                    if (!ENABLE_SOCIAL_FAST_CENTER || !postId) return;
                    void prefetchSocialWorkspace({
                      api,
                      headers,
                      tenantId,
                      postId,
                      platform: clean(item?.platform || ""),
                    });
                  }}
                  selectedPostId={selectedSocialCommentPostId}
                  actionLoading={socialCommentActionLoading}
                  tenantId={tenantId}
                />
  );

  if (isAnalyticsMode) {
    return (
      <div dir="rtl" className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] text-white [padding-bottom:env(safe-area-inset-bottom)] [padding-top:env(safe-area-inset-top)]">
        {toast.text ? (
          <div className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur ${
            toast.tone === "rose"
              ? "border-rose-300/20 bg-rose-400/15 text-rose-100"
              : toast.tone === "cyan"
                ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
                : "border-emerald-300/20 bg-emerald-400/15 text-emerald-100"
          }`}>{toast.text}</div>
        ) : null}
        {consoleOpen ? (
          <div className="fixed inset-0 z-40 bg-slate-950/70 p-3 backdrop-blur-sm md:p-6">
            <div className="ml-auto flex h-full w-full max-w-3xl flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-white/10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black uppercase tracking-[0.14em] text-cyan-100">Developer Console</div>
                  <div className="text-xs text-slate-500">Live AI operational logs</div>
                </div>
                <button type="button" onClick={() => setConsoleOpen(false)} className="h-9 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10">Close</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AILiveLogs tenantId={tenantId} headers={headers} enabled={consoleOpen} />
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex h-[100dvh] w-full min-w-0 flex-col gap-2 overflow-hidden p-2 md:p-3">
          {renderCompactHeader()}
          {renderAnalyticsWorkspace()}
        </div>
      </div>
    );
  }

  if (isSocialMode) {
    return (
      <div dir="ltr" className="ai-inbox-desktop overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] text-white [padding-bottom:env(safe-area-inset-bottom)]">
        {toast.text ? (
          <div className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur ${
            toast.tone === "rose"
              ? "border-rose-300/20 bg-rose-400/15 text-rose-100"
              : toast.tone === "cyan"
                ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
                : "border-emerald-300/20 bg-emerald-400/15 text-emerald-100"
          }`}>{toast.text}</div>
        ) : null}
        {consoleOpen ? (
          <div className="fixed inset-0 z-40 bg-slate-950/70 p-3 backdrop-blur-sm md:p-6">
            <div className="ml-auto flex h-full w-full max-w-3xl flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-white/10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black uppercase tracking-[0.14em] text-cyan-100">Developer Console</div>
                  <div className="text-xs text-slate-500">Live AI operational logs</div>
                </div>
                <button type="button" onClick={() => setConsoleOpen(false)} className="h-9 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10">Close</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AILiveLogs tenantId={tenantId} headers={headers} enabled={consoleOpen} />
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex h-full w-full min-w-0 gap-2 overflow-hidden p-2">
          <InboxChannelSidebar
            channels={[]}
            allUnread={channelSummaries.all.unread}
            activeChannel="all"
            socialCommentsCount={socialCommentsPanelCount}
            socialCommentsActive
            onSelectChannel={() => {
              setInboxSection("conversations");
              setChannelFilter("all");
              setSelectedSocialCommentId("");
              setMobileView("list");
            }}
            onSelectSocialComments={() => setInboxSection("social_comments")}
          />
          <div dir="rtl" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {renderSocialCommentsWorkspaceFrame()}
          </div>
        </div>
      </div>
    );
  }

  if (isAutomationMode) {
    return (
      <div dir="rtl" className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] text-white [padding-bottom:env(safe-area-inset-bottom)] [padding-top:env(safe-area-inset-top)]">
        {toast.text ? (
          <div className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur ${
            toast.tone === "rose"
              ? "border-rose-300/20 bg-rose-400/15 text-rose-100"
              : toast.tone === "cyan"
                ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
                : "border-emerald-300/20 bg-emerald-400/15 text-emerald-100"
          }`}>{toast.text}</div>
        ) : null}
        <div className="flex h-[100dvh] w-full min-w-0 flex-col gap-2 overflow-hidden p-2 md:p-3">
          {renderCompactHeader()}
          {renderAutomationWorkspace()}
        </div>
      </div>
    );
  }

  return (
    <div dir="ltr" className="ai-inbox-desktop overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] text-white [padding-bottom:env(safe-area-inset-bottom)]">
      {toast.text ? (
        <div className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur ${
          toast.tone === "rose"
            ? "border-rose-300/20 bg-rose-400/15 text-rose-100"
            : toast.tone === "cyan"
              ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
              : "border-emerald-300/20 bg-emerald-400/15 text-emerald-100"
        }`}>{toast.text}</div>
      ) : null}
      {consoleOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/70 p-3 backdrop-blur-sm md:p-6">
          <div className="ml-auto flex h-full w-full max-w-3xl flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-white/10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-cyan-100">Developer Console</div>
                <div className="text-xs text-slate-500">Live AI operational logs</div>
              </div>
              <button type="button" onClick={() => setConsoleOpen(false)} className="h-9 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10">Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AILiveLogs tenantId={tenantId} headers={headers} enabled={consoleOpen} />
            </div>
          </div>
        </div>
      ) : null}
      <AiTraceModal
        open={aiTrace.open}
        loading={aiTrace.loading}
        error={aiTrace.error}
        data={aiTrace.sessionId === selectedConversation?.session_id ? aiTrace.data : null}
        onRefresh={loadAiTrace}
        onClose={() => setAiTrace((current) => ({ ...current, open: false }))}
      />
      <ProductCardPicker
        key={selectedConversation?.session_id || selectedConversation?.conversation_key || "product-picker"}
        open={productCardPickerConfig.open}
        onClose={closeProductCardPicker}
        onSubmit={handleProductCardPickerSubmit}
        onSubmitLink={sendAvailableBySizeLink}
        sizeMode={productCardPickerConfig.sizeMode}
        allowMultiple={productCardPickerConfig.allowMultiple}
        mode="desktopInbox"
      />
      <ReplyCorrectionModal
        open={correctionModal.open}
        draft={correctionModal.draft}
        saving={correctionSaving}
        onClose={closeReplyCorrection}
        onChange={patchReplyCorrection}
        onSave={saveReplyCorrection}
      />
      <div ref={fullscreenHostRef} className={`${conversationExpanded ? "conversation-expanded fixed inset-0 z-[9999] flex h-[100vh] w-[100vw] max-w-none flex-col overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] p-0" : "ai-omni-frame flex w-full min-w-0 flex-col gap-2 overflow-hidden"}`}>
        {!import.meta.env.PROD ? (
          <div data-debug-ai-inbox-section style={{ display: "none" }}>
            {inboxSection}:{visibleConversations.length}:{visibleSocialComments.length}
          </div>
        ) : null}
        <details className="hidden rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">ملخص مركز المحادثات</div>
              <div className="mt-1 text-sm font-black text-white">مطوية افتراضيًا</div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black text-slate-200">
              <ChevronDown className="h-4 w-4" />
              توسيع
            </span>
          </summary>
          <div className="grid gap-3 border-t border-white/10 p-3 md:grid-cols-4">
            <Metric icon={Radio} label="إجمالي Meta النشطة" value={realMetaCount} tone="emerald" />
            <Metric icon={MessageSquareText} label="عدد المحادثات" value={conversations.length} tone="cyan" />
            <Metric icon={Clock3} label="تحتاج متابعة / رد" value={conversations.filter((item) => item.unread || item.needs_human_support).length} tone="amber" />
            <Metric icon={EyeOff} label="لوحة قيد التجربة" value="قريبًا" tone="violet" />
          </div>
        </details>

        <section className="hidden rounded-3xl border border-white/10 bg-white/[0.045] p-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SectionTitle icon={ArrowUpRight} title="خط متابعة العملاء" />
                <Pill tone="zinc">{leadPipelineSummary.total}</Pill>
              </div>
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                {leadFunnelExpanded ? "Expanded view" : "Compact KPI view"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLeadFunnelExpanded((current) => !current)}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-100"
            >
              <ChevronDown className={`h-4 w-4 transition ${leadFunnelExpanded ? "rotate-180" : ""}`} />
              {leadFunnelExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {leadPipelineSummary.funnel.map((item) => (
              <div key={item.key} className={`rounded-2xl border px-3 py-1.5 ${leadStatusTone(item.key) === "rose" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : leadStatusTone(item.key) === "amber" ? "border-amber-300/20 bg-amber-400/10 text-amber-100" : leadStatusTone(item.key) === "violet" ? "border-violet-300/20 bg-violet-400/10 text-violet-100" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="truncate text-[10px] font-black uppercase tracking-[0.14em] opacity-80">{item.label}</div>
                  <div className="text-base font-black leading-none">{leadPipelineSummary.counts[item.key] || 0}</div>
                </div>
              </div>
            ))}
          </div>
          {leadFunnelExpanded ? (
            <>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {leadPipelineSummary.sourceOrder.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                    <div className="mt-1 text-base font-black text-white">{leadPipelineSummary.sourceCounts[item.key] || 0}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(LEAD_STATUS_META).map(([key, meta]) => (
                  <Pill key={key} tone={leadStatusTone(key)}>
                    {meta.label}
                    <span className="opacity-80">{leadPipelineSummary.counts[key] || 0}</span>
                  </Pill>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {/* Expanding must NOT restyle the workspace. `.ai-omni-workspace` is a CSS
            grid (58px rail | list | chat); the old fullscreen branch forced
            `!flex`, which only appeared to work because the rail was hidden at
            the time. With the rail visible that override collapsed the columns —
            the list stretched edge to edge and the chat disappeared. Fullscreen
            is purely the outer wrapper's job now. */}
        <section className="ai-omni-workspace relative">
          {/* Expanding scales up the WHOLE workspace — channel rail, conversation
              list and chat. It used to hide the rail, which turned "expand" into
              "chat only" and cost you channel switching at the exact moment you
              have the most room for it. */}
          <div className="ai-omni-channel-rail ai-omni-panel">
            <InboxChannelSidebar
              channels={fixedChannelSummaries}
              allUnread={channelSummaries.all.unread}
              activeChannel={channelFilter}
              socialCommentsCount={socialCommentsPanelCount}
              socialCommentsActive={false}
              onSelectSocialComments={() => {
                setInboxSection("social_comments");
                setSelectedSocialCommentId(socialCommentIdentity(visibleSocialComments[0] || {}));
                setSelectedSessionId("");
                setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
                setMobileView("chat");
              }}
              onSelectChannel={(value) => {
                setInboxSection("conversations");
                setChannelFilter(value);
                setMobileView("list");
              }}
            />
          </div>

	          <aside dir="rtl" className={`ai-omni-panel ai-omni-list-panel ${isSocialMode ? "hidden" : ""} min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)] ${mobileView === "chat" ? "hidden md:flex" : "flex"}`}>
	            <div className="shrink-0 space-y-3">
	              {inboxSection === "conversations" ? (
	                <div className="flex flex-col gap-3">
	                  <div className="flex items-center justify-between gap-3 px-1">
	                    <div>
	                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">Conversations</div>
	                      <div className="mt-0.5 text-xs text-slate-500">All connected customer channels</div>
	                    </div>
	                    <Pill tone="cyan">{filteredConversations.length}</Pill>
	                  </div>
	                  <div className="flex items-center gap-2">
	                    <label className="relative flex min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-slate-950/70 h-10">
	                      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
	                      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن العميل أو الرسالة" className="h-10 w-full min-w-0 rounded-xl bg-transparent pr-9 pl-3 text-sm font-bold text-white outline-none placeholder:text-slate-600" />
	                    </label>
	                      <button type="button" onClick={() => setFavoriteFilter(favoriteFilter === "favorites" ? "all" : "favorites")} title="المفضلة" aria-label="المفضلة" aria-pressed={favoriteFilter === "favorites"} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${favoriteFilter === "favorites" ? "border-amber-300/40 bg-amber-400/15" : "border-white/10 bg-slate-950/70 hover:border-white/20"}`}>
	                        <Star className={`h-4 w-4 ${favoriteFilter === "favorites" ? "text-amber-300 fill-amber-300" : "text-slate-400"}`} />
	                      </button>
	                  </div>
	                </div>
	              ) : null}
	            </div>
	            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
	              {inboxSection === "conversations" ? (
	                <>
	                  {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
	                  {filteredConversations.length ? (
	                    <div className="space-y-1.5 pr-1">
	                      {filteredConversations.map((item) => {
	                        const itemKey = item.conversation_key || `${normalizeConversationChannel(item)}:${item.session_id}`;
	                        return (
	                          <InboxConversationCard
	                            key={itemKey}
	                            item={item}
	                            unseen={unseenSessions.includes(itemKey)}
	                            active={selectedConversation?.conversation_key === itemKey}
	                            onSelect={handleSelectConversation}
	                            onToggleFavorite={toggleConversationFavorite}
	                          />
	                        );
	                      })}
	                    </div>
	                  ) : !loading ? <EmptyBlock text={leadFilter === "all" && filter === "all" ? "لا توجد رسائل Meta حقيقية بعد. بيانات العرض مخفية كي تبقى محادثات الويبهوك الحية واضحة." : "لا توجد محادثات حقيقية تطابق المرشحات المحددة."} /> : null}
	                </>
	              ) : null}
	            </div>
	          </aside>

          <main dir="rtl" className={`ai-omni-panel ai-omni-chat-panel min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)] ${mobileView === "chat" ? "flex" : "hidden md:flex"}`}>
            {isSocialMode ? (
              <>
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <SocialCommentsWorkspace
                    items={visibleSocialComments}
                    loading={loading || socialComments.loading}
                    error={socialComments.error}
                    selectedPost={selectedSocialComment}
                    selectedThread={selectedSocialThread}
                    selectedTemplate={selectedSocialTemplate}
                    globalSettings={socialReplySettings}
                    onRefresh={() => void requestRefresh("manual", { silent: true })}
                    onSelectPost={openSocialCommentThread}
                    onGlobalSettingsChange={setSocialReplySettings}
                    onSaveGlobalSettings={saveSocialReplySettings}
                    onTemplateChange={setSelectedSocialTemplate}
                    onSaveTemplate={saveSocialPostTemplate}
                    onCommentAction={handleSocialCommentAction}
                    onSelectCustomer={openCustomerDrawer}
                    selectedPostId={selectedSocialCommentPostId}
                    actionLoading={socialCommentActionLoading}
                    tenantId={tenantId}
                  />
                </div>
                <div className={`hidden ${fullscreenConversation ? "flex h-full min-h-0 flex-1 gap-0 overflow-hidden" : "flex min-h-0 flex-1 gap-2 overflow-hidden"}`}>
                <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2 md:w-[340px] md:max-w-[340px]">
                  {null}
                </aside>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
                  {selectedSocialComment ? (
                    <>
                      <div className="shrink-0 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">
                              <MessageSquareText className="h-4 w-4" />
                              تعليقات السوشيال
                            </div>
                            <div className="mt-1 text-xl font-black text-white">{clean(selectedSocialCommentPost.customerName) || "عميل غير معروف"}</div>
                            <div className="mt-1 text-sm text-slate-400">{clean(selectedSocialCommentPost.platform || "social")}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {clean(selectedSocialCommentPost.permalinkUrl) ? (
                              <a href={clean(selectedSocialCommentPost.permalinkUrl)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100">
                                <ExternalLink className="h-4 w-4" />
                                فتح المنشور
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">نص التعليق</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white">
                            {clean(selectedSocialCommentPost.message) || "بدون نص"}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black text-slate-400">
                            {selectedSocialCommentPost.platform ? <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">{clean(selectedSocialCommentPost.platform)}</span> : null}
                            {selectedSocialCommentPost.replyStatus ? <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">{clean(selectedSocialCommentPost.replyStatus)}</span> : null}
                            {selectedSocialCommentPost.automationStatus ? <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">{clean(selectedSocialCommentPost.automationStatus)}</span> : null}
                            {selectedSocialCommentPost.productName ? <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">{clean(selectedSocialCommentPost.productName)}</span> : null}
                          </div>
                          <details className="mt-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                            <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Developer Info</summary>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black text-slate-400">
                              {selectedSocialCommentPost.postId ? <span className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">post_id: {selectedSocialCommentPost.postId}</span> : null}
                              {selectedSocialCommentPost.id ? <span className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">comment_id: {selectedSocialCommentPost.id}</span> : null}
                              {selectedSocialCommentPost.createdTime ? <span className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-slate-600">{absoluteTime(selectedSocialCommentPost.createdTime)}</span> : null}
                            </div>
                          </details>
                        </div>

                        <div className="grid gap-2 lg:grid-cols-3">
                          <button type="button" disabled className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-60">
                            <MessageSquareText className="h-4 w-4" />
                            رد سريع
                          </button>
                          <button type="button" disabled className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-60">
                            <MessageSquareText className="h-4 w-4" />
                            رسالة خاصة
                          </button>
                          {clean(selectedSocialCommentPost.permalinkUrl) ? (
                            <a href={clean(selectedSocialCommentPost.permalinkUrl)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100">
                              <ExternalLink className="h-4 w-4" />
                              فتح المنشور
                            </a>
                          ) : (
                            <button type="button" disabled className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 disabled:opacity-60">
                              <ExternalLink className="h-4 w-4" />
                              فتح المنشور
                            </button>
                          )}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الرد المقترح</div>
                          <textarea
                            value={replyText}
                            onChange={(event) => setReplyText(event.target.value)}
                            placeholder="اكتب ردًا على التعليق..."
                            className="mt-2 h-28 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" disabled className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-white disabled:opacity-60">
                              حفظ الرد
                            </button>
                            <button type="button" disabled className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-white disabled:opacity-60">
                              إرسال الرد
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <EmptyBlock text="لا يوجد تعليق محدد" />
                  )}
                </div>
              </div>
              </>
            ) : activeMainItem ? (
              <div className={`${fullscreenConversation ? "flex h-full min-h-0 flex-1 gap-0 overflow-hidden" : "flex min-h-0 flex-1 gap-2 overflow-hidden"}`}>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <InboxChatHeader
                    conversation={selectedConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading || modeSaving}
                    labelsSaving={leadActionLoading === "labels"}
                    onLabelsChange={updateConversationLabels}
                    onBack={() => setMobileView("list")}
                    onToggleAi={toggleAiEnabled}
                    isFullscreenConversation={conversationExpanded}
                    onToggleFullscreen={handleToggleConversationExpansion}
                    showBack
                    onOpenCustomer360={openCustomerDrawer}
                  />
                  <div
                    data-ai-inbox-commerce-toolbar="true"
                    className="mt-1 flex shrink-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-sm dark:border-white/10 dark:bg-[#20231f]"
                  >
                    <button
                      type="button"
                      onClick={() => setOrderComposerOpen(true)}
                      disabled={loading || !selectedConversation}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-45 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      إنشاء أوردر
                    </button>
                    <button
                      type="button"
                      onClick={() => openProductCardPicker()}
                      disabled={loading || productCardSending}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300/45 bg-amber-50 px-2.5 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:opacity-45 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100"
                    >
                      <PackageCheck className="h-4 w-4" />
                      إرسال منتج
                    </button>
                    <button
                      type="button"
                      onClick={() => openProductCardPicker({ sizeMode: true, allowMultiple: true })}
                      disabled={loading || availableBySizeSending}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300/45 bg-amber-50 px-2.5 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:opacity-45 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100"
                    >
                      <Ruler className="h-4 w-4" />
                      المتاح بالمقاس
                    </button>
                    <button
                      type="button"
                      onClick={createLeadCustomer}
                      disabled={loading || leadActionLoading === "create_customer"}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-black text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.055] dark:text-slate-200"
                    >
                      <UserPlus className="h-4 w-4" />
                      إنشاء عميل
                    </button>
                  </div>
                  <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
                    <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                      <Transcript
                        conversation={selectedConversation}
                        rows={selectedTranscriptRows}
                        events={selectedTranscriptEvents}
                        loadingOlder={olderMessagesLoading}
                        onLoadOlder={loadOlderMessages}
                        onOpenCorrection={openReplyCorrection}
                        onReplyComment={sendLeadCommentReplyQuick}
                        onPrivateMessage={sendLeadPrivateMessage}
                        onReact={isWhatsappChannel(selectedConversation?.channel || selectedConversation?.source) ? reactToMessage : null}
                        olderMessagesAvailable={Boolean(selectedConversation?.older_messages_available)}
                      />
                    </div>
                    <div className="z-20 shrink-0 border-t border-slate-200 bg-[#eefaf8] p-1.5 dark:border-white/10 dark:bg-[#20231f]">
                      <ManualReplyComposer
                        conversation={{ ...safeConversation, live_sending_available: Boolean(selectedChannelStatus.effective_enabled) || isMetaChannel(safeConversation.channel || safeConversation.source) }}
                        value={replyText}
                        onChange={setReplyText}
                        onSend={() => sendCurrentReply()}
                        onOpenProductPicker={() => openProductCardPicker()}
                        onOpenAvailableBySizePicker={() => openProductCardPicker({ sizeMode: true, allowMultiple: true })}
                        onCreateCustomer={createLeadCustomer}
                        onLoadDraft={(text) => setReplyText(text)}
                        onCopyDraft={copySuggestedReply}
                        commentDraftText={latestCommentReplyDraft}
                        isCommentConversation={isCommentConversation(selectedConversation || {})}
                        loading={Boolean(leadActionLoading || replySending || productCardSending || availableBySizeSending)}
                        validationSummary={activeAiReplyValidation}
                        confidenceEngineSummary={activeAiReplyConfidence}
                        aiSuggestionText={activeAiSuggestionText}
                        aiSuggestionVisible={aiSuggestionVisible}
                        aiSuggestionEditing={editingAiDraft}
                        aiSuggestionProductCard={effectiveSuggestionCard}
                        aiSuggestionProductChoices={suggestionSendPackage?.card_choices || []}
                        aiSuggestionProductAmbiguous={Boolean(suggestionSendPackage?.product_ambiguous)}
                        aiSuggestionColorChoices={suggestionSendPackage?.color_choices || []}
                        aiSuggestionColorRequired={Boolean(suggestionSendPackage?.color_choice_required)}
                        aiSuggestionRecommendationMode={isRecommendationSuggestion}
                        aiSuggestionRecommendationSelectedKeys={suggestionRecommendationKeys}
                        onToggleSuggestionRecommendation={handleToggleRecommendationCard}
                        aiSuggestionProductRemoved={suggestionProductRemoved}
                        aiSuggestionDeliveryFormat={suggestionDeliveryFormat?.label || ""}
                        aiSuggestionEditText={aiSuggestionEditText}
                        onAiSuggestionEditTextChange={setAiSuggestionEditText}
                        onCancelEditAiSuggestion={handleCancelEditAiSuggestion}
                        onRemoveSuggestionProduct={handleRemoveSuggestionProduct}
                        onChangeSuggestionProduct={handleChangeSuggestionProduct}
                        onChooseSuggestionProduct={handleChooseSuggestionProduct}
                        onEditAiSuggestion={handleEditAiSuggestion}
                        onApproveAiSuggestion={handleApproveAiSuggestion}
                        onDismissAiSuggestion={handleDismissAiSuggestion}
                      />
                    </div>
                  </div>
                </div>
                {showLegacyProfileOverlay ? (
                  <div className="hidden">
                    <button
                      type="button"
                      onClick={() => setProfileOpen(false)}
                      className="absolute -left-11 top-3 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-slate-950/95 text-slate-100 shadow-xl"
                      aria-label="إغلاق لوحة التفاصيل"
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </button>
                    <RightToolsTabsPanel
                    activeTab={toolsTab}
                    onTabChange={setToolsTab}
                    conversation={selectedConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading}
                    assignName={currentAssignName}
                    onAssignNameChange={updateAssignName}
                    onAction={updateConversationAction}
                    mode={resolveChannelAutoReplyMode(selectedChannelStatus)}
                    onModeChange={updateAutoReplyMode}
                    modeSaving={modeSaving}
                    recommendations={recommendations}
                    salesCloser={salesCloser}
                    drafts={drafts}
                    onRefreshRecommendations={loadRecommendations}
                    onQuickSend={quickSendProduct}
                    onSendImages={sendProductImages}
                    onCreateDraft={createDraftFromProduct}
                    onRefreshSalesCloser={loadSalesCloser}
                    onTakeover={() => updateConversationAction("takeover")}
                    onUseText={setReplyText}
                    onPaymentAction={usePaymentAction}
                    onOpenAiTrace={isWhatsappChannel(safeConversation.channel || safeConversation.source) ? openAiTrace : null}
                    aiTrace={aiTrace}
                    onSyncMessengerProfile={syncMessengerProfile}
                    profileSyncing={profileSyncing}
                    onDebugMessengerProfile={debugMessengerProfile}
                    profileDebugging={profileDebugging}
                    onResetAiState={resetAiState}
                    resettingAiState={resettingAiState}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyBlock text="لا توجد محادثات حاليًا" />
            )}
          </main>
        </section>
      </div>
      <Customer360Drawer
        open={customerDrawer.open}
        onClose={() => setCustomerDrawer((current) => ({ ...current, open: false }))}
        customer={customerDrawer.customer}
        customerId={customerDrawer.customerId}
        context={customerDrawer.context}
        title="Customer 360"
      />
      <InboxOrderComposer
        open={orderComposerOpen}
        conversation={selectedConversation || {}}
        products={recommendations.sessionId === selectedConversation?.session_id ? recommendations.products : []}
        busy={loading}
        headers={headers}
        onClose={() => setOrderComposerOpen(false)}
        onSubmit={createDraftFromProduct}
      />
    </div>
  );

  return (
    <div dir="ltr" className="min-h-full bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      {toast.text ? (
        <div className={`fixed right-4 top-4 z-50 rounded-2xl border px-4 py-3 text-sm font-black shadow-2xl backdrop-blur ${
          toast.tone === "rose"
            ? "border-rose-300/20 bg-rose-400/15 text-rose-100"
            : toast.tone === "cyan"
              ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-100"
              : "border-emerald-300/20 bg-emerald-400/15 text-emerald-100"
        }`}>{toast.text}</div>
      ) : null}
      {consoleOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/70 p-3 backdrop-blur-sm md:p-6">
          <div className="ml-auto flex h-full w-full max-w-3xl flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl ring-1 ring-white/10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-cyan-100">Developer Console</div>
                <div className="text-xs text-slate-500">Live AI operational logs</div>
              </div>
              <button type="button" onClick={() => setConsoleOpen(false)} className="h-9 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10">Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AILiveLogs tenantId={tenantId} headers={headers} enabled={consoleOpen} />
            </div>
          </div>
        </div>
      ) : null}
      <AiTraceModal
        open={aiTrace.open}
        loading={aiTrace.loading}
        error={aiTrace.error}
        data={aiTrace.sessionId === selectedConversation?.session_id ? aiTrace.data : null}
        onRefresh={loadAiTrace}
        onClose={() => setAiTrace((current) => ({ ...current, open: false }))}
      />
      <div className="flex h-[100dvh] min-h-0 flex-col gap-2 overflow-hidden p-2 md:p-3">
        <section className="hidden rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-cyan-100"><Bot className="h-4 w-4" />AI Inbox Pro</div>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">Sales Command Center</h1>
              <p className="mt-2 text-sm text-slate-400">Live Meta conversations, AI replies, human takeover, and customer context in one workspace.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConsoleOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] px-4 text-sm font-black text-slate-100 ring-1 ring-white/10">
                <Brain className="h-4 w-4" />
                AI Logs
              </button>
              <button type="button" onClick={loadAll} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>
          </div>
          {error ? <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
        </section>

        <section className="hidden grid gap-3 md:grid-cols-4">
          <Metric icon={Radio} label="إجمالي Meta النشطة" value={realMetaCount} tone="emerald" />
          <Metric icon={MessageSquareText} label="عدد المحادثات" value={conversations.length} tone="cyan" />
          <Metric icon={Clock3} label="غير مقروء / يحتاج تدخل" value={conversations.filter((item) => item.unread || item.needs_human_support).length} tone="amber" />
          <Metric icon={EyeOff} label="لوحة قيد التجربة" value="قريبًا" tone="violet" />
        </section>

        <section className="hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهاتف أو اسم الصفحة أو محتوى الرسالة" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
              <ArrowUpDown className="h-4 w-4 text-slate-500" />
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الترتيب</span>
              <select value={leadSort} onChange={(event) => setLeadSort(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
                <option value="recent">الأحدث</option>
                <option value="lead_score_desc">الأعلى في درجة العميل</option>
                <option value="favorites_first">المفضلة أولاً</option>
              </select>
            </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
  <Star className="h-4 w-4 text-amber-300" />
  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">المفضلة</span>
  <select value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
    {FAVORITE_FILTERS.map((item) => (
      <option key={item.key} value={item.key}>
        {item.label}
      </option>
    ))}
  </select>
</label>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              {filters.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setFilter(item.key);
                    if (item.key !== "messages") setMessagePlatformFilter("all");
                    if (item.key !== "comments") setCommentPlatformFilter("all");
                  }}
                  className={`h-10 shrink-0 rounded-xl px-3 text-xs font-black transition ${filter === item.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {filter === "messages" ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {MESSAGE_PLATFORM_FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setMessagePlatformFilter(item.key)}
                    className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black transition ${messagePlatformFilter === item.key ? "bg-white text-slate-950" : "border border-white/10 bg-white/[0.04] text-white hover:border-white/20"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {filter === "comments" ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {COMMENT_PLATFORM_FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setCommentPlatformFilter(item.key)}
                    className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black transition ${commentPlatformFilter === item.key ? "bg-white text-slate-950" : "border border-white/10 bg-white/[0.04] text-white hover:border-white/20"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">مرحلة العميل المحتمل</span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {leadFilters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setLeadFilter(item.key)}
                    className={`h-9 shrink-0 rounded-xl px-3 text-[11px] font-black transition ${
                      leadFilter === item.key
                        ? item.key === "ready_to_buy"
                          ? "bg-emerald-300 text-slate-950"
                          : item.key === "hot"
                            ? "bg-rose-300 text-slate-950"
                            : item.key === "warm"
                              ? "bg-amber-300 text-slate-950"
                              : "bg-cyan-300 text-slate-950"
                        : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {inboxSection === "social_comments" ? (
          <section dir="ltr" className="grid min-h-0 flex-1 gap-3 overflow-hidden grid-cols-1 xl:grid-cols-[minmax(0,28%)_minmax(0,72%)]">
            <aside className="min-h-0 min-w-0 space-y-3 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">AI Social Media Center</div>
                <div className="mt-1 text-sm font-black text-white">Social Comments</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-black sm:grid-cols-3 xl:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">Facebook <span className="ml-2 text-cyan-100">{visibleSocialComments.filter((item) => clean(item.platform).toLowerCase().includes("facebook")).length}</span></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">Instagram <span className="ml-2 text-rose-100">{visibleSocialComments.filter((item) => clean(item.platform).toLowerCase().includes("instagram")).length}</span></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">New <span className="ml-2 text-emerald-100">{visibleSocialComments.reduce((sum, item) => sum + Number(item.new_comments_count || 0), 0)}</span></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">Needs reply <span className="ml-2 text-amber-100">{visibleSocialComments.filter((item) => Number(item.new_comments_count || 0) > 0).length}</span></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">Replied <span className="ml-2 text-violet-100">{visibleSocialComments.filter((item) => clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent").length}</span></div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">Auto Reply <span className="ml-2 text-slate-100">{socialReplySettings.generic_enabled ? "ON" : "OFF"}</span></div>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Auto Reply System</div>
                      <div className="mt-1 text-sm font-black text-white">Generic Like + Reply</div>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] font-black">
                      <input
                        type="checkbox"
                        checked={socialReplySettings.generic_enabled}
                        onChange={(event) => setSocialReplySettings((current) => ({ ...current, generic_enabled: event.target.checked }))}
                      />
                      {socialReplySettings.generic_enabled ? "Enabled" : "Disabled"}
                    </label>
                  </div>
                  <select
                    value={socialReplySettings.mode}
                    onChange={(event) => setSocialReplySettings((current) => ({ ...current, mode: event.target.value }))}
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="draft">Draft only</option>
                    <option value="manual_approval">Manual Approval</option>
                    <option value="full_auto">Full Auto</option>
                    <option value="off">Off</option>
                  </select>
                  <textarea
                    value={socialReplySettings.generic_template}
                    onChange={(event) => setSocialReplySettings((current) => ({ ...current, generic_template: event.target.value }))}
                    rows={3}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder="Generic auto reply template"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const payload = await api.post("/social-comments/auto-reply/settings", {
                          tenant_id: tenantId,
                          ...socialReplySettings,
                        }, { headers, perfComponent: "AiInbox.socialReplySettings" });
                        setSocialReplySettings({
                          generic_enabled: Boolean(payload?.settings?.generic_enabled),
                          generic_like_enabled: payload?.settings?.generic_like_enabled !== false,
                          generic_reply_enabled: payload?.settings?.generic_reply_enabled !== false,
                          generic_template: clean(payload?.settings?.generic_template || ""),
                          mode: clean(payload?.settings?.mode || "manual_approval") || "manual_approval",
                        });
                        setToast({ tone: "emerald", text: "تم حفظ إعدادات الرد التلقائي" });
                      } catch (saveError) {
                        setToast({ tone: "rose", text: saveError?.message || "تعذر حفظ الإعدادات" });
                      }
                    }}
                    className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950"
                  >
                    حفظ
                  </button>
                </div>
              </div>

              {null}
            </aside>

            <main className="min-h-0 min-w-0 space-y-3 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
              {selectedSocialComment ? (
                <>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70">
                      <div className="aspect-[4/3] w-full bg-slate-900">
                        {clean(selectedSocialThreadPost.thumbnailUrl || selectedSocialCommentPost.thumbnailUrl) ? (
                          <img
                            src={clean(selectedSocialThreadPost.thumbnailUrl || selectedSocialCommentPost.thumbnailUrl)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">{clean(selectedSocialCommentPost.platform).toLowerCase().includes("instagram") ? "Instagram Post" : "Facebook Post"}</div>
                            <h2 className="mt-1 text-xl font-black text-white">{clean(selectedSocialThreadPost.caption || selectedSocialCommentPost.caption || "Post")}</h2>
                          </div>
                          {clean(selectedSocialThreadPost.permalinkUrl || selectedSocialCommentPost.permalinkUrl) ? (
                            <a
                              href={clean(selectedSocialThreadPost.permalinkUrl || selectedSocialCommentPost.permalinkUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-sm font-black text-cyan-100"
                            >
                              فتح المنشور
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Product</div>
                          <div className="mt-1 text-sm font-black text-white">{clean(selectedSocialThreadPost.productName || selectedSocialCommentPost.productName || "Not linked")}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Price</div>
                            <div className="mt-1 text-sm font-black text-white">{selectedSocialThreadPost.productPrice || selectedSocialCommentPost.productPrice || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Sale</div>
                            <div className="mt-1 text-sm font-black text-white">{selectedSocialThreadPost.productSalePrice || selectedSocialCommentPost.productSalePrice || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Sizes</div>
                            <div className="mt-1 text-sm font-black text-white">{clean(selectedSocialThreadPost.productSizes || selectedSocialCommentPost.productSizes || "") || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Colors</div>
                            <div className="mt-1 text-sm font-black text-white">{clean(selectedSocialThreadPost.productColors || selectedSocialCommentPost.productColors || "") || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Stock</div>
                            <div className="mt-1 text-sm font-black text-white">-</div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" disabled className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-black text-slate-400">
                            نسخ تفاصيل المنتج
                          </button>
                          <button type="button" disabled className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-black text-slate-400">
                            Reply on comment
                          </button>
                          <button type="button" disabled className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-black text-slate-400">
                            Send private message
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Post status</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                          <Pill tone={selectedSocialCommentPost.newCount > 0 ? "amber" : "zinc"}>{selectedSocialThreadComments.length > 0 ? selectedSocialThreadComments.length : (selectedSocialCommentPost.commentsCount ?? 0)} comments</Pill>
                          <Pill tone={selectedSocialCommentPost.newCount > 0 ? "amber" : "emerald"}>{Number(selectedSocialCommentPost.newCount || 0)} new</Pill>
                          <Pill tone={socialReplySettings.generic_enabled ? "emerald" : "zinc"}>{socialReplySettings.generic_enabled ? "Auto Reply ON" : "Auto Reply OFF"}</Pill>
                        </div>
                        {selectedSocialThread.loading ? <LoadingBlock text="جارٍ تحميل التعليقات..." /> : null}
                        {selectedSocialThread.error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{selectedSocialThread.error}</div> : null}
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Post Auto Reply Template</div>
                            <div className="mt-1 text-sm font-black text-white">Template specific to this post</div>
                          </div>
                          <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] font-black">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedSocialTemplate.template?.enabled)}
                              onChange={(event) => setSelectedSocialTemplate((current) => ({
                                ...current,
                                template: { ...(current.template || {}), enabled: event.target.checked },
                              }))}
                            />
                            {selectedSocialTemplate.template?.enabled ? "Enabled" : "Disabled"}
                          </label>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] font-black">
                            <input
                              type="checkbox"
                              checked={selectedSocialTemplate.template?.like_enabled !== false}
                              onChange={(event) => setSelectedSocialTemplate((current) => ({
                                ...current,
                                template: { ...(current.template || {}), like_enabled: event.target.checked },
                              }))}
                            />
                            Like comment
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] font-black">
                            <input
                              type="checkbox"
                              checked={selectedSocialTemplate.template?.reply_enabled !== false}
                              onChange={(event) => setSelectedSocialTemplate((current) => ({
                                ...current,
                                template: { ...(current.template || {}), reply_enabled: event.target.checked },
                              }))}
                            />
                            Reply comment
                          </label>
                        </div>
                        <select
                          value={selectedSocialTemplate.template?.mode || "manual_approval"}
                          onChange={(event) => setSelectedSocialTemplate((current) => ({
                            ...current,
                            template: { ...(current.template || {}), mode: event.target.value },
                          }))}
                          className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                        >
                          <option value="draft">Draft only</option>
                          <option value="manual_approval">Manual Approval</option>
                          <option value="full_auto">Full Auto</option>
                          <option value="off">Off</option>
                        </select>
                        <textarea
                          value={selectedSocialTemplate.template?.template || ""}
                          onChange={(event) => setSelectedSocialTemplate((current) => ({
                            ...current,
                            template: { ...(current.template || {}), template: event.target.value },
                          }))}
                          rows={4}
                          className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                          placeholder="Template text using {customer_name}, {product_name}, {price}, {sale_price}, {sizes}, {colors}, {product_link}, {post_link}, {store_address}, {shipping_time}"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const payload = await api.post(`/social-comments/posts/${encodeURIComponent(selectedSocialCommentPost.postId || selectedSocialCommentPost.conversationId || "")}/template`, {
                                  tenant_id: tenantId,
                                  platform: clean(selectedSocialCommentPost.platform || "facebook"),
                                  ...selectedSocialTemplate.template,
                                }, { headers, perfComponent: "AiInbox.socialPostTemplateSave" });
                                setSelectedSocialTemplate({
                                  template: payload.template || null,
                                  loading: false,
                                  error: "",
                                });
                                setToast({ tone: "emerald", text: "تم حفظ القالب" });
                              } catch (templateError) {
                                setToast({ tone: "rose", text: templateError?.message || "تعذر حفظ القالب" });
                              }
                            }}
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950"
                          >
                            Save Template
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const payload = await api.post(`/social-comments/comments/${encodeURIComponent(clean(selectedSocialThread.comments[0]?.comment_id || ""))}/auto-reply-preview`, {
                                  tenant_id: tenantId,
                                  platform: clean(selectedSocialCommentPost.platform || "facebook"),
                                  post_id: clean(selectedSocialCommentPost.postId || selectedSocialCommentPost.conversationId || ""),
                                }, { headers, perfComponent: "AiInbox.socialCommentPreview" });
                                setToast({ tone: "emerald", text: payload?.preview?.rendered_reply ? "تم إنشاء معاينة الرد" : "لا توجد معاينة متاحة" });
                              } catch (previewError) {
                                setToast({ tone: "rose", text: previewError?.message || "تعذر إنشاء المعاينة" });
                              }
                            }}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-black text-slate-200"
                          >
                            Preview
                          </button>
                        </div>
                        {selectedSocialTemplate.loading ? <div className="mt-3 text-xs text-slate-500">جارٍ تحميل القالب...</div> : null}
                        {selectedSocialTemplate.error ? <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{selectedSocialTemplate.error}</div> : null}
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Comments Timeline</div>
                            <div className="mt-1 text-sm font-black text-white">لا توجد إعدادات خاصة لهذا المنشور</div>
                          </div>
                          {selectedSocialThread.comments.length ? <Pill tone="zinc">{selectedSocialThread.comments.length} تعليق</Pill> : null}
                        </div>
                        <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                          {selectedSocialThreadComments.length ? selectedSocialThreadComments.map((comment) => {
                            const commentKey = clean(comment.id || "");
                            const status = clean(comment.replyStatus || "not replied");
                            return (
                              <div key={commentKey || comment.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <div className="h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
                                      {clean(comment.customerAvatar || "") ? (
                                        <img src={clean(comment.customerAvatar || "")} alt="" className="h-full w-full object-cover" />
                                      ) : null}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-black text-white">{clean(comment.customerName || "Customer")}</div>
                                      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{absoluteTime(comment.createdTime)}</div>
                                    </div>
                                  </div>
                                  <Pill tone={status === "sent" ? "emerald" : status === "failed" ? "rose" : "zinc"}>{status.replace(/_/g, " ")}</Pill>
                                </div>
                                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{clean(comment.message || "")}</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await api.post(`/social-comments/comments/${encodeURIComponent(commentKey)}/auto-reply-send`, {
                                          tenant_id: tenantId,
                                          platform: clean(selectedSocialCommentPost.platform || "facebook"),
                                          post_id: clean(selectedSocialCommentPost.postId || selectedSocialCommentPost.conversationId || ""),
                                        }, { headers, perfComponent: "AiInbox.socialCommentReply" });
                                        void loadAll({ silent: true });
                                      } catch (replyError) {
                                        setToast({ tone: "rose", text: replyError?.message || "تعذر إرسال الرد" });
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100"
                                  >
                                    Preview / Send Auto Reply
                                  </button>
                                  <button type="button" disabled className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-400">
                                    تم إرسال الرد
                                  </button>
                                  <button type="button" disabled className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-400">
                                    إرسال رسالة خاصة
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await api.post(`/social-comments/comments/${encodeURIComponent(commentKey)}/ignore`, {
                                          tenant_id: tenantId,
                                          platform: clean(selectedSocialCommentPost.platform || "facebook"),
                                          post_id: clean(selectedSocialCommentPost.postId || selectedSocialCommentPost.conversationId || ""),
                                          reason: "ignore",
                                        }, { headers, perfComponent: "AiInbox.socialCommentIgnore" });
                                        void loadAll({ silent: true });
                                      } catch (ignoreError) {
                                        setToast({ tone: "rose", text: ignoreError?.message || "تعذر تجاهل التعليق" });
                                      }
                                    }}
                                    className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-300"
                                  >
                                    تجاهل
                                  </button>
                                </div>
                              </div>
                            );
                          }) : <EmptyBlock text="لا توجد تعليقات في هذا المنشور" />}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyBlock text="لا توجد تعليقات لعرضها" />
              )}
            </main>
          </section>
        ) : null}

        <section dir="ltr" className={`${inboxSection === "social_comments" ? "hidden" : ""} grid min-h-0 flex-1 gap-3 overflow-hidden ${fullscreenConversation ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,18%)_minmax(0,62%)_minmax(0,20%)]"}`}>
          {!fullscreenConversation && profileOpen ? (
            <aside className="hidden min-w-0 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-3 xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-15rem)] xl:flex-col xl:overflow-y-auto xl:w-full xl:max-w-none">
              <CustomerProfilePanel
                conversation={selectedConversation}
                canSyncMessenger={canSyncMessengerProfile(selectedConversation)}
                syncing={profileSyncing}
                onSyncMessengerProfile={syncMessengerProfile}
              />
            </aside>
          ) : null}

          <main className="min-w-0 space-y-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
              {activeMainItem ? (
                <>
                  <InboxChatHeader
                    conversation={safeConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading}
                    labelsSaving={leadActionLoading === "labels"}
                    onLabelsChange={updateConversationLabels}
                    onToggleAi={toggleAiEnabled}
                    onOpenTools={() => setProfileOpen(true)}
                    isFullscreenConversation={conversationExpanded}
                    onToggleFullscreen={handleToggleConversationExpansion}
                    onOpenCustomer360={openCustomerDrawer}
                  />
                  {isCommentConversation(selectedConversation || {}) ? (
                    <CommentAutomationBadges automationState={selectedConversation?.channel_metadata?.automation_state || selectedConversation?.automation_state || {}} />
                  ) : null}

                  <div className="mt-1.5 grid gap-1.5 rounded-2xl border border-white/10 bg-slate-950/60 p-2 text-[11px] sm:grid-cols-3">
                    <div><span className="text-slate-500">آخر ويب هوك</span><div className={selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "سليم" : "غير سليم"}</div></div>
                    <div><span className="text-slate-500">Token</span><div className={selectedTokenActive ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedTokenActive ? "نشط" : "مفقود"}</div></div>
                    <div><span className="text-slate-500">Messaging</span><div className={selectedMessagingActive ? "font-black text-emerald-100" : "font-black text-slate-300"}>{selectedMessagingActive ? "نشط" : "غير مفعّل"}</div></div>
                    {safeConversation.escalation_reason || safeConversation.last_escalation_keyword ? (
                      <div className="sm:col-span-3">
                        <span className="text-slate-500">سبب التصعيد</span>
                        <div className="font-black text-amber-100">
                          {safeConversation.escalation_reason || "تم تصعيد المحادثة"}
                          {safeConversation.last_escalation_keyword ? ` / ${safeConversation.last_escalation_keyword}` : ""}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-1.5 grid gap-1.5 rounded-2xl border border-white/10 bg-slate-950/65 p-2 lg:grid-cols-4">
                    <Info label="درجة العميل المحتمل" value={conversationLeadScore(safeConversation)} />
                    <Info label="حرارة العميل" value={conversationLeadTemperature(safeConversation)} />
                    <Info label="الإجراء المقترح" value={conversationRecommendedSalesAction(safeConversation)} />
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3 lg:col-span-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">أسباب التقييم</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {conversationLeadReasons(safeConversation).length ? conversationLeadReasons(safeConversation).map((reason) => <Pill key={reason} tone="zinc">{reason.replace(/_/g, " ")}</Pill>) : <span className="text-sm text-slate-500">لا توجد أسباب بعد</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5">
                    <SalesIntelligencePanel
                      conversation={selectedConversation}
                      recommendationIntel={recommendations.sessionId === safeConversation.session_id ? recommendations.intelligence : null}
                      salesCloserPlan={salesCloser.sessionId === safeConversation.session_id ? salesCloser.plan : {}}
                    />
                  </div>

                  <ConversationActions
                    conversation={selectedConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading}
                    assignName={currentAssignName}
                    onAssignNameChange={updateAssignName}
                    onAction={updateConversationAction}
                  />
                  <button type="button" onClick={() => setOrderComposerOpen(true)} className="mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-black text-slate-950 shadow-[0_14px_35px_rgba(52,211,153,0.18)]"><ShoppingCart className="h-5 w-5" />إنشاء طلب من المحادثة</button>

                  <details className="group mb-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">أدوات الدعم</div>
                        <div className="mt-1 text-sm font-black text-white">فحص الجلسة والملف الشخصي والحالة الحالية</div>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black text-slate-200">
                        <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                        عرض
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isWhatsappChannel(safeConversation.channel || safeConversation.source) ? (
                            <button
                              type="button"
                              onClick={openAiTrace}
                              disabled={aiTrace.loading && aiTrace.sessionId === safeConversation.session_id}
                              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50"
                            >
                              {aiTrace.loading && aiTrace.sessionId === safeConversation.session_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                              عرض تتبع الذكاء
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={syncMessengerProfile}
                            disabled={profileSyncing}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                          >
                            {profileSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            مزامنة ملف العميل
                          </button>
                          <button
                            type="button"
                            onClick={debugMessengerProfile}
                            disabled={profileDebugging}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50"
                          >
                            {profileDebugging ? <Loader2 className="h-4 w-4 animate-spin" /> : <InfoIcon className="h-4 w-4" />}
                            فحص ملف العميل
                          </button>
                          <button
                            type="button"
                            onClick={resetAiState}
                            disabled={resettingAiState}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50"
                          >
                            {resettingAiState ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            إعادة ضبط حالة الذكاء
                          </button>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <button type="button" onClick={() => setProfileOpen((value) => !value)} className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-100">
                          {profileOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                          {profileOpen ? "إغلاق الملف" : "فتح الملف"}
                        </button>
                      </div>
                    </div>
                    {canViewAiDebug ? (
                      <div className="mt-4">
                        <AiDebugPanel
                          open={aiDebug.open}
                          loading={aiDebug.loading && aiDebug.sessionId === safeConversation.session_id}
                          error={aiDebug.sessionId === safeConversation.session_id ? aiDebug.error : ""}
                          data={aiDebug.sessionId === safeConversation.session_id ? aiDebug.data : null}
                          onToggle={toggleAiDebug}
                          onRefresh={loadAiDebug}
                        />
                      </div>
                    ) : null}
                  </details>

                  <div className="mb-2 grid gap-3 xl:grid-cols-2">
                    <AutoReplyModePanel
                      channelStatus={selectedChannelStatus}
                      mode={resolveChannelAutoReplyMode(selectedChannelStatus)}
                      onChange={updateAutoReplyMode}
                      saving={modeSaving}
                    />
                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <SectionTitle icon={Sparkles} title="رد الذكاء الاصطناعي" action={(
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={autoReplyShadowTone} className="px-2 py-0.5 text-[10px] font-black">{autoReplyShadowLabel}</Pill>
                          {aiReply.loading ? <Pill tone="cyan">جارٍ التحضير...</Pill> : null}
                        </div>
                      )} />
                      {aiReply.error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{aiReply.error}</div> : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => generateAiReply({ persist: false })} disabled={aiReply.loading || safeConversation.conversation_status === "closed"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">{aiReply.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}إنشاء رد مقترح</button>
                        <button type="button" onClick={() => generateAiReply({ persist: true })} disabled={aiReply.loading || safeConversation.conversation_status !== "ai_active"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><Bot className="h-4 w-4" />اعتماد رد الذكاء</button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 xl:grid-cols-2">
                    <SalesCloserPanel
                      plan={salesCloser.sessionId === safeConversation.session_id ? salesCloser.plan : {}}
                      products={recommendations.sessionId === safeConversation.session_id ? recommendations.products : []}
                      conversation={safeConversation}
                      loading={salesCloser.loading || loading}
                      onRefresh={loadSalesCloser}
                      onTakeover={() => updateConversationAction("takeover")}
                      onUseText={setReplyText}
                      onCreateDraft={createDraftFromProduct}
                      onPaymentAction={usePaymentAction}
                      onOpenProductPicker={openProductCardPicker}
                    />
                    <RecommendationsPanel
                      products={recommendations.sessionId === safeConversation.session_id ? recommendations.products : []}
                      loading={recommendations.loading}
                      onRefresh={loadRecommendations}
                      onQuickSend={quickSendProduct}
                      onSendImages={sendProductImages}
                      onCreateDraft={createDraftFromProduct}
                    />
                  </div>

                  <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.75fr)]">
                    <div className="flex min-h-0 flex-col gap-2">
                      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black leading-5">سجل المحادثة</h3>
                            <p className="text-[11px] leading-4.5 text-slate-400">مراجعة الرسائل والأحداث والردود المقترحة داخل المحادثة.</p>
                          </div>
                          {selectedConversation?.messages?.length ? <Pill tone="zinc">{selectedConversation.messages.length} رسالة</Pill> : null}
                        </div>
                        <div ref={transcriptScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
                          <Transcript
                            conversation={selectedConversation}
                            rows={selectedTranscriptRows}
                            events={selectedTranscriptEvents}
                            loadingOlder={olderMessagesLoading}
                            onLoadOlder={loadOlderMessages}
                            onOpenCorrection={openReplyCorrection}
                            onReplyComment={sendLeadCommentReplyQuick}
                            onPrivateMessage={sendLeadPrivateMessage}
                            olderMessagesAvailable={Boolean(selectedConversation?.older_messages_available)}
                          />
                        </div>
                      </div>
                      <div className="sticky bottom-0 z-20">
                        <ManualReplyComposer
                        conversation={{ ...safeConversation, live_sending_available: Boolean(selectedChannelStatus.effective_enabled) || isMetaChannel(safeConversation.channel || safeConversation.source) }}
                        value={replyText}
                        onChange={setReplyText}
                        onSend={() => sendCurrentReply()}
                        onOpenProductPicker={() => openProductCardPicker()}
                        onOpenAvailableBySizePicker={() => openProductCardPicker({ sizeMode: true, allowMultiple: true })}
                        onCreateCustomer={createLeadCustomer}
                        onLoadDraft={(text) => setReplyText(text)}
                        onCopyDraft={copySuggestedReply}
                        commentDraftText={latestCommentReplyDraft}
                        isCommentConversation={isCommentConversation(selectedConversation || {})}
                        loading={Boolean(leadActionLoading || replySending || productCardSending || availableBySizeSending)}
                        validationSummary={activeAiReplyValidation}
                        confidenceEngineSummary={activeAiReplyConfidence}
                        aiSuggestionText={activeAiSuggestionText}
                        aiSuggestionVisible={aiSuggestionVisible}
                        aiSuggestionEditing={editingAiDraft}
                        aiSuggestionProductCard={effectiveSuggestionCard}
                        aiSuggestionProductChoices={suggestionSendPackage?.card_choices || []}
                        aiSuggestionProductAmbiguous={Boolean(suggestionSendPackage?.product_ambiguous)}
                        aiSuggestionColorChoices={suggestionSendPackage?.color_choices || []}
                        aiSuggestionColorRequired={Boolean(suggestionSendPackage?.color_choice_required)}
                        aiSuggestionRecommendationMode={isRecommendationSuggestion}
                        aiSuggestionRecommendationSelectedKeys={suggestionRecommendationKeys}
                        onToggleSuggestionRecommendation={handleToggleRecommendationCard}
                        aiSuggestionProductRemoved={suggestionProductRemoved}
                        aiSuggestionDeliveryFormat={suggestionDeliveryFormat?.label || ""}
                        aiSuggestionEditText={aiSuggestionEditText}
                        onAiSuggestionEditTextChange={setAiSuggestionEditText}
                        onCancelEditAiSuggestion={handleCancelEditAiSuggestion}
                        onRemoveSuggestionProduct={handleRemoveSuggestionProduct}
                        onChangeSuggestionProduct={handleChangeSuggestionProduct}
                        onChooseSuggestionProduct={handleChooseSuggestionProduct}
                        onEditAiSuggestion={handleEditAiSuggestion}
                        onApproveAiSuggestion={handleApproveAiSuggestion}
                        onDismissAiSuggestion={handleDismissAiSuggestion}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      {selectedConversation?.draft_orders?.length ? <OrderDraftPanel conversation={selectedConversation} drafts={drafts} onAction={updateDraft} busy={loading} /> : null}
                    </div>
                  </div>
                </>
              ) : <EmptyBlock text={isSocialMode ? "لا توجد تعليقات محددة" : "لا توجد محادثة محددة"} />}
            </div>
          </main>

          <aside className="hidden min-w-0 w-full shrink-0 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-3 xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-15rem)] xl:w-full xl:max-w-none xl:flex-col xl:overflow-y-auto">
            <SectionTitle
              icon={MessageSquareText}
              title={inboxSection === "social_comments" ? "تعليقات السوشيال" : "قائمة المحادثات"}
              action={<Pill tone="zinc">{inboxSection === "social_comments" ? socialComments.items.length : filteredConversations.length} {inboxSection === "social_comments" ? "تعليق" : "محادثة"}</Pill>}
            />
            {inboxSection === "conversations" ? (
              <>
                {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
	                <div className="flex flex-col gap-3">
	                  <label className="relative min-w-0">
	                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
	                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهاتف أو اسم الصفحة أو محتوى الرسالة" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
	                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
                      <ArrowUpDown className="h-4 w-4 text-slate-500" />
                      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الترتيب</span>
                      <select value={leadSort} onChange={(event) => setLeadSort(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
                        <option value="recent">الأحدث</option>
                        <option value="lead_score_desc">الأعلى في درجة العميل</option>
                        <option value="favorites_first">المفضلة أولاً</option>
                      </select>
                    </label>
                      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
  <Star className="h-4 w-4 text-amber-300" />
  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">المفضلة</span>
  <select value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
    {FAVORITE_FILTERS.map((item) => (
      <option key={item.key} value={item.key}>
        {item.label}
      </option>
    ))}
  </select>
</label>
                  </div>
	                </div>
	                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                  {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
                  {filteredConversations.length ? (
                    <div className="space-y-2 pr-1">
                      {filteredConversations.map((item) => {
                        const itemKey = item.conversation_key || `${normalizeConversationChannel(item)}:${item.session_id}`;
	                          return (
	                            <ConversationListItem
	                              key={itemKey}
	                              item={item}
	                              unseen={unseenSessions.includes(itemKey)}
	                              active={selectedConversation?.conversation_key === itemKey}
	                              onSelect={handleSelectConversation}
	                              onOpenCustomer360={openCustomerDrawer}
	                              onToggleFavorite={toggleConversationFavorite}
	                            />
                        );
                      })}
                    </div>
                  ) : !loading ? <EmptyBlock text={leadFilter === "all" && filter === "all" ? "لا توجد محادثات Meta بعد. سيظهر النشاط هنا مع بدء استقبال الرسائل والتعليقات." : "لا توجد محادثات مطابقة للفلاتر الحالية."} /> : null}
                </div>
              </>
            ) : null}
          </aside>
        </section>
      </div>
      <InboxOrderComposer
        open={orderComposerOpen}
        conversation={selectedConversation || {}}
        products={recommendations.sessionId === selectedConversation?.session_id ? recommendations.products : []}
        busy={loading}
        headers={headers}
        onClose={() => setOrderComposerOpen(false)}
        onSubmit={createDraftFromProduct}
      />
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  const color = {
    emerald: "text-emerald-200",
    cyan: "text-cyan-200",
    amber: "text-amber-200",
    violet: "text-violet-200",
  }[tone] || "text-slate-200";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <Icon className={`h-5 w-5 ${color}`} />
      <div className="mt-3 text-2xl font-black">{value}</div>
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  );
}

function LoadingBlock({ text }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center text-sm text-slate-400">{text}</div>;
}

function EmptyBlock({ text }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">{text}</div>;
}
