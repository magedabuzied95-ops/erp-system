import { createPortal } from "react-dom";
import { Fragment, Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  CheckCheck,
  ChevronLeft,
  Clock3,
  Download,
  ExternalLink,
  Globe,
  Image,
  Layers3,
  Loader2,
  Maximize2,
  MessageCircleMore,
  MessageSquareText,
  MoreHorizontal,
  Minimize2,
  PackagePlus,
  Ruler,
  Search,
  Send,
  Settings,
  Smile,
  ShieldBan,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Mail as MailIcon,
  Sun,
  Moon,
  UserRound,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { FaFacebookMessenger, FaInstagram, FaTelegramPlane, FaWhatsapp } from "react-icons/fa";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { subscribeRealtime, useRealtimeStatus } from "../../../shared/realtime/socketStore";
import {
  handleInboundInboxMessage,
  primeInboxChime,
  refreshInboxPushSubscription,
  subscribeToPushWorkerMessages,
} from "../services/inboxNotifications";
import InboxNotificationBell from "../components/InboxNotificationBell";
import WhatsappSessionAlert from "../components/WhatsappSessionAlert";
import usePermission from "../../permissions/hooks/usePermission";
import { formatCurrency } from "../../../shared/lib/currency";
import { getProductAudienceValues } from "../../../shared/lib/productAudiences";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import { useTheme } from "../../../theme/useTheme";
import Customer360Drawer from "../components/Customer360Drawer.jsx";
import AIInboxAnalysisPanel from "../components/AIInboxAnalysisPanel.jsx";
import AvatarZoom from "../components/AvatarZoom.jsx";
import CustomerAvatar from "../components/CustomerAvatar.jsx";
import { resolveMetaCustomerIdentity } from "../lib/customerIdentity.js";
import { useAIInboxAnalysis } from "../integration/useAIInboxAnalysis";
import TranscriptMessage, { INSTAGRAM_MESSAGE_REACTIONS, MESSENGER_MESSAGE_REACTIONS, PinnedMessagesBar } from "../components/TranscriptMessage";
import { cascadeDeliveryStatuses } from "../components/DeliveryTicks.jsx";
import ProductCardMessage from "../components/ProductCardMessage";
import SocialCommentsPanel from "../components/SocialCommentsPanel";
import { normalizeSocialPostDisplay, SocialCommentsWorkspaceCommentRow } from "../components/SocialCommentsWorkspace.jsx";
import PostProductLinksDrawer from "../components/socialAutomation/PostProductLinksDrawer.jsx";
import { CommentTimelineCard, getSocialCommentRealTimestamp } from "../components/socialCommentTimeline.jsx";
import ProductCardPicker from "../components/ProductCardPicker";
import IntegrationsCenter from "../components/integrations/lazyIntegrationsCenter";
// The suggested-reply card is shared with the desktop workspace, so resolving an
// ambiguous product, picking a colour or ticking a batch works the same in both.
import AiSuggestionCard from "../components/AiSuggestionCard";
import ReplyCorrectionModal, { buildReplyCorrectionDraft } from "../components/ReplyCorrectionModal";
import ConversationLabelsModal, { conversationLabelClass } from "../components/ConversationLabelsModal";
import { aiInboxLabelsFromConversation, normalizeAiInboxConversationLabels } from "../../../../shared/aiInboxConversationLabels.js";
import { CommentsSettingsModal } from "../components/CommentsSettings.jsx";
import { WhatsappMessageVariantsModal } from "../components/WhatsappMessageVariantsEditor.jsx";
import {
  MAX_BATCH_PRODUCTS,
  SELECTION_MODES,
  maxBatchReachedText,
  maxVariantBatchReachedText,
  productSelectionKey,
  selectionModeFromSemantics,
  toggleProductSelection,
} from "../lib/productSelection.js";
import inboxCache from "../services/inboxCache/inboxCache";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions, normalizeCanonicalProductType, normalizeClassificationValue } from "../../products/lib/productClassifications";
import { moveWinterCollectionToEnd, normalizeMultiFilterValue, toggleMultiFilterValue } from "../../pos/lib/posQuickFilterLogic";
// One composer for both surfaces. The phone-only PwaOrderComposer (single
// product, no cart, no discount, no payment method, no shipping quote, no saved
// addresses) is retired — see components/InboxOrderComposer.jsx.
import InboxOrderComposer from "../components/InboxOrderComposer";
import { prefetchSocialWorkspace, readSocialWorkspaceCache, socialWorkspaceCacheKey, primeSocialWorkspaceCache } from "../services/socialWorkspaceProgressiveLoad.js";
import { loadCustomerProductCatalog } from "../services/customerProductCatalog";
import {
  WEAK_CONVERSATION_CHANNELS,
  backendChannelFilter,
  channelFromConversationSessionId,
  channelWindow,
  channelsForFilter,
  conversationAccountKey,
  mergeConversationPages,
} from "../services/inboxChannels";
import "./AiInboxPwa.css";
import { QuickRepliesConfig, QuickRepliesPicker, useQuickReplies } from "../components/QuickReplies.jsx";
import { AppleEmojiPicker } from "../components/AppleEmojiPicker.jsx";
import {
  ENABLE_SOCIAL_FAST_CENTER,
  GENERIC_CUSTOMER_NAMES,
  MESSAGE_LIKE_NAME_KEYWORDS,
  aiAgentInboxEndpoint,
  aiInboxConversationEndpoint,
  aiReplyCorrectionEndpoint,
  asArray,
  avatarRefreshRequested,
  buildClientRequestId,
  clean,
  encodeConversationId,
  firstUsefulCustomerName,
  getConversationThreadMetadata,
  isConversationAiEnabled,
  isFromMeMessage,
  isGenericCustomerName,
  isLikelyMessengerExternalId,
  isSocialPostSummary,
  isUsefulCommenterName,
  looksLikeMessageName,
  messageIdentityKeys,
  normalizeProductCardsValue,
  normalizeValidationSummary,
  transcriptDayKey,
  transcriptDayLabel,
  transcriptRowTime,
} from "../lib/conversationHelpers";

// Heavy and rarely opened: kept out of the inbox's critical path, exactly as the
// desktop workspace loads it.


const isWhatsappChannel = (value = "") => clean(value).toLowerCase().includes("whatsapp");
const SOCIAL_COMMENTS_CACHE_PREFIX = "m1:ai-inbox-pwa:social-posts";
const socialCommentsCacheKey = (tenantId = "") =>
  `${SOCIAL_COMMENTS_CACHE_PREFIX}:${clean(tenantId) || "default"}`;
const readSocialCommentsCache = (tenantId = "") => {
  if (typeof window === "undefined") return [];
  try {
    const cached = JSON.parse(window.localStorage.getItem(socialCommentsCacheKey(tenantId)) || "null");
    return asArray(cached?.items).slice(0, 200);
  } catch {
    return [];
  }
};
const writeSocialCommentsCache = (tenantId = "", items = []) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      socialCommentsCacheKey(tenantId),
      JSON.stringify({ items: asArray(items).slice(0, 200), saved_at: new Date().toISOString() })
    );
  } catch {
    // Storage can be unavailable in private mode; the live list still works normally.
  }
};
// A brand-new Messenger conversation can land with customer_name set to the customer's
// first message (e.g. "ممكن صور جوردن فور") before the Facebook profile is fetched. Detect
// that so we can trigger a profile sync and replace it with the real name + avatar. Mirrors
// the backend messenger-name-repair heuristic. False positives only cost one extra profile
// fetch (gated per conversation), so this can be a little aggressive.
// Day separators for the chat transcript ("اليوم" / "أمس" / "12 ديسمبر 2026").
// Order composition is owned by the SHARED InboxOrderComposer, the same component
// the desktop workspace renders. Two inline phone-only implementations used to sit
// here: unreachable, duplicating the same UI, and holding a second Arabic-only copy
// outside the canonical i18n path. Both are gone.
const customerIdentifier = (...values) => {
  const value = values.map((item) => clean(item)).find(Boolean) || "";
  return value
    .replace(/^whatsapp:/i, "")
    .replace(/@(?:s\.whatsapp\.net|c\.us|lid)$/i, "")
    .trim();
};

const cleanMessageText = (value, depth = 0) => {
  if (value == null || depth > 3) return "";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text === "[object Object]" ? "" : text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanMessageText(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const textKeys = ["text", "body", "content", "message_text", "message", "value", "caption"];
    for (const key of textKeys) {
      const text = cleanMessageText(value?.[key], depth + 1);
      if (text) return text;
    }
  }
  return "";
};
const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
const DEBUG_SOCIAL_PERF = truthy(import.meta.env?.VITE_DEBUG_SOCIAL_PERF) || truthy(import.meta.env?.VITE_SOCIAL_PERF_DEBUG);
const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
};
const money = (value) => formatCurrency(Number(value || 0));
const normalizeKey = (value = "") => clean(value).toLowerCase();
const normalizeConfidenceEngineSummary = (value = {}) => {
  const engine = value && typeof value === "object" ? value : {};
  const scoreValue = Number(engine.score ?? engine.confidence_score ?? 0);
  const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, scoreValue)) : 0;
  const level = clean(engine.level || engine.confidence_level || "").toLowerCase() || (score >= 80 ? "high" : score >= 60 ? "medium" : score >= 35 ? "low" : "critical");
  const decision = clean(engine.decision || "").toLowerCase() || (score >= 70 ? "safe" : score >= 35 ? "review" : "high_risk");
  const reasons = asArray(engine.reasons || []).map((item) => clean(item)).filter(Boolean);
  const riskFlags = engine.risk_flags && typeof engine.risk_flags === "object" ? engine.risk_flags : {};
  const levelLabel = level === "high" ? "High" : level === "medium" ? "Medium" : level === "low" ? "Low" : "Critical";
  const decisionLabel = decision === "safe" ? "Safe" : decision === "review" ? "Review" : "High Risk";
  const tone = decision === "high_risk" ? "rose" : decision === "review" ? "amber" : "emerald";
  return {
    score,
    level,
    levelLabel,
    decision,
    decisionLabel,
    tone,
    reasons,
    reasonsPreview: reasons.slice(0, 3),
    reasonsCount: reasons.length,
    riskFlags,
    riskFlagsCount: Object.values(riskFlags).filter(Boolean).length,
  };
};

const getVariantRows = (product = {}) => [
  ...(Array.isArray(product.variants) ? product.variants : []),
  ...(Array.isArray(product.product_variants) ? product.product_variants : []),
  ...(Array.isArray(product.productVariants) ? product.productVariants : []),
  ...(Array.isArray(product.variantRows) ? product.variantRows : []),
  ...(Array.isArray(product.variant_options) ? product.variant_options : []),
].filter(Boolean);

const PRODUCT_FILTER_DEFAULTS = Object.freeze({
  audience: [],
  brand: [],
  mainCategory: "all",
  subCategory: "all",
  childCategory: "all",
  productType: "all",
  grade: "all",
  manufacturer: [],
  stock: "all",
});

const normalizeProductFilterValue = (value = "") =>
  clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const productAudienceKeys = (product = {}) => {
  return new Set(getProductAudienceValues(product));
};

const firstProductField = (product = {}, fields = []) => {
  const sources = [product, ...getVariantRows(product)];
  for (const source of sources) {
    for (const field of fields) {
      const value = source?.[field];
      if (value !== null && value !== undefined && clean(value)) return clean(value);
    }
  }
  return "";
};

const productFilterMeta = (product = {}) => {
  const field = (keys) => normalizeProductFilterValue(firstProductField(product, keys));
  const variants = getVariantRows(product);
  const stockValues = [product.total_stock, product.stock, product.stock_quantity, ...variants.flatMap((variant) => [variant.stock_quantity, variant.stock])]
    .map(Number)
    .filter(Number.isFinite);
  const available = variants.some((variant) => variant.available === true || Number(variant.stock_quantity ?? variant.stock ?? 0) > 0) || stockValues.some((value) => value > 0);
  return {
    audience: productAudienceKeys(product),
    brand: field(["brand_name", "brand"]),
    mainCategory: field(["main_category_name", "main_category", "category_name", "category"]),
    subCategory: field(["sub_category_name", "sub_category", "subcategory_name", "subcategory"]),
    childCategory: field(["child_category_name", "child_category"]),
    productType: normalizeCanonicalProductType(firstProductField(product, ["product_type", "productType", "type"])),
    grade: normalizeClassificationValue(firstProductField(product, ["grade", "product_grade"])),
    manufacturer: field(["manufacturer_name", "manufacturer"]),
    stock: available ? "in" : "out",
  };
};

const productSheetIdentity = (product = {}, index = 0) =>
  clean(product.product_id || product.id || product.uuid || product.sku || product.barcode || product.slug) ||
  `product-${normalizeProductFilterValue(product.name || product.product_name || "item")}-${index}`;

const tenantIdFromAuth = () => {
  const tenant = getCurrentTenant?.() || {};
  const user = getCurrentUser?.() || {};
  return String(user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "1");
};

const usePageVisible = () => {
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
};

const CONVERSATION_CHANNEL_PREFIXES = new Map([
  ["facebook_messenger", "facebook_messenger"],
  ["facebook", "facebook_messenger"],
  ["messenger", "facebook_messenger"],
  ["instagram", "instagram"],
  ["telegram", "telegram"],
  ["whatsapp", "whatsapp"],
  ["web_chat", "web_chat"],
  ["web", "web_chat"],
]);

const normalizeConversationPrefix = (value = "") => {
  const raw = clean(value).toLowerCase();
  return CONVERSATION_CHANNEL_PREFIXES.get(raw) || "";
};

const stripConversationPrefixes = (value = "") => {
  let current = clean(value);
  let prefix = "";

  while (current) {
    const match = current.match(/^([a-z0-9_]+):(.*)$/i);
    if (!match) break;
    const nextPrefix = normalizeConversationPrefix(match[1]);
    if (!nextPrefix) break;
    prefix = prefix || nextPrefix;
    current = clean(match[2]);
  }

  return { prefix, value: current };
};

const normalizeConversationSessionId = (value = "", channel = "") => {
  const raw = clean(value);
  if (!raw) return "";

  const stripped = stripConversationPrefixes(raw);
  const detectedPrefix = stripped.prefix || normalizeConversationPrefix(channel);
  const baseSessionId = stripped.value || raw;
  if (!baseSessionId) return raw;
  if (
    detectedPrefix === "whatsapp" ||
    /@(?:s\.whatsapp\.net|lid)$/i.test(raw) ||
    (!detectedPrefix && /^\+?\d+$/.test(baseSessionId))
  ) {
    // A customer who hides their number behind a WhatsApp username is keyed by
    // their LID, which has its own key space. Scraping its digits out rewrites
    // the key and sends the reply into a thread of its own.
    const lid = (/^lid:(\d+)$/i.exec(baseSessionId) || /^(\d+)@lid$/i.exec(raw) || [])[1] || "";
    if (lid) return `whatsapp:lid:${lid}`;
    const digits = clean(baseSessionId).replace(/^whatsapp:/i, "").replace(/@(?:s\.whatsapp\.net|lid)$/i, "").replace(/\D/g, "");
    if (digits) return `whatsapp:${digits.startsWith("20") && digits.length === 12 ? digits : digits.startsWith("0") && digits.length === 11 ? `20${digits.slice(1)}` : digits}`;
  }
  if (!detectedPrefix) return baseSessionId;
  return `${detectedPrefix}:${baseSessionId}`;
};

const buildMessageIdentityKey = ({ tenantId = "", sessionId = "", direction = "outbound", clientRequestId = "", providerMessageId = "", externalMessageId = "" } = {}) => {
  const canonicalSessionId = normalizeConversationSessionId(sessionId);
  const stableKey = clean(clientRequestId || providerMessageId || externalMessageId);
  return stableKey && canonicalSessionId ? `msg:${clean(tenantId)}|${canonicalSessionId}|${clean(direction || "outbound")}|${stableKey}` : "";
};

const messagePrimaryKey = (message = {}) => messageIdentityKeys(message)[0] || "";

const messagesShareIdentity = (left = {}, right = {}) => {
  const leftKeys = new Set(messageIdentityKeys(left));
  return messageIdentityKeys(right).some((key) => leftKeys.has(key));
};

const mergeMessagesByIdentity = (messages = []) => {
  const merged = [];
  for (const raw of asArray(messages)) {
    const normalized = normalizeInboxMessage(raw);
    const existingIndex = merged.findIndex((item) => messagesShareIdentity(item, normalized));
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...normalized,
      };
    } else {
      merged.push(normalized);
    }
  }
  return merged;
};

const conversationIdentifiers = (conversation = {}) => {
  const channel = conversation.channel || conversation.source || conversation.provider || conversation.platform || "";
  const sessionId = normalizeConversationSessionId(
    conversation.session_id || conversation.external_conversation_id || conversation.id || conversation.conversation_id,
    channel
  );
  const fallbackId = clean(conversation.session_id || conversation.external_conversation_id || conversation.id || conversation.conversation_id);
  const conversationId = normalizeConversationSessionId(conversation.id || conversation.conversation_id || sessionId, channel);
  const conversationKey = normalizeConversationSessionId(conversation.conversation_key || conversation.id || sessionId || fallbackId, channel);
  const rawSessionId = stripConversationPrefixes(sessionId).value || fallbackId;
  return {
    channel,
    sessionId,
    conversationId,
    conversationKey,
    rawSessionId,
  };
};

const normalizeConversationChannel = (conversation = {}) => {
  const stored = clean(
    conversation.channel ||
      conversation.source ||
      conversation.provider ||
      conversation.platform ||
      ""
  ).toLowerCase();
  // A stored "web_chat" is the column default, not an assertion — see
  // server/utils/inboxChannelIdentity.js. Repair it from the channel prefix the
  // ingest path stamped into the session id, so a row that predates the server
  // fix (including one replayed from the IndexedDB cache) still renders under
  // its real channel.
  const raw = WEAK_CONVERSATION_CHANNELS.has(stored)
    ? channelFromConversationSessionId(conversation) || stored
    : stored;
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("telegram")) return "telegram";
  if (raw.includes("instagram_comment")) return "instagram_comment";
  if (raw.includes("facebook_comment")) return "facebook_comment";
  if (raw.includes("instagram")) return "instagram";
  if (raw.includes("facebook") || raw.includes("messenger")) return "messenger";
  if (raw.includes("web")) return "web";
  return raw || "unknown";
};

const conversationKey = (conversation = {}) => conversationIdentifiers(conversation).conversationKey;

const normalizeMessageProductCards = (message = {}) =>
  normalizeProductCardsValue(
    message.product_cards ||
      message.productCards ||
      message.suggested_products ||
      message.suggestedProducts ||
      []
  );

const isProductCardMessage = (message = {}) => {
  const messageType = clean(message.message_type || message.messageType || "").toLowerCase();
  return messageType === "product_card" || messageType === "product_cards" || normalizeMessageProductCards(message).length > 0;
};

const messageDisplayText = (message = {}) => {
  const candidates = [
    message.customer_message,
    message.ai_answer,
    message.staff_message,
    message.message_text,
    message.text,
    message.body,
    message.content,
    message.reply_text,
    message.caption,
  ];
  for (const value of candidates) {
    const text = cleanMessageText(value);
    if (text) return text;
  }
  return "";
};

const normalizeMessageDirection = (message = {}) => {
  const senderType = clean(message.sender_type || message.senderType || "").toLowerCase();
  const explicitDirection = clean(message.direction || message.message_direction || "").toLowerCase();
  if (isFromMeMessage(message)) return "outbound";
  if (["inbound", "incoming", "customer", "user", "client"].includes(explicitDirection)) return "inbound";
  if (["outbound", "sent", "assistant", "ai", "bot", "staff", "agent"].includes(explicitDirection)) return "outbound";
  if (["customer", "user", "client"].includes(senderType)) return "inbound";
  if (["assistant", "ai", "bot", "staff", "agent"].includes(senderType)) return "outbound";
  if (normalizeMessageProductCards(message).length) return "outbound";
  if (messageDisplayText(message)) return "outbound";
  return "";
};

const normalizeInboxMessage = (message = {}) => {
  if (!message || typeof message !== "object") return {};
  const productCards = normalizeMessageProductCards(message);
  const providerMessageId = clean(
    message.provider_message_id ||
      message.providerMessageId ||
      message.external_message_id ||
      message.externalMessageId ||
      message.message_id ||
      message.messageId ||
      message.meta_mid ||
      message.id ||
      ""
  );
  const senderType = clean(message.sender_type || message.senderType || "");
  const direction = normalizeMessageDirection(message);
  const fromMe = isFromMeMessage(message);
  const body = messageDisplayText(message);
  const normalizedSenderType = senderType || (fromMe || direction === "outbound" ? "assistant" : "customer");
  const isStaffSender = ["staff", "agent", "human"].includes(normalizedSenderType.toLowerCase());
  const resolvedFromMe = fromMe || direction === "outbound";
  const normalizedMessageType =
    clean(message.message_type || message.messageType || "") ||
    (productCards.length ? "product_card" : direction === "outbound" ? "ai_reply" : "customer_message");
  const providerMessageKey = clean(
    message.message_identity_key ||
      message.messageIdentityKey ||
      message.idempotency_key ||
      message.idempotencyKey ||
      message.client_request_id ||
      message.clientRequestId ||
      message.provider_message_id ||
      message.providerMessageId ||
      message.external_message_id ||
      message.externalMessageId ||
      message.id ||
      ""
  );

  return {
    ...message,
    direction: direction || message.direction || message.message_direction || "",
    sender_type: normalizedSenderType,
    senderType: normalizedSenderType,
    message_type: normalizedMessageType,
    messageType: normalizedMessageType,
    provider_message_id: providerMessageId,
    providerMessageId,
    external_message_id: clean(message.external_message_id || providerMessageId),
    externalMessageId: clean(message.externalMessageId || providerMessageId),
    message_identity_key: clean(message.message_identity_key || message.messageIdentityKey || message.idempotency_key || message.idempotencyKey || providerMessageKey),
    messageIdentityKey: clean(message.messageIdentityKey || message.message_identity_key || providerMessageKey),
    client_request_id: clean(message.client_request_id || message.clientRequestId || ""),
    clientRequestId: clean(message.clientRequestId || message.client_request_id || ""),
    idempotency_key: clean(message.idempotency_key || message.idempotencyKey || message.message_identity_key || message.messageIdentityKey || ""),
    text: cleanMessageText(message.text) || body,
    body: cleanMessageText(message.body) || body,
    content: cleanMessageText(message.content) || body,
    message_text: cleanMessageText(message.message_text) || body,
    from_me: resolvedFromMe,
    fromMe: resolvedFromMe,
    customer_message: resolvedFromMe ? "" : cleanMessageText(message.customer_message) || (direction === "inbound" ? body : ""),
    ai_answer: cleanMessageText(message.ai_answer) || ((!isStaffSender && resolvedFromMe) && normalizedMessageType !== "product_card" ? body : ""),
    staff_message: cleanMessageText(message.staff_message) || (normalizedSenderType === "staff" ? body : ""),
    product_cards: productCards,
    productCards,
  };
};

const conversationWorkflowStatus = (conversation = {}) =>
  clean(conversation?.conversation_status || conversation?.status || "").toLowerCase();

const needsHumanAttention = (conversation = {}) =>
  conversation?.human_takeover === true ||
  conversation?.ai_paused === true ||
  conversation?.conversation_status === "human_takeover" ||
  conversation?.needs_human_support === true ||
  Boolean(clean(conversation?.escalation_reason || conversation?.ai_escalation_reason));

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

const DEBUG_SOCIAL_COMMENTS =
  import.meta.env.DEV ||
  ["1", "true", "yes", "on"].includes(String(import.meta.env.VITE_AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || import.meta.env.VITE_AI_SUPPORT_DEBUG || "").toLowerCase());

const getMessagePlatform = (item = {}) => {
  if (isSocialCommentThread(item)) return "";
  const source = clean(item?.channel || item?.source || item?.provider || item?.platform || item?.source_platform || "").toLowerCase();
  if (source.includes("facebook_messenger") || source.includes("messenger")) return "messenger";
  if (source.includes("instagram_dm") || source.includes("instagram")) return "instagram";
  if (source.includes("whatsapp")) return "whatsapp";
  if (source.includes("telegram")) return "telegram";
  if (source.includes("web") || source.includes("website")) return "web";
  if (source.includes("tiktok_dm") || source.includes("tiktok")) return "tiktok";
  return "web";
};

const matchesMessagePlatform = (item = {}, activeMessagePlatformFilter = "all") => {
  if (activeMessagePlatformFilter === "all") return true;
  if (isSocialCommentThread(item)) return false;
  return getMessagePlatform(item) === activeMessagePlatformFilter;
};

const getInboxItemKind = (item = {}) => (isSocialCommentThread(item) ? "comment" : "message");

const MESSAGE_PLATFORM_FILTERS = [
  { key: "all", labelKey: "aiSupport.inbox.pwa.allMessages" },
  { key: "messenger", labelKey: "aiSupport.inbox.pwa.messenger" },
  { key: "instagram", labelKey: "aiSupport.inbox.pwa.instagram" },
  { key: "telegram", labelKey: "aiSupport.inbox.pwa.telegram" },
  { key: "whatsapp", labelKey: "aiSupport.inbox.pwa.whatsapp" },
  { key: "web", labelKey: "aiSupport.inbox.pwa.web" },
  { key: "tiktok", labelKey: "aiSupport.inbox.pwa.tiktok" },
];

const latestCommentMessage = (conversation = {}) =>
  [...uniqueMessages(conversation?.messages || [])].reverse().find((message) =>
    clean(message?.message_type).toLowerCase() === "comment_inbound" ||
    clean(message?.thread_kind).toLowerCase() === "comment" ||
    clean(message?.commenter_name)
  ) || conversation?.latest_comment || conversation?.last_comment || conversation?.comment || {};

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

const getConversationSourceLabel = (item = {}, translate = (key) => key) => {
  const { channelMetadata, metadata } = getConversationThreadMetadata(item);
  const platform = clean(item?.platform || item?.source_platform || item?.channel || item?.source || channelMetadata.platform || metadata.platform || "").toLowerCase();
  if (isSocialCommentThread(item)) {
    if (platform.includes("instagram")) return translate("aiSupport.inbox.pwa.instagramComment");
    if (platform.includes("facebook")) return translate("aiSupport.inbox.pwa.facebookComment");
    return translate("aiSupport.inbox.pwa.comment");
  }
  return translate(channelMeta(item?.channel || item?.source || item?.provider || item?.platform || "").labelKey);
};

const getConversationSourceIcon = (item = {}) => {
  const meta = channelMeta(item?.channel || item?.source || item?.provider || item?.platform || "");
  return isSocialCommentThread(item) ? MessageSquareText : meta.icon;
};

const commentThreadPostUrl = (conversation = {}) =>
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
    conversation?.post_url
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
    conversation?.last_message
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
    conversation?.real_comment_created_time,
    conversation?.comment_created_time,
    conversation?.latest_comment?.created_time,
    conversation?.last_comment?.created_time,
    conversation?.channel_metadata?.real_comment_created_time,
    conversation?.metadata?.real_comment_created_time,
    conversation?.channel_metadata?.comment_created_time,
    conversation?.metadata?.comment_created_time
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

const buildLeadPrivateMessageText = (conversation = {}, comment = {}) => {
  const name = clean(comment?.commenter_name || conversationName(conversation));
  return `مرحباً${name ? ` ${name}` : ""}، أرسلت لك التفاصيل في الخاص.`;
};

const buildLeadCommentReplyText = (conversation = {}, comment = {}) => {
  const name = clean(comment?.commenter_name || conversationName(conversation));
  return `شكراً${name ? ` ${name}` : ""}، أرسلنا لك التفاصيل في الخاص.`;
};

const LEAD_STATUS_META = {
  new: { labelKey: "aiSupport.inbox.action.statusNew", tone: "blue" },
  contacted: { labelKey: "aiSupport.inbox.action.contacted", tone: "amber" },
  interested: { labelKey: "aiSupport.inbox.action.interested", tone: "emerald" },
  won: { labelKey: "aiSupport.inbox.action.won", tone: "emerald" },
};

const LEAD_STATUS_ORDER = ["new", "contacted", "interested", "won"];

const normalizeLeadStatus = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "negotiation" || key === "follow_up" || key === "followup") return "interested";
  if (key === "lost" || key === "closed") return "new";
  return Object.prototype.hasOwnProperty.call(LEAD_STATUS_META, key) ? key : "new";
};

const leadStatusLabel = (value = "", translate = (key) => key) => translate(LEAD_STATUS_META[normalizeLeadStatus(value)]?.labelKey || "aiSupport.inbox.action.statusNew");
const leadStatusTone = (value = "") => LEAD_STATUS_META[normalizeLeadStatus(value)]?.tone || "blue";

const conversationLeadStatus = (conversation = {}) =>
  normalizeLeadStatus(
    conversation?.lead_status ||
      conversation?.channel_metadata?.lead_status ||
      conversation?.metadata?.lead_status ||
      ""
  );

const conversationLeadBucket = (conversation = {}) => {
  const status = conversationLeadStatus(conversation);
  if (status === "won") return "won";
  if (status === "contacted") return "contacted";
  if (status === "interested") return "interested";
  return "new";
};

const conversationUnreadCount = (conversation = {}) =>
  Number(
    conversation.unread_count ??
      conversation.unseen_count ??
      conversation.pending_count ??
      conversation.unread ??
      0
  ) || 0;

const relativeTime = (value, language = "en") => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  const formatter = new Intl.RelativeTimeFormat(language === "ar" ? "ar" : "en", { numeric: "auto", style: "narrow" });
  if (diffMinutes < 1) return formatter.format(0, "minute");
  if (diffMinutes < 60) return formatter.format(-diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return formatter.format(-diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(-diffDays, "day");
};

function getPwaCardTimeValue(conversation) {
  if (isSocialCommentThread(conversation) || getInboxItemKind(conversation) === "comment") {
    return (
      conversation?.channel_metadata?.post_created_time ||
      conversation?.metadata?.post_created_time ||
      conversation?.post_created_time ||
      conversation?.real_comment_created_time ||
      conversation?.comment_created_time ||
      conversation?.latest_comment?.created_time ||
      conversation?.last_comment?.created_time ||
      conversation?.metadata?.real_comment_created_time ||
      conversation?.metadata?.comment_created_time ||
      null
    );
  }

  return (
    conversation?.last_activity_at ||
    conversation?.last_message_at ||
    conversation?.updated_at ||
    conversation?.created_at ||
    null
  );
}

function renderPwaCardTime(conversation, language = "en") {
  const value = getPwaCardTimeValue(conversation);

  if (isSocialCommentThread(conversation) || getInboxItemKind(conversation) === "comment") {
    if (import.meta.env.DEV) {
      console.log("AI_POST_TIME_RENDER", {
        post_id: conversation?.post_id,
        comment_id: conversation?.comment_id,
        post_created_time: conversation?.post_created_time || conversation?.channel_metadata?.post_created_time || conversation?.metadata?.post_created_time || "",
        real_comment_created_time: conversation?.real_comment_created_time || "",
        comment_created_time: conversation?.comment_created_time || "",
        rendered_label: value ? relativeTime(value, language) : "Unknown",
      });
    }
    return value ? relativeTime(value, language) : "Unknown";
  }

  return relativeTime(value, language);
}

const relativeSeenLabel = (value, language = "en", translate = (key) => key) => {
  const label = relativeTime(value, language);
  return label ? translate("aiSupport.inbox.pwa.lastSeen", { time: label }) : translate("aiSupport.inbox.pwa.noRecentActivity");
};

const absoluteTime = (value) => {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const messageKey = (message = {}) =>
  String(
    message.message_identity_key ||
      message.messageIdentityKey ||
      message.provider_message_id ||
      message.providerMessageId ||
      message.external_message_id ||
      message.externalMessageId ||
      message.id ||
      `${message.sender_type || message.senderType || ""}:${message.direction || message.message_direction || ""}:${message.created_at || ""}:${message.customer_message || message.ai_answer || message.staff_message || message.message_text || message.text || message.body || message.content || ""}:${normalizeMessageProductCards(message).map((card) => [
        card.product_id || card.id || "",
        card.variant_id || card.variantId || "",
        card.color || "",
        card.size || "",
        card.image_url || "",
      ].join("|")).join(";")}`
  );

const uniqueMessages = (messages = []) => {
  return mergeMessagesByIdentity(messages);
};

const isHiddenAiReplyDraftMessage = (message = {}) => {
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

const conversationSortValue = (conversation = {}) =>
  new Date(
    conversation.last_message_at ||
      conversation.last_activity_at ||
      conversation.updated_at ||
      conversation.created_at ||
      0
  ).getTime() || 0;

const sortConversationsByActivity = (items = []) =>
  [...asArray(items)].sort((left, right) => conversationSortValue(right) - conversationSortValue(left));

const conversationMatchesIdentifiers = (conversation = {}, identifiers = {}) => {
  const conversationIds = conversationIdentifiers(conversation);
  const candidates = new Set(
    [
      conversationIds.sessionId,
      conversationIds.conversationKey,
      conversationIds.conversationId,
      conversationIds.rawSessionId,
      encodeConversationId(conversationIds.sessionId),
      clean(conversationIds.sessionId),
      clean(conversationIds.conversationKey),
    ]
      .map((value) => clean(value))
      .filter(Boolean)
  );
  const targets = [
    identifiers.sessionId,
    identifiers.rawSessionId,
    identifiers.conversationKey,
    identifiers.conversationId,
    clean(identifiers.sessionId),
    clean(identifiers.rawSessionId),
    clean(identifiers.conversationKey),
    clean(identifiers.conversationId),
    encodeConversationId(identifiers.sessionId || ""),
  ]
    .map((value) => clean(value))
    .filter(Boolean);
  return targets.some((target) => candidates.has(target));
};

const conversationHydrationState = (conversation = {}) => {
  if (conversation?.conversationHydrated != null) return Boolean(conversation.conversationHydrated);
  if (conversation?.hydrated != null) return Boolean(conversation.hydrated);
  const messages = uniqueMessages(conversation.messages);
  return messages.length > 1 || conversation.older_messages_available === false;
};

const normalizedSocialPlatform = (item = {}) => {
  const value = clean(
    item.platform ||
      item.source_platform ||
      item.channel ||
      item.source ||
      item.metadata?.platform ||
      item.channel_metadata?.platform ||
      ""
  ).toLowerCase();
  if (value.includes("instagram")) return "instagram";
  if (value.includes("facebook")) return "facebook";
  return value;
};

const socialPostMatchesFilter = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  const platform = normalizedSocialPlatform(item);
  if (filter === "facebook") return platform === "facebook";
  if (filter === "instagram") return platform === "instagram";
  if (!isSocialPostSummary(item)) return false;
  if (filter === "needs_human" || filter === "needs_reply") return Number(item.new_comments_count || 0) > 0 || clean(item.reply_status || item.auto_reply_mode).toLowerCase() !== "sent";
  if (filter === "ai_replied" || filter === "replied") return clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent";
  if (filter === "unread") return Number(item.new_comments_count || 0) > 0;
  if (filter === "auto_reply_on") return Boolean(item.auto_reply_enabled || item.template_enabled || item.generic_enabled);
  return true;
};

const socialPostSortValue = (item = {}) =>
  new Date(
    item.display_created_at ||
      item.displayCreatedAt ||
      item.post_created_time ||
      item.postCreatedTime ||
      item.published_at ||
      item.publishedAt ||
      item.created_time ||
      item.created_at ||
      item.real_comment_created_time ||
      item.last_activity_at ||
      item.last_comment_at ||
      item.updated_at ||
      0
  ).getTime() || 0;

const normalizeFastSocialCommentItem = (item = {}) => {
  const messagePreview = clean(item?.message_preview || "");
  const activityAt = clean(item?.last_activity_at || item?.created_at || item?.updated_at || "");
  const status = clean(item?.status || "");
  const automationStatus = clean(item?.automation_status || "");
  const unread =
    item?.unread != null
      ? Boolean(item.unread)
      : !["sent", "delivered", "ignored", "processed", "closed", "resolved"].includes(status.toLowerCase()) &&
        !["sent", "delivered"].includes(automationStatus.toLowerCase());
  const postId = clean(item?.post_id || "");
  const externalCommentId = clean(item?.external_comment_id || "");
  return {
    ...item,
    id: clean(item?.id || externalCommentId || postId || ""),
    conversation_id: clean(item?.conversation_id || postId || ""),
    session_id: clean(item?.session_id || postId || ""),
    post_id: postId,
    external_comment_id: externalCommentId,
    comment_id: clean(item?.comment_id || externalCommentId || item?.id || ""),
    customer_name: isGenericCustomerName(item?.customer_name) ? "" : clean(item?.customer_name),
    customer_avatar_url: clean(item?.customer_avatar_url || ""),
    message_preview: messagePreview,
    comments_count: Math.max(0, Number(item?.comments_count ?? item?.comment_count ?? item?.total_comments ?? 0) || 0),
    new_comments_count: Number(item?.new_comments_count ?? (unread ? 1 : 0)) || 0,
    last_comment_text: clean(item?.last_comment_text || messagePreview),
    last_comment_at: clean(item?.last_comment_at || activityAt),
    last_commenter_name: [item?.last_commenter_name, item?.customer_name].map((value) => clean(value)).find((value) => value && !isGenericCustomerName(value)) || "",
    last_commenter_id: clean(item?.last_commenter_id || externalCommentId || item?.comment_id || item?.id || ""),
    post_created_time: clean(
      item?.post_created_time ||
        item?.channel_metadata?.post_created_time ||
        item?.metadata?.post_created_time ||
        item?.metadata?.post?.created_time ||
        item?.raw_payload?.post_created_time ||
        item?.raw_payload?.metadata?.post_created_time ||
        item?.raw_payload?.value?.post_created_time ||
        item?.raw_payload?.value?.post?.created_time ||
        ""
    ),
    real_comment_created_time: clean(item?.real_comment_created_time || activityAt),
    reply_status: clean(item?.reply_status || status || automationStatus || ""),
    auto_reply_mode: clean(item?.auto_reply_mode || automationStatus || ""),
    automation_status: automationStatus || status,
    status: status || automationStatus || "pending",
    unread,
    post_caption: clean(item?.post_caption || messagePreview),
    post_message: clean(item?.post_message || messagePreview),
    thumbnail_url: commentThreadPostImageUrl(item),
    permalink_url: clean(item?.permalink_url || ""),
    platform: clean(item?.platform || "facebook").toLowerCase(),
  };
};

const normalizeSocialPostForPwa = (rawItem = {}) => {
  const display = normalizeSocialPostDisplay(rawItem);
  const raw = display?.raw && typeof display.raw === "object" ? display.raw : rawItem;
  const metadata = raw?.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const displayImage = clean(display?.displayImage || display?.thumbnailUrl || commentThreadPostImageUrl(raw));
  const displayText = clean(display?.displayText || display?.caption || raw?.post_message || raw?.post_caption || "");
  const displayCreatedAt = clean(
    display?.displayCreatedAt ||
      display?.publishedAt ||
      raw?.post_created_time ||
      raw?.published_at ||
      raw?.created_time ||
      raw?.created_at ||
      metadata?.post_created_time ||
      ""
  );

  return normalizeFastSocialCommentItem({
    ...raw,
    id: clean(display?.id || raw?.id || display?.postId || raw?.post_id || ""),
    post_id: clean(display?.postId || raw?.post_id || raw?.id || ""),
    platform: clean(display?.platform || raw?.platform || metadata?.platform || "facebook").toLowerCase(),
    post_message: displayText,
    post_caption: displayText,
    thumbnail_url: displayImage,
    post_image_url: displayImage,
    comments_count: Math.max(0, Number(display?.displayCommentCount ?? display?.commentsCount ?? raw?.comments_count ?? 0) || 0),
    new_comments_count: Math.max(0, Number(display?.newCount ?? raw?.new_comments_count ?? 0) || 0),
    post_created_time: displayCreatedAt,
    published_at: displayCreatedAt,
    permalink_url: clean(display?.displayPermalink || display?.permalinkUrl || raw?.permalink_url || raw?.post_permalink_url || ""),
    media_type: clean(raw?.media_type || raw?.post_type || raw?.type || metadata?.media_type || metadata?.post_type || ""),
    video_url: clean(raw?.video_url || raw?.source_url || metadata?.video_url || metadata?.source_url || ""),
  });
};

const groupSocialCommentPosts = (items = []) => {
  const groups = new Map();

  asArray(items).forEach((rawItem) => {
    const item = normalizeFastSocialCommentItem(rawItem);
    const platform = clean(item.platform || "facebook").toLowerCase();
    const postId = clean(item.post_id || item.conversation_id || item.id || "");
    if (!postId) return;
    const key = `${platform}:${postId}`;
    const current = groups.get(key);
    const imageUrl = commentThreadPostImageUrl(item);

    if (!current) {
      groups.set(key, {
        ...item,
        thumbnail_url: imageUrl,
        _groupedItemCount: 1,
        _groupedUnreadCount: item.unread ? 1 : 0,
      });
      return;
    }

    const currentActivity = socialPostSortValue(current);
    const nextActivity = socialPostSortValue(item);
    const newest = nextActivity > currentActivity ? item : current;
    groups.set(key, {
      ...current,
      ...newest,
      post_id: postId,
      platform,
      thumbnail_url: commentThreadPostImageUrl(newest) || current.thumbnail_url || imageUrl,
      post_caption: clean(newest.post_caption || current.post_caption || item.post_caption || ""),
      post_message: clean(newest.post_message || current.post_message || item.post_message || ""),
      comments_count: Math.max(
        Number(current.comments_count || 0),
        Number(item.comments_count || 0),
        Number(current._groupedItemCount || 1) + 1
      ),
      new_comments_count: Math.max(
        Number(current.new_comments_count || 0),
        Number(item.new_comments_count || 0),
        Number(current._groupedUnreadCount || 0) + (item.unread ? 1 : 0)
      ),
      _groupedItemCount: Number(current._groupedItemCount || 1) + 1,
      _groupedUnreadCount: Number(current._groupedUnreadCount || 0) + (item.unread ? 1 : 0),
    });
  });

  return [...groups.values()].map(({ _groupedItemCount, _groupedUnreadCount, ...post }) => post);
};

const fastSocialCommentItemMatches = (left = {}, right = {}) => {
  const leftIds = [
    left?.id,
    left?.comment_id,
    left?.external_comment_id,
    left?.provider_comment_id,
    left?.post_id,
  ].map((value) => clean(value)).filter(Boolean);
  const rightIds = [
    right?.id,
    right?.comment_id,
    right?.external_comment_id,
    right?.provider_comment_id,
    right?.post_id,
  ].map((value) => clean(value)).filter(Boolean);
  if (!leftIds.length || !rightIds.length) return false;
  return leftIds.some((value) => rightIds.includes(value));
};

const mergeFastSocialCommentItem = (current = {}, patch = {}) => {
  const merged = normalizeFastSocialCommentItem({
    ...current,
    ...patch,
    comments_count: patch.comments_count ?? current.comments_count,
    new_comments_count: patch.new_comments_count ?? current.new_comments_count,
    last_comment_text: patch.last_comment_text || patch.message_preview || current.last_comment_text || current.message_preview || "",
    last_comment_at: patch.last_comment_at || patch.last_activity_at || current.last_comment_at || current.last_activity_at || "",
    last_commenter_name: patch.last_commenter_name || patch.customer_name || current.last_commenter_name || current.customer_name || "",
    last_commenter_id: patch.last_commenter_id || patch.external_comment_id || current.last_commenter_id || current.external_comment_id || "",
    post_created_time: patch.post_created_time || current.post_created_time || patch.channel_metadata?.post_created_time || patch.metadata?.post_created_time || "",
    real_comment_created_time: patch.real_comment_created_time || patch.last_activity_at || current.real_comment_created_time || current.last_activity_at || "",
    unread: patch.unread ?? current.unread,
    status: patch.status || current.status || "",
    automation_status: patch.automation_status || current.automation_status || "",
    reply_status: patch.reply_status || current.reply_status || "",
    auto_reply_mode: patch.auto_reply_mode || current.auto_reply_mode || "",
  });
  return {
    ...current,
    ...merged,
    comments_count: Number(merged.comments_count ?? current.comments_count ?? 1) || 1,
    new_comments_count: Number(merged.new_comments_count ?? current.new_comments_count ?? 0) || 0,
    unread: patch.unread != null ? Boolean(patch.unread) : Boolean(merged.unread),
  };
};

const fastSocialCommentItemsEqual = (left = {}, right = {}) =>
  clean(left.id) === clean(right.id) &&
  clean(left.post_id) === clean(right.post_id) &&
  clean(left.external_comment_id) === clean(right.external_comment_id) &&
  clean(left.customer_name) === clean(right.customer_name) &&
  clean(left.customer_avatar_url) === clean(right.customer_avatar_url) &&
  clean(left.message_preview) === clean(right.message_preview) &&
  clean(left.last_activity_at) === clean(right.last_activity_at) &&
  clean(left.status) === clean(right.status) &&
  clean(left.reply_status) === clean(right.reply_status) &&
  clean(left.auto_reply_mode) === clean(right.auto_reply_mode) &&
  clean(left.session_status) === clean(right.session_status) &&
  clean(left.replyStatus) === clean(right.replyStatus) &&
  clean(left.autoReplyMode) === clean(right.autoReplyMode) &&
  clean(left.sessionStatus) === clean(right.sessionStatus) &&
  clean(left.public_reply_status) === clean(right.public_reply_status) &&
  clean(left.dm_status) === clean(right.dm_status) &&
  clean(left.like_status) === clean(right.like_status) &&
  clean(left.automation_status) === clean(right.automation_status) &&
  clean(left.product_id) === clean(right.product_id) &&
  clean(left.product_name) === clean(right.product_name) &&
  Boolean(left.unread) === Boolean(right.unread);

const mergeConversationSummaryRefresh = (currentConversation = {}, nextConversation = {}) => {
  if (!currentConversation) return nextConversation;

  const currentMessages = asArray(currentConversation.messages);
  const nextMessages = asArray(nextConversation.messages);
  const nextUnreadCount = nextConversation.unread_count ?? nextConversation.unseen_count ?? nextConversation.pending_count ?? currentConversation.unread_count ?? currentConversation.unseen_count ?? currentConversation.pending_count ?? 0;
  const nextPreview =
    nextConversation.latest_message_preview ??
    nextConversation.last_message_preview ??
    currentConversation.latest_message_preview ??
    currentConversation.last_message_preview ??
    "";
  const nextLastMessageAt = nextConversation.last_message_at ?? currentConversation.last_message_at ?? "";
  const nextLastActivityAt = nextConversation.last_activity_at ?? currentConversation.last_activity_at ?? "";
  const nextUpdatedAt = nextConversation.updated_at ?? currentConversation.updated_at ?? "";
  const nextStatus = nextConversation.conversation_status ?? nextConversation.status ?? currentConversation.conversation_status ?? currentConversation.status ?? "";
  const nextMessageCount = Math.max(
    Number(currentConversation.message_count || 0),
    Number(nextConversation.message_count || 0),
    currentMessages.length,
    nextMessages.length
  );
  const currentIdentityName = clean(currentConversation.customer_name || currentConversation.customer_profile?.name || "");
  const refreshedIdentityName = clean(nextConversation.customer_name || nextConversation.customer_profile?.name || "");
  const isUsefulIdentityName = (value = "") => {
    const candidate = clean(value);
    if (!candidate || /^\+?[\d\s()-]+$/.test(candidate)) return false;
    return !["customer", "whatsapp customer", "عميل", "مستخدم واتساب"].includes(candidate.toLowerCase());
  };
  const stableCustomerName = isUsefulIdentityName(refreshedIdentityName)
    ? refreshedIdentityName
    : isUsefulIdentityName(currentIdentityName)
      ? currentIdentityName
      : refreshedIdentityName || currentIdentityName;
  const stableCustomerAvatarUrl = clean(
    nextConversation.customer_avatar_url ||
    nextConversation.customer_profile?.avatar_url ||
    nextConversation.channel_metadata?.customer_avatar_url ||
    currentConversation.customer_avatar_url ||
    currentConversation.customer_profile?.avatar_url ||
    currentConversation.channel_metadata?.customer_avatar_url ||
    ""
  );

  return {
    ...currentConversation,
    ...nextConversation,
    customer_name: stableCustomerName,
    customer_avatar_url: stableCustomerAvatarUrl,
    unread_count: nextUnreadCount,
    unseen_count: nextConversation.unseen_count ?? currentConversation.unseen_count ?? nextUnreadCount,
    pending_count: nextConversation.pending_count ?? currentConversation.pending_count ?? nextUnreadCount,
    unread: nextUnreadCount > 0,
    latest_message_preview: nextPreview,
    last_message_preview: nextConversation.last_message_preview ?? nextPreview,
    last_message_at: nextLastMessageAt,
    last_activity_at: nextLastActivityAt,
    updated_at: nextUpdatedAt,
    status: nextStatus,
    conversation_status: nextStatus,
    message_count: nextMessageCount,
    channel_metadata: {
      ...(currentConversation.channel_metadata || {}),
      ...(nextConversation.channel_metadata || {}),
      ...(stableCustomerAvatarUrl ? { customer_avatar_url: stableCustomerAvatarUrl } : {}),
      last_message: nextConversation.channel_metadata?.last_message ?? currentConversation.channel_metadata?.last_message ?? nextPreview,
      unread_count: nextConversation.channel_metadata?.unread_count ?? currentConversation.channel_metadata?.unread_count ?? nextUnreadCount,
      pending_count: nextConversation.channel_metadata?.pending_count ?? currentConversation.channel_metadata?.pending_count ?? nextUnreadCount,
      unseen_count: nextConversation.channel_metadata?.unseen_count ?? currentConversation.channel_metadata?.unseen_count ?? nextUnreadCount,
    },
    customer_profile: {
      ...(currentConversation.customer_profile || {}),
      ...(nextConversation.customer_profile || {}),
      ...(stableCustomerName ? { name: stableCustomerName } : {}),
      ...(stableCustomerAvatarUrl ? { avatar_url: stableCustomerAvatarUrl } : {}),
    },
    messages: currentConversation.messages,
    older_messages_available: currentConversation.older_messages_available,
    next_messages_before: currentConversation.next_messages_before,
    next_messages_before_id: currentConversation.next_messages_before_id,
    conversationHydrated: currentConversation.conversationHydrated,
  };
};

const normalizeRealtimeConversationKeys = (payload = {}) => {
  const message = normalizeInboxMessage(payload.message || payload);
  const channel = normalizeConversationChannel(payload.message || payload.conversation || payload);
  const sessionId = normalizeConversationSessionId(
    payload.session_id ||
      payload.sessionId ||
      payload.conversation_id ||
      payload.conversationId ||
      message.session_id ||
      message.sessionId ||
      message.conversation_id ||
      message.conversationId ||
      message.conversation_key ||
      message.conversationKey ||
      message.external_conversation_id ||
      message.externalConversationId ||
      "",
    channel
  );
  const rawSessionId = stripConversationPrefixes(sessionId).value || clean(
    payload.session_id ||
      payload.sessionId ||
      payload.conversation_id ||
      payload.conversationId ||
      message.session_id ||
      message.sessionId ||
      message.conversation_id ||
      message.conversationId ||
      message.conversation_key ||
      message.conversationKey ||
      message.external_conversation_id ||
      message.externalConversationId ||
      ""
  );
  const conversationKey = normalizeConversationSessionId(
    payload.conversation_key ||
      payload.conversationKey ||
      message.conversation_key ||
      message.conversationKey ||
      sessionId,
    channel
  );
  const tenantId = clean(payload.tenant_id || payload.tenantId || message.tenant_id || message.tenantId || "");
  return {
    message,
    channel,
    sessionId,
    rawSessionId,
    conversationKey,
    tenantId,
  };
};

const conversationMatchesRealtimeKeys = (conversation = {}, keys = {}) => {
  const identifiers = conversationIdentifiers(conversation);
  const candidates = new Set(
    [
      identifiers.sessionId,
      identifiers.conversationKey,
      identifiers.conversationId,
      identifiers.rawSessionId,
      encodeConversationId(identifiers.sessionId),
      clean(identifiers.sessionId),
      clean(identifiers.conversationKey),
    ]
      .map((value) => clean(value))
      .filter(Boolean)
  );
  const targets = [
    keys.sessionId,
    keys.rawSessionId,
    keys.conversationKey,
    keys.conversationId,
    keys.messageId,
    keys.providerMessageId,
    keys.externalMessageId,
    clean(keys.sessionId),
    clean(keys.rawSessionId),
    clean(keys.conversationKey),
    clean(keys.conversationId),
    encodeConversationId(keys.sessionId || ""),
  ]
    .map((value) => clean(value))
    .filter(Boolean);
  return targets.some((target) => candidates.has(target));
};

const channelMeta = (value = "") => {
  const key = normalizeConversationChannel({ channel: value });
  if (key === "whatsapp") return { labelKey: "aiSupport.inbox.pwa.whatsapp", icon: FaWhatsapp, tone: "text-emerald-600" };
  if (key === "telegram") return { labelKey: "aiSupport.inbox.pwa.telegram", icon: FaTelegramPlane, tone: "text-sky-500" };
  if (key === "instagram" || key === "instagram_comment") return { labelKey: key === "instagram" ? "aiSupport.inbox.pwa.instagramDm" : "aiSupport.inbox.pwa.instagram", icon: FaInstagram, tone: "text-rose-500" };
  if (key === "messenger" || key === "facebook_comment") return { labelKey: "aiSupport.inbox.pwa.messenger", icon: FaFacebookMessenger, tone: "text-blue-600" };
  return { labelKey: "aiSupport.inbox.pwa.web", icon: Globe, tone: "text-slate-500" };
};

// Instagram Direct conversation (not a comment thread). Used to keep the raw
// Instagram-scoped user id out of the displayed name and to pick a safe label.
const isInstagramDmConversation = (conversation = {}) => {
  const channel = normalizeConversationChannel(conversation);
  const source = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform).toLowerCase();
  if (channel === "instagram_comment" || source.includes("_comment")) return false;
  return channel === "instagram" || source === "instagram" || source.includes("instagram_dm") || source.includes("instagram");
};

const conversationName = (conversation = {}) =>
  (() => {
    const profile = conversation.customer_profile || {};
    const channelMetadata = conversation.channel_metadata || {};
    const metadata = conversation.metadata || {};
    const memory = channelMetadata.ai_memory || metadata.ai_memory || {};
    const messengerProfile = conversation.channel_metadata?.messenger_profile || conversation.channel_metadata?.customer_profile || conversation.customer_profile?.messenger_profile || {};
    const candidates = [
      profile.name,
      profile.display_name,
      profile.facebook_name,
      profile.messenger_name,
      profile.full_name,
      profile.sender_name,
      profile.profile_name,
      profile.contact_name,
      [profile.first_name, profile.last_name].filter(Boolean).join(" "),
      messengerProfile.name,
      messengerProfile.display_name,
      messengerProfile.facebook_name,
      messengerProfile.messenger_name,
      messengerProfile.full_name,
      messengerProfile.sender_name,
      messengerProfile.profile_name,
      messengerProfile.contact_name,
      [messengerProfile.first_name, messengerProfile.last_name].filter(Boolean).join(" "),
      conversation.customer_name,
      conversation.customer?.name,
      conversation.display_name,
      conversation.facebook_name,
      conversation.messenger_name,
      conversation.sender_name,
      conversation.profile_name,
      conversation.contact_name,
      [conversation.first_name, conversation.last_name].filter(Boolean).join(" "),
      conversation.channel_metadata?.commenter_name,
      conversation.metadata?.commenter_name,
      channelMetadata.customer_name,
      channelMetadata.contact_name,
      memory.customer_name,
    ].filter(Boolean);
    candidates.push(
      conversation.external_customer_id,
      conversation.phone,
      conversation.customer_phone,
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
    );
    const resolved = candidates.find((candidate) => {
      const value = clean(candidate);
      if (!value) return false;
      if (isGenericCustomerName(value)) return false;
      // Never let a Messenger/Instagram scoped user id become the display name.
      if ((isMessengerConversation(conversation) || isInstagramDmConversation(conversation)) && isLikelyMessengerExternalId(value)) return false;
      return true;
    });
    // Messenger / Instagram Direct with no real name: @username when Meta gave one,
    // else the tail of the scoped user id — never the full id, never a bare label
    // that makes two nameless customers look identical.
    if (!resolved && (isMessengerConversation(conversation) || isInstagramDmConversation(conversation))) {
      const identity = resolveMetaCustomerIdentity(conversation);
      if (identity.name) return identity.name;
      return isInstagramDmConversation(conversation) ? "مستخدم Instagram" : "مستخدم ماسنجر";
    }
    return clean(resolved || customerIdentifier(
      conversation.external_customer_id,
      conversation.phone,
      conversation.customer_phone,
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
      conversation.session_id,
      conversation.conversation_id,
      conversation.conversation_key,
    ) || "Customer");
  })();

const nestedProductImage = (value) => {
  if (Array.isArray(value)) {
    return value.map(nestedProductImage).find(Boolean) || "";
  }
  if (value && typeof value === "object") {
    return clean(value.image_url || value.url || value.src || value.path || value.secure_url || value.thumbnail_url || "");
  }
  return clean(value);
};

const variantProductImage = (variant = {}) =>
  clean(
    variant?.variant_image_url ||
      variant?.color_image_url ||
      variant?.primary_image_url ||
      variant?.image_url ||
      variant?.thumbnail_url ||
      variant?.image ||
      nestedProductImage(variant?.images) ||
      nestedProductImage(variant?.gallery_images) ||
      ""
  );

const productImage = (card = {}, variant = null) =>
  clean(
    variantProductImage(variant || {}) ||
      card.image_url ||
      card.product_image_url ||
      card.variant_image_url ||
      card.color_image_url ||
      card.image ||
      card.thumbnail_url ||
      nestedProductImage(card.images) ||
      ""
  );

const customerAvatarUrl = (conversation = {}) =>
  clean(
    conversation.customer_avatar_url ||
      conversation.profile_pic_url ||
      conversation.profile_pic ||
      conversation.avatar_url ||
      conversation.customer_profile?.customer_avatar_url ||
      conversation.customer_profile?.avatar_url ||
      conversation.customer_profile?.profile_pic_url ||
      conversation.customer_profile?.profile_pic ||
      conversation.channel_metadata?.profile_pic ||
      conversation.channel_metadata?.messenger_profile?.profile_pic
  );

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
  const latestMessage = [...uniqueMessages(conversation.messages)].reverse().find((message) => messageDisplayText(message));
  return messageDisplayText(latestMessage || {});
};

const productUrl = (card = {}) => {
  const raw = clean(card.product_url || card.storefront_url || card.url || "");
  if (raw) return raw;
  const productId = card.product_id || card.id || "";
  if (!productId) return "";
  return `/shop/product/${encodeURIComponent(productId)}`;
};

const buildProductCardUrl = (product = {}, variant = null, selectedColor = "") => {
  const productId = product.product_id ?? product.id ?? "";
  if (!productId) return "";

  const baseUrl = `/shop/product/${encodeURIComponent(productId)}`;
  const color = clean(selectedColor).toLowerCase();
  const variantId = clean(variant?.id ?? "");
  if (variantId) {
    return color ? `${baseUrl}?variant=${encodeURIComponent(variantId)}&color=${encodeURIComponent(color)}` : `${baseUrl}?variant=${encodeURIComponent(variantId)}`;
  }
  if (color) return `${baseUrl}?color=${encodeURIComponent(color)}`;
  return baseUrl;
};

const productCardPreviewText = (cards = []) => {
  const first = asArray(cards)[0] || {};
  const name = clean(first.product_name || first.name || first.title || "");
  const color = clean(first.color || "");
  const size = clean(first.size || "");
  const price = Number(first.price ?? first.final_price ?? 0);
  return [name, color, size, price > 0 ? money(price) : ""].filter(Boolean).join(" - ");
};

const confirmationStatusMeta = (status = "") => {
  const key = clean(status).toLowerCase();
  if (key === "confirmed") return { labelKey: "aiSupport.inbox.detail.confirmed", tone: "emerald" };
  if (key === "edit_requested") return { labelKey: "aiSupport.inbox.detail.editRequested", tone: "amber" };
  if (key === "cancelled_by_customer") return { labelKey: "aiSupport.inbox.detail.cancelledByCustomer", tone: "rose" };
  if (key === "pending_confirmation") return { labelKey: "aiSupport.inbox.detail.pendingConfirmation", tone: "cyan" };
  return { labelKey: "aiSupport.inbox.pwa.unknown", tone: "zinc" };
};

const buildProductCardPayload = (
  product = {},
  variant = null,
  selectedColor = "",
  selectedSize = "",
  availableSizes = []
) => ({
  product_id: product.product_id ?? product.id ?? null,
  variant_id: clean(selectedSize) ? (variant?.variant_id ?? variant?.id ?? null) : null,
  product_name: clean(product.name || product.product_name || product.title || ""),
  image_url: clean(
    variant?.image_url ||
      variant?.variant_image_url ||
      variant?.image ||
      product.product_image_url ||
      product.image_url ||
      product.image ||
      ""
  ),
  price: Number(
    variant?.price ??
      variant?.final_price ??
      variant?.regular_price ??
      product.final_price ??
      product.price ??
      0
  ) || 0,
  sale_mode_applied: Boolean(variant?.sale_mode_applied || product.sale_mode_applied),
  color: clean(selectedColor || variant?.color || variant?.color_name || ""),
  size: clean(selectedSize),
  selected_size: clean(selectedSize),
  available_sizes: asArray(availableSizes).map(clean).filter(Boolean),
  sizes: asArray(availableSizes).map(clean).filter(Boolean),
  size_options: asArray(availableSizes).map(clean).filter(Boolean),
  card_reply_mode: clean(selectedColor) && !clean(selectedSize) ? "color_only" : "",
  product_url: buildProductCardUrl(product, clean(selectedSize) ? variant : null, selectedColor),
  storefront_url: buildProductCardUrl(product, clean(selectedSize) ? variant : null, selectedColor),
});

const productColors = (product = {}) =>
  [...new Set(
    getVariantRows(product)
      .flatMap((variant) => [
        clean(variant.color || variant.color_name || variant.variant_color || variant.selected_color),
        clean(variant.variant?.color || variant.variant?.color_name || ""),
        clean(product.color || product.color_name || product.variant_color || ""),
      ])
      .filter(Boolean)
  )];

const productColorOptions = (product = {}) => {
  const variants = getVariantRows(product);
  const colorImages = asArray(product?.color_images);
  const imagesByColor = product?.images_by_color && typeof product.images_by_color === "object" && !Array.isArray(product.images_by_color)
    ? product.images_by_color
    : {};

  return productColors(product).map((color) => {
    const matchingVariants = variants.filter(
      (variant) => normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color) === normalizeKey(color)
    );
    const preferredVariant =
      matchingVariants.find((variant) => Number(variant.stock_quantity ?? variant.stock ?? variant.quantity ?? 0) > 0 && variantProductImage(variant)) ||
      matchingVariants.find((variant) => variantProductImage(variant)) ||
      matchingVariants.find((variant) => Number(variant.stock_quantity ?? variant.stock ?? variant.quantity ?? 0) > 0) ||
      matchingVariants[0] ||
      null;
    const matchingColorImage = colorImages.find(
      (entry) => normalizeKey(entry?.color || entry?.color_name || entry?.name || entry?.label) === normalizeKey(color)
    );
    const mappedImage = Object.entries(imagesByColor).find(([key]) => normalizeKey(key) === normalizeKey(color))?.[1];
    const imageUrl =
      variantProductImage(preferredVariant || {}) ||
      nestedProductImage(matchingColorImage) ||
      nestedProductImage(mappedImage) ||
      (productColors(product).length === 1 ? productImage(product) : "");
    return { color, imageUrl, variant: preferredVariant };
  });
};

const variantColorValue = (variant = {}) =>
  clean(
    variant.color ||
      variant.color_name ||
      variant.variant_color ||
      variant.selected_color ||
      variant.variant?.color ||
      variant.variant?.color_name ||
      ""
  );

const variantSizeValue = (variant = {}) =>
  clean(
    variant.size ||
      variant.size_name ||
      variant.variant_size ||
      variant.selected_size ||
      variant.variant?.size ||
      variant.variant?.size_name ||
      ""
  );

const variantStockQuantity = (variant = {}) =>
  Math.max(
    0,
    Number(
      variant.stock_quantity ??
        variant.stock ??
        variant.quantity ??
        variant.qty ??
        variant.available_quantity ??
        variant.inventory_quantity ??
        variant.current_stock ??
        0
    ) || 0
  );

const sortProductSizes = (sizes = []) =>
  [...new Set(asArray(sizes).map(clean).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
  );

const productSizeOptions = (product = {}, color = "") => {
  const variants = getVariantRows(product);
  const normalizedColor = normalizeKey(color);
  const hasColorVariants = productColors(product).length > 0;
  const allSizes = [
    ...new Set(
      variants
        .map(variantSizeValue)
        .concat(clean(product.size || product.size_name || product.variant_size || ""))
        .filter(Boolean)
    ),
  ];

  return sortProductSizes(allSizes).map((size) => {
    const normalizedSize = normalizeKey(size);
    const matchingVariants = variants.filter((variant) => {
      const sizeMatch = normalizeKey(variantSizeValue(variant)) === normalizedSize;
      const colorMatch = !hasColorVariants || (normalizedColor && normalizeKey(variantColorValue(variant)) === normalizedColor);
      return sizeMatch && colorMatch;
    });
    const availableVariant = matchingVariants.find((variant) => variantStockQuantity(variant) > 0) || null;

    return {
      size,
      available: Boolean(availableVariant),
      stock: matchingVariants.reduce((total, variant) => total + variantStockQuantity(variant), 0),
      variant: availableVariant || matchingVariants[0] || null,
    };
  });
};

const findVariant = (product = {}, color = "", size = "") => {
  const normalizedColor = normalizeKey(color);
  const normalizedSize = normalizeKey(size);
  const variants = getVariantRows(product);
  return (
    variants.find((variant) => {
      const variantColor = normalizeKey(variantColorValue(variant));
      const variantSize = normalizeKey(variantSizeValue(variant));
      const colorMatch = !normalizedColor || variantColor === normalizedColor;
      const sizeMatch = !normalizedSize || variantSize === normalizedSize;
      return colorMatch && sizeMatch;
    }) || null
  );
};

const NAV_ITEMS = [
  { key: "conversations", labelKey: "aiSupport.inbox.ui.aiInbox", icon: MessageCircleMore },
  { key: "leads", labelKey: "aiSupport.inbox.pwa.leads", icon: Layers3 },
  { key: "config", labelKey: "aiSupport.quickReplies.config", icon: Settings },
  { key: "social_comments", labelKey: "aiSupport.inbox.ui.socialComments", icon: MessageSquareText },
  { key: "more", labelKey: "aiSupport.inbox.pwa.more", icon: MoreHorizontal },
];

function PwaChip({ children, tone = "slate" }) {
  const classes = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${classes[tone] || classes.slate}`}>
      {children}
    </span>
  );
}

function MessageText({ text = "" }) {
  const value = String(text || "");
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p dir="auto" className="whitespace-pre-wrap break-words text-[14px] leading-5.5 text-inherit">
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        return (
          <a
            key={`${index}-${part}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-sky-600 underline underline-offset-2"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}

function PwaReplyEditor({ value = "", onChange, onSubmit, placeholder = "", disabled = false, editorRef: externalEditorRef = null }) {
  const internalEditorRef = useRef(null);
  const editorRef = externalEditorRef || internalEditorRef;
  const allowLineBreakRef = useRef(false);

  const submitCurrentText = (event) => {
    event.preventDefault();
    if (disabled) return;
    const text = String(event.currentTarget.innerText || "").replace(/\u00a0/g, " ");
    if (!text.trim() || /^\s*\//.test(text)) return;
    onChange?.(text);
    onSubmit?.(text);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentText = String(editor.innerText || "").replace(/\u00a0/g, " ");
    if (currentText !== String(value || "")) editor.innerText = String(value || "");
  }, [value]);

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label={placeholder}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      inputMode="text"
      enterKeyHint="send"
      spellCheck
      dir="auto"
      data-placeholder={placeholder}
      data-ai-inbox-composer="true"
      onInput={(event) => onChange?.(String(event.currentTarget.innerText || "").replace(/\u00a0/g, " "))}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.shiftKey) {
          allowLineBreakRef.current = true;
          return;
        }
        submitCurrentText(event);
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter") allowLineBreakRef.current = false;
      }}
      onBeforeInput={(event) => {
        const inputType = event.nativeEvent?.inputType || "";
        if (!["insertParagraph", "insertLineBreak"].includes(inputType)) return;
        if (event.nativeEvent?.isComposing) return;
        if (allowLineBreakRef.current) {
          allowLineBreakRef.current = false;
          return;
        }
        submitCurrentText(event);
      }}
      className="ai-pwa-reply-editor max-h-28 min-h-12 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
    />
  );
}

// WhatsApp picture URLs expire: the stored one can 404 and the browser paints
// a broken-image glyph. Remember dead URLs for the session so a re-render does
// not retry them, and ask the backend once to fetch the current URL.
const deadAvatarUrls = new Set();

const reportDeadAvatar = (conversation, url) => {
  deadAvatarUrls.add(url);
  // WhatsApp and Meta both hand out signed picture urls that expire, so a picture
  // that stopped loading is a reason to ask the provider again, once per session.
  const channel = String(conversation?.channel || conversation?.source || "").toLowerCase();
  const refreshable = channel === "whatsapp"
    || channel.includes("instagram")
    || channel.includes("messenger")
    || channel.includes("facebook");
  if (!refreshable) return;
  const { sessionId, conversationId } = conversationIdentifiers(conversation);
  const target = conversationId || sessionId;
  if (!target || avatarRefreshRequested.has(target)) return;
  avatarRefreshRequested.add(target);
  api.post(aiInboxConversationEndpoint(target, "/refresh-avatar"), { channel }).catch(() => {});
};

function ConversationListItem({ conversation, active, accountLabel = "", onSelect, onToggleFavorite, onToggleRead }) {
  const { t, i18n } = useTranslation();
  const [, forceAvatarFallback] = useState(0);
  const isSocialComment = isSocialCommentThread(conversation);
  const inboxKind = getInboxItemKind(conversation);
  const sourceLabel = getConversationSourceLabel(conversation, t);
  const SourceIcon = getConversationSourceIcon(conversation);
  const unreadCount = conversationUnreadCount(conversation);
  const isCommentThread = isCommentConversation(conversation) || isSocialComment;
  const rawAvatar = isCommentThread ? commentThreadCustomerAvatarUrl(conversation) : customerAvatarUrl(conversation);
  const avatar = rawAvatar && !deadAvatarUrls.has(rawAvatar) ? rawAvatar : "";
  const postImage = isCommentThread ? commentThreadPostImageUrl(conversation) : "";
  const title = isCommentThread ? commentThreadCommenterName(conversation) : conversationName(conversation);
  const commenterName = isCommentThread ? commentThreadCommenterName(conversation) : "";
  const preview = isCommentThread ? commentThreadLastComment(conversation) || t("aiSupport.inbox.pwa.noCommentsYet") : conversationPreview(conversation) || t("aiSupport.inbox.pwa.noMessagesYet");
  const commentCount = isCommentThread ? commentThreadCommentCount(conversation) : 0;
  const language = i18n.resolvedLanguage === "ar" ? "ar" : "en";
  const lastActivity = renderPwaCardTime(conversation, language);
  if (import.meta.env.DEV && (isSocialCommentThread(conversation) || getInboxItemKind(conversation) === "comment")) {
    console.log("AI_INBOX_PWA_VISIBLE_TIME_FIELD", {
      post_id: conversation?.post_id,
      comment_id: conversation?.comment_id,
      real_comment_created_time: conversation?.real_comment_created_time,
      comment_created_time: conversation?.comment_created_time,
      last_activity_at: conversation?.last_activity_at,
      updated_at: conversation?.updated_at,
      rendered_time_source: getPwaCardTimeValue(conversation),
      rendered_label: renderPwaCardTime(conversation),
    });
  }
  const postTime = isCommentThread ? commentThreadPostTime(conversation) : "";
  const unread = unreadCount > 0 || conversation?.manually_unread === true;
  const isFavorite = conversation?.is_favorite === true || clean(conversation?.is_favorite).toLowerCase() === "true";
  return (
    // A div, not a button: the star and the read toggle are real buttons and a
    // button cannot legally contain another one.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conversation)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(conversation);
        }
      }}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl px-2 py-2 text-left transition ${
        active
          ? "bg-slate-900 text-white"
          : unread
            ? "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            : "bg-transparent text-slate-900 hover:bg-white"
      }`}
    >
      {avatar ? (
        <AvatarZoom url={avatar} name={title}>
          <div className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl ${unread && !active ? "ring-2 ring-emerald-200" : "ring-1 ring-slate-200"}`}>
            <img
              src={avatar}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => {
                reportDeadAvatar(conversation, avatar);
                forceAvatarFallback((value) => value + 1);
              }}
            />
            {isCommentThread ? <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-transparent to-black/25" /> : null}
          </div>
        </AvatarZoom>
      ) : (
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-white/12 text-white" : unread ? "bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : "bg-slate-200 text-slate-600"}`}>
          <UserRound className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {inboxKind === "comment" ? (
              <>
                <div className={`line-clamp-1 text-[14px] leading-5 ${unread && !active ? "font-bold" : "font-semibold"}`}>{commenterName}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                    <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-600" : channelMeta(conversation.channel || conversation.source).tone}`} />
                    {sourceLabel}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-blue-50 text-blue-700"}`}>
                    {commentCount ? t("aiSupport.inbox.pwa.commentCount", { count: commentCount }) : t("aiSupport.inbox.pwa.comment")}
                  </span>
                  {needsHumanAttention(conversation) ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                      {t("aiSupport.inbox.ui.needsHuman")}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className={`line-clamp-2 text-[14px] leading-5 ${unread && !active ? "font-bold" : "font-semibold"}`}>{title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                    <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-600" : channelMeta(conversation.channel || conversation.source).tone}`} />
                    {sourceLabel}
                  </span>
                  {/* Which WhatsApp number / page this thread belongs to. Only
                      rendered when the tenant actually has more than one. */}
                  {accountLabel ? (
                    <span className={`inline-flex max-w-[9rem] items-center truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                      {accountLabel}
                    </span>
                  ) : null}
                  {needsHumanAttention(conversation) ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                      {t("aiSupport.inbox.ui.needsHuman")}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className={`text-[11px] font-medium ${active ? "text-slate-300" : "text-slate-500"}`}>
              {lastActivity}
            </div>
            <div className="flex items-center gap-0.5">
              {onToggleRead ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRead(conversation);
                  }}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${
                    active ? "text-slate-300 hover:bg-white/10" : unread ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:bg-slate-100"
                  }`}
                  aria-label={unread ? t("aiSupport.inbox.ui.markRead") : t("aiSupport.inbox.ui.markUnread")}
                  title={unread ? t("aiSupport.inbox.ui.markRead") : t("aiSupport.inbox.ui.markUnread")}
                >
                  {unread ? <CheckCheck className="h-4 w-4" /> : <MailIcon className="h-4 w-4" />}
                </button>
              ) : null}
              {onToggleFavorite ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(conversation);
                  }}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${
                    isFavorite ? "text-amber-500 hover:bg-amber-50" : active ? "text-slate-300 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"
                  }`}
                  aria-label={isFavorite ? t("aiSupport.inbox.pwa.removeFavorite") : t("aiSupport.inbox.pwa.addFavorite")}
                  title={isFavorite ? t("aiSupport.inbox.pwa.removeFavorite") : t("aiSupport.inbox.pwa.addFavorite")}
                >
                  <Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
                </button>
              ) : null}
            </div>
            {unreadCount > 0 ? (
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-slate-900" : "bg-emerald-500 text-white"}`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        {inboxKind === "comment" ? (
          <div className={`mt-1.5 flex gap-2 rounded-2xl border p-2.5 text-[12.5px] leading-5 ${active ? "border-white/10 bg-white/5 text-slate-200" : unread ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {postImage ? <img src={postImage} alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-cover ring-1 ring-black/5" loading="lazy" /> : null}
            <div className="min-w-0 flex-1">
              <div className="mb-1 line-clamp-1 text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{commentThreadDisplayName(conversation)}</div>
              <span className="line-clamp-2 font-medium">{preview}</span>
            </div>
          </div>
        ) : (
          <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unread ? "text-slate-700" : "text-slate-500"}`}>
            <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unread && !active ? "text-emerald-600" : ""}`} />
            <span className={`line-clamp-2 text-left ${unread && !active ? "font-medium" : ""}`}>{preview}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* Legacy transcript renderer retained only for history; the live PWA uses OptimizedTranscript.
const Transcript = memo(function Transcript({ conversation, loadingOlder, onLoadOlder }) {
  const messages = uniqueMessages(conversation?.messages || []).filter((message) => !isHiddenAiReplyDraftMessage(message));
  if (!messages.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No messages yet.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5 pb-3">
      {conversation?.older_messages_available ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            Load older
          </button>
        </div>
      ) : null}
      {messages.map((message) => {
        const cards = normalizeMessageProductCards(message);
        const hasProductCards = cards.length > 0;
        const displayText = messageDisplayText(message);
        const isFromMe = isFromMeMessage(message);
        const isCustomer = Boolean(clean(message.customer_message)) && !isFromMe;
        const isStaff = Boolean(clean(message.staff_message)) && !hasProductCards;
        const isAiSender = ["assistant", "ai", "bot", "system"].includes(clean(message.sender_type).toLowerCase());
        const isAi = !isStaff && (isAiSender || Boolean(clean(message.ai_answer)) || (message.direction === "outbound" && !isFromMe));
        if (!isCustomer && !isAi && !isStaff && !hasProductCards) return null;

        return (
          <div key={messageKey(message)} className="space-y-1.5">
            {isProductCardMessage(message) ? (
              <div className="flex justify-start">
                <div className="w-[82%] max-w-sm space-y-1.5">
                  <div className="px-1 text-left text-[10px] font-medium text-slate-500">{absoluteTime(message.created_at)}</div>
                  <ProductCardMessage message={message} cards={cards} />
                </div>
              </div>
            ) : null}
            {!hasProductCards && isCustomer ? (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-emerald-50 px-3 py-2 shadow-sm ring-1 ring-emerald-100">
                  <div className="mb-1 text-right text-[10px] font-medium text-emerald-700/70">{absoluteTime(message.created_at)}</div>
                  <div className="text-slate-900">
                    <MessageText text={message.customer_message || displayText} />
                    {message.delivery_status === "failed" ? " · Failed" : ""}
                    {message.delivery_status === "failed" && message.delivery_error ? (
                      <p className="mt-1 text-[11px] leading-4 text-rose-200">{message.delivery_error}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {!hasProductCards && isAi ? (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-[20px] rounded-bl-md bg-sky-50 px-3 py-2 shadow-sm ring-1 ring-sky-100">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-sky-700">
                    <Bot className="h-3.5 w-3.5" />
                    AI
                  </div>
                  <div className="text-slate-800">
                    <MessageText text={message.ai_answer || displayText} />
                  </div>
                </div>
              </div>
            ) : null}
            {!hasProductCards && isStaff ? (
              <div className="flex justify-start">
                <div className={`max-w-[82%] rounded-[20px] rounded-bl-md px-3 py-2 shadow-sm ${message.delivery_status === "failed" ? "bg-rose-950 text-rose-50 ring-1 ring-rose-200" : "bg-slate-900 text-white"}`}>
                  <div className={`mb-1 text-[10px] font-medium ${message.delivery_status === "failed" ? "text-rose-200" : "text-slate-300"}`}>
                    {message.message_type === "internal_note" ? "Internal Note" : "Team"} · {absoluteTime(message.created_at)}
                  </div>
                  <p dir="auto" className={`whitespace-pre-wrap break-words text-[14px] leading-5.5 ${message.delivery_status === "failed" ? "text-rose-50" : "text-white"}`}>{message.staff_message || displayText}</p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
*/

const OptimizedTranscript = memo(function OptimizedTranscript({
  conversation = null,
  rows = [],
  loadingOlder,
  onLoadOlder,
  olderMessagesAvailable = false,
  onReplyComment,
  onPrivateMessage,
  onReact,
  onEditMessage,
  onOpenCorrection,
  reactionOptions,
}) {
  const { t } = useTranslation();
  const isCommentThread = isCommentConversation(conversation || {});
  if (!rows.length && !isCommentThread) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        {t("aiSupport.inbox.pwa.noMessagesYet")}
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5 pb-3">
      <PinnedMessagesBar rows={rows} variant="pwa" />
      {olderMessagesAvailable ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            {t("aiSupport.inbox.pwa.loadOlder")}
          </button>
        </div>
      ) : null}
      {isCommentThread ? (
        <div className="sticky top-2 z-10 rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)]">
          <div className="flex items-start gap-3">
            {commentThreadPostImageUrl(conversation || {}) ? (
              <img src={commentThreadPostImageUrl(conversation || {})} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-1 ring-slate-200" loading="lazy" />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <MessageSquareText className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-700">{t("aiSupport.inbox.pwa.post")}</div>
              <div className="mt-1 line-clamp-2 text-[16px] font-black leading-6 text-slate-900">{commentThreadDisplayName(conversation || {})}</div>
              {commentThreadPostTime(conversation || {}) ? (
                <div className="mt-1 text-[11px] font-medium text-slate-500">{commentThreadPostTime(conversation || {})}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {commentThreadPostUrl(conversation || {}) ? (
                  <a href={commentThreadPostUrl(conversation || {})} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-black text-emerald-700">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("aiSupport.inbox.pwa.openPost")}
                  </a>
                ) : null}
                <button type="button" onClick={() => onPrivateMessage?.(conversation)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-[11px] font-black text-cyan-700">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  {t("aiSupport.inbox.pwa.sendPrivateMessage")}
                </button>
              </div>
              {commentThreadCommentCount(conversation || {}) ? (
                <div className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">
                  {t("aiSupport.inbox.pwa.commentCount", { count: commentThreadCommentCount(conversation || {}) })}
                </div>
              ) : null}
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
              <div className="ai-pwa-day-separator mx-auto my-1 w-max rounded-full bg-slate-500/15 px-3 py-1 text-[11px] font-black text-slate-500">
                {dayLabel}
              </div>
            ) : null}
            <TranscriptMessage
              row={row}
              variant="pwa"
              onReplyComment={onReplyComment}
              onPrivateMessage={onPrivateMessage}
              onReact={onReact}
              onEditMessage={onEditMessage}
              onOpenCorrection={onOpenCorrection}
              reactionOptions={reactionOptions}
            />
          </Fragment>
        );
      })}
    </div>
  );
});

function ProductSheet({
  open,
  products,
  loading,
  query,
  onQueryChange,
  onClose,
  onSend,
  sending,
  selectedConversation,
}) {
  const { t } = useTranslation();
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [view, setView] = useState("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [productFilters, setProductFilters] = useState(() => ({ ...PRODUCT_FILTER_DEFAULTS }));
  const [draftPosFilters, setDraftPosFilters] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedProductId("");
    setSelectedColor("");
    setSelectedSize("");
    setView("list");
    setFiltersOpen(false);
    setProductFilters({ ...PRODUCT_FILTER_DEFAULTS });
    setDraftPosFilters(null);
  }, [open, selectedConversation?.session_id]);

  const productEntries = useMemo(
    () =>
      asArray(products)
        .filter((product) => product && typeof product === "object")
        .map((product, index) => ({ product, sheetId: productSheetIdentity(product, index), meta: productFilterMeta(product) })),
    [products]
  );

  const smartClassificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false, includeCurrentValue: false }),
    [classificationGroups]
  );

  const smartFilterOptions = useMemo(() => {
    const withCounts = (options, field) => asArray(options).map((option) => {
      const id = field === "productType"
        ? normalizeCanonicalProductType(option.value || option.id)
        : normalizeClassificationValue(option.value || option.id);
      const count = productEntries.filter(({ meta }) => field === "audience" ? meta.audience.has(id) : meta[field] === id).length;
      return {
        ...option,
        id,
        name: option.label_ar || option.label_en || option.label || option.name || option.value || option.id,
        count,
      };
    });
    return {
      gender: withCounts(smartClassificationOptions.gender, "audience"),
      productType: moveWinterCollectionToEnd(withCounts(smartClassificationOptions.productType, "productType")),
      grade: withCounts(smartClassificationOptions.grade, "grade"),
    };
  }, [productEntries, smartClassificationOptions]);

  const posBrandOptions = useMemo(() => {
    const map = new Map();
    productEntries.forEach(({ product, meta }) => {
      if (!meta.brand) return;
      const current = map.get(meta.brand) || {
        id: meta.brand,
        name: firstProductField(product, ["brand_name", "brand"]) || meta.brand,
        count: 0,
      };
      current.count += 1;
      map.set(meta.brand, current);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [productEntries]);

  const posManufacturerOptions = useMemo(() => {
    const map = new Map();
    productEntries.forEach(({ product, meta }) => {
      if (!meta.manufacturer) return;
      const current = map.get(meta.manufacturer) || {
        id: meta.manufacturer,
        name: firstProductField(product, ["manufacturer_name", "manufacturer"]) || meta.manufacturer,
        count: 0,
      };
      current.count += 1;
      map.set(meta.manufacturer, current);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [productEntries]);

  const filteredProductEntries = useMemo(() => {
    const normalized = clean(query).toLowerCase();
    return productEntries.filter(({ product, meta }) => {
      if (normalizeMultiFilterValue(productFilters.audience).length && !normalizeMultiFilterValue(productFilters.audience).some((value) => meta.audience.has(value))) return false;
      if (normalizeMultiFilterValue(productFilters.brand).length && !normalizeMultiFilterValue(productFilters.brand).includes(meta.brand)) return false;
      if (normalizeMultiFilterValue(productFilters.manufacturer).length && !normalizeMultiFilterValue(productFilters.manufacturer).includes(meta.manufacturer)) return false;
      if (["productType", "grade"].some((field) => productFilters[field] !== "all" && meta[field] !== productFilters[field])) return false;
      if (productFilters.stock !== "all" && meta.stock !== productFilters.stock) return false;
      if (!normalized) return true;
      const searchable = [
        product.name,
        product.product_name,
        product.title,
        product.brand,
        product.brand_name,
        product.category,
        product.category_name,
        product.sku,
        product.barcode,
        ...getVariantRows(product).flatMap((variant) => [
          variant.color,
          variant.color_name,
          variant.variant_color,
          variant.size,
          variant.size_name,
          variant.variant_size,
          variant.sku,
          variant.barcode,
          variant.article_code,
        ]),
      ]
        .map((item) => clean(item).toLowerCase())
        .filter(Boolean);
      return searchable.some((item) => item.includes(normalized));
    });
  }, [productEntries, productFilters, query]);

  const activeProductFilterCount = useMemo(
    () => normalizeMultiFilterValue(productFilters.audience).length + normalizeMultiFilterValue(productFilters.brand).length + normalizeMultiFilterValue(productFilters.manufacturer).length + [productFilters.productType, productFilters.grade].filter((value) => value !== "all").length,
    [productFilters]
  );

  const openPosFilters = useCallback(() => {
    setDraftPosFilters({
      audience: normalizeMultiFilterValue(productFilters.audience),
      productType: productFilters.productType || "all",
      grade: productFilters.grade || "all",
      brand: normalizeMultiFilterValue(productFilters.brand),
      manufacturer: normalizeMultiFilterValue(productFilters.manufacturer),
    });
    setFiltersOpen(true);
  }, [productFilters]);

  const updateDraftMultiFilter = useCallback((field, value) => {
    setDraftPosFilters((current) => ({ ...(current || {}), [field]: toggleMultiFilterValue(current?.[field] || [], value) }));
  }, []);

  const updateDraftSingleFilter = useCallback((field, value) => {
    setDraftPosFilters((current) => ({ ...(current || {}), [field]: value }));
  }, []);

  const resetDraftPosFilters = useCallback(() => {
    setDraftPosFilters({ audience: [], productType: "all", grade: "all", brand: [], manufacturer: [] });
  }, []);

  const applyDraftPosFilters = useCallback(() => {
    setProductFilters((current) => ({
      ...current,
      audience: normalizeMultiFilterValue(draftPosFilters?.audience),
      productType: draftPosFilters?.productType || "all",
      grade: draftPosFilters?.grade || "all",
      brand: normalizeMultiFilterValue(draftPosFilters?.brand),
      manufacturer: normalizeMultiFilterValue(draftPosFilters?.manufacturer),
      mainCategory: "all",
      subCategory: "all",
      childCategory: "all",
      stock: "all",
    }));
    setFiltersOpen(false);
  }, [draftPosFilters]);

  useEffect(() => {
    if (!open) return;
    const firstId = filteredProductEntries[0]?.sheetId || "";
    if (!selectedProductId || !filteredProductEntries.some((entry) => entry.sheetId === selectedProductId)) {
      setSelectedProductId(firstId);
      if (view === "detail") setView("list");
    }
  }, [filteredProductEntries, open, selectedProductId, view]);

  const selectedProductEntry = useMemo(
    () => filteredProductEntries.find((entry) => entry.sheetId === selectedProductId) || filteredProductEntries[0] || null,
    [filteredProductEntries, selectedProductId]
  );
  const selectedProduct = selectedProductEntry?.product || null;

  const colors = useMemo(() => productColors(selectedProduct || {}), [selectedProduct]);
  const colorOptions = useMemo(() => productColorOptions(selectedProduct || {}), [selectedProduct]);
  const selectedColorOption = useMemo(
    () => colorOptions.find((option) => normalizeKey(option.color) === normalizeKey(selectedColor)) || null,
    [colorOptions, selectedColor]
  );
  const sizeOptions = useMemo(
    () => productSizeOptions(selectedProduct || {}, selectedColor),
    [selectedColor, selectedProduct]
  );
  const sizes = useMemo(() => sizeOptions.map((option) => option.size), [sizeOptions]);
  const selectedSizeOption = useMemo(
    () => sizeOptions.find((option) => normalizeKey(option.size) === normalizeKey(selectedSize)) || null,
    [selectedSize, sizeOptions]
  );
  const needsColorSelection = colors.length > 0;
  const needsSizeSelection = sizes.length > 0;
  const availableSizesForColor = useMemo(
    () => sortProductSizes(sizeOptions.filter((option) => option.available).map((option) => option.size)),
    [sizeOptions]
  );

  useEffect(() => {
    if (!selectedProduct) return;
    setSelectedColor("");
    setSelectedSize("");
  }, [selectedProductId, selectedProduct]);

  useEffect(() => {
    if (!clean(selectedSize)) return;
    if (!selectedSizeOption?.available) setSelectedSize("");
  }, [selectedSize, selectedSizeOption]);

  const variant = useMemo(() => {
    if (!selectedProduct) return null;
    if (needsColorSelection && needsSizeSelection) {
      if (!clean(selectedColor)) return null;
      return findVariant(selectedProduct || {}, selectedColor, selectedSize);
    }
    if (needsColorSelection) {
      if (!clean(selectedColor)) return null;
      return findVariant(selectedProduct || {}, selectedColor, "");
    }
    if (needsSizeSelection) {
      if (!clean(selectedSize)) return null;
      return findVariant(selectedProduct || {}, "", selectedSize);
    }
    return null;
  }, [needsColorSelection, needsSizeSelection, selectedColor, selectedProduct, selectedSize]);
  const card = useMemo(
    () => (selectedProduct ? buildProductCardPayload(selectedProduct, variant, selectedColor, selectedSize, availableSizesForColor) : null),
    [availableSizesForColor, selectedColor, selectedProduct, selectedSize, variant]
  );
  const canSend = Boolean(
    selectedConversation?.session_id &&
      selectedProduct &&
      (!needsColorSelection || clean(selectedColor)) &&
      (needsColorSelection || !needsSizeSelection || (clean(selectedSize) && selectedSizeOption?.available)) &&
      (!needsColorSelection || availableSizesForColor.length > 0)
  );
  const previewImage = useMemo(
    () => productImage(selectedProduct || {}, variant || selectedColorOption?.variant || null) || productImage(selectedProduct || {}),
    [selectedColorOption, selectedProduct, variant]
  );
  const previewPrice = Number(variant?.price ?? selectedProduct?.final_price ?? selectedProduct?.price ?? 0) || 0;
  const previewStock = Number(variant?.stock_quantity ?? variant?.stock ?? selectedProduct?.total_stock ?? selectedProduct?.stock ?? 0) || 0;

  if (!open) return null;
  const isDesktopViewport = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 768px)").matches : true;
  const mobileFullscreenMode = !isDesktopViewport;

  const selectedProductDebugId = clean(selectedProduct?.product_id || selectedProduct?.id || "");
  const selectedVariantDebug = variant || null;

  const handleSendProduct = () => {
    if (!card) return;
    console.debug("[ai-inbox-product-card]", {
      selected_product_id: selectedProductDebugId,
      selected_color: clean(selectedColor),
      selected_size: clean(selectedSize),
      selected_variant_id: clean(selectedVariantDebug?.id || ""),
      selected_variant_color: clean(selectedVariantDebug?.color || selectedVariantDebug?.color_name || selectedVariantDebug?.variant_color || selectedVariantDebug?.selected_color || ""),
      selected_variant_size: clean(selectedVariantDebug?.size || selectedVariantDebug?.size_name || selectedVariantDebug?.variant_size || selectedVariantDebug?.selected_size || ""),
    });
    onSend([card]);
  };

  const sheet = (
    <div
      className={
        mobileFullscreenMode
          ? "ai-pwa-product-sheet ai-pwa-product-sheet--mobile fixed inset-0 z-[99999] isolate flex items-stretch justify-center overflow-hidden bg-white text-slate-900 [padding-top:max(0.75rem,env(safe-area-inset-top))] [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]"
          : "ai-pwa-product-sheet fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 px-2 pb-2 pt-14 sm:px-4 sm:pb-4 sm:pt-16"
      }
      onClick={onClose}
    >
      <div
        className={
          mobileFullscreenMode
            ? "ai-pwa-product-sheet__panel flex h-full w-screen min-w-0 max-w-[100vw] flex-col overflow-hidden bg-white"
            : "ai-pwa-product-sheet__panel flex h-[82dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-16px_40px_rgba(15,23,42,0.18)] sm:h-[min(88dvh,52rem)]"
        }
        style={
          mobileFullscreenMode
            ? {
                width: "100vw",
                maxWidth: "100vw",
                height: "calc(100dvh - max(0.75rem, env(safe-area-inset-top)) - max(1.25rem, env(safe-area-inset-bottom)))",
              }
            : undefined
        }
        onClick={(event) => event.stopPropagation()}
      >
        {mobileFullscreenMode ? null : <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={mobileFullscreenMode ? "ai-pwa-product-sheet__toolbar sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-3" : "ai-pwa-product-sheet__toolbar sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur"}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-slate-900">{t("aiSupport.inbox.picker.sendProduct")}</h3>
                <p className="text-xs text-slate-500">
                  {selectedConversation ? t("aiSupport.inbox.pwa.sendingTo", { name: conversationName(selectedConversation) }) : t("aiSupport.inbox.pwa.selectProductCard")}
                </p>
              </div>
              <button type="button" onClick={onClose} className="ai-pwa-product-sheet__close rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                {t("aiSupport.inbox.kpi.close")}
              </button>
            </div>
          </div>

          <div className="ai-pwa-product-sheet__body min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
            <div className="space-y-3">
              {view === "list" ? (
                <>
                  <div className="flex gap-2">
                    <label className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder={t("aiSupport.inbox.picker.searchPlaceholder")}
                        className="ai-pwa-product-sheet__search h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={openPosFilters}
                      className={`ai-pwa-product-sheet__filter-trigger relative inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-semibold transition ${filtersOpen || activeProductFilterCount ? "is-active border-amber-400 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"}`}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {t("aiSupport.inbox.pwa.filters")}
                      {activeProductFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-slate-950">{activeProductFilterCount}</span> : null}
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      ["all", t("aiSupport.inbox.pwa.all")],
                      ["men", t("aiSupport.inbox.pwa.men")],
                      ["women", t("aiSupport.inbox.pwa.women")],
                      ["kids", t("aiSupport.inbox.pwa.kids")],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setProductFilters((current) => ({ ...current, audience: value === "all" ? [] : [value] }))}
                        className={`ai-pwa-product-sheet__audience-chip h-9 rounded-xl border text-xs font-semibold transition ${(value === "all" ? normalizeMultiFilterValue(productFilters.audience).length === 0 : normalizeMultiFilterValue(productFilters.audience).includes(value)) ? "is-active border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

              <div className="space-y-2 pb-4">
                {loading ? (
                  <div className="ai-pwa-product-sheet__state grid min-h-32 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : filteredProductEntries.length ? (
                  filteredProductEntries.slice(0, 120).map(({ product, sheetId }) => {
                    const active = sheetId === selectedProductEntry?.sheetId;
                    const previewImage = productImage(product);
                    return (
                      <button
                        key={sheetId}
                        type="button"
                        onClick={() => {
                          setSelectedProductId(sheetId);
                          setSelectedColor("");
                          setSelectedSize("");
                          setView("detail");
                        }}
                        className={`ai-pwa-product-sheet__product-row flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                          active ? "is-active border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
                        }`}
                      >
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || t("aiSupport.inbox.ui.product")} className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <div className={`grid h-14 w-14 place-items-center rounded-xl ${active ? "bg-white/10" : "bg-slate-100"}`}>
                            <ShoppingBag className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{product.name || product.product_name}</div>
                          <div className={`mt-1 text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                            {Number(product.final_price || product.price || 0) > 0 ? money(product.final_price || product.price) : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="ai-pwa-product-sheet__state rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    {t("aiSupport.inbox.pwa.noFilteredProducts")}
                  </div>
                )}
              </div>
                </>
              ) : (
                <div className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      className="ai-pwa-product-sheet__subtle-action inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      {t("aiSupport.inbox.pwa.backToProducts")}
                    </button>
                    <a
                      href={selectedProduct?.storefront_url || selectedProduct?.product_url || selectedProduct?.url || productUrl(selectedProduct)}
                      target="_blank"
                      rel="noreferrer"
                      className="ai-pwa-product-sheet__subtle-action inline-flex items-center rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      {t("aiSupport.inbox.productCard.openProduct")}
                    </a>
                  </div>

                  <div className="ai-pwa-product-sheet__detail-card overflow-hidden rounded-3xl border border-slate-200 bg-white">
                    {previewImage ? (
                      <img src={previewImage} alt={selectedProduct?.name || selectedProduct?.product_name || t("aiSupport.inbox.ui.product")} className="h-[170px] w-full object-contain bg-slate-50 p-2" loading="lazy" />
                    ) : (
                      <div className="grid h-[170px] w-full place-items-center bg-slate-50">
                        <ShoppingBag className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                    <div className="space-y-1.5 p-3">
                      <div className="text-base font-semibold text-slate-900">{selectedProduct?.name || selectedProduct?.product_name || t("aiSupport.inbox.pwa.selectProduct")}</div>
                      {previewPrice > 0 ? <div className="text-sm font-medium text-emerald-700">{money(previewPrice)}</div> : null}
                      <div className="flex flex-wrap gap-2">
                        {selectedSize ? <PwaChip>{selectedSize}</PwaChip> : null}
                        {!selectedSize && selectedColor && availableSizesForColor.length ? (
                          <PwaChip>{t("aiSupport.inbox.pwa.availableSizes", { sizes: availableSizesForColor.join(", ") })}</PwaChip>
                        ) : null}
                        {variant?.available !== undefined ? (
                          <PwaChip tone={variant.available ? "emerald" : "rose"}>{variant.available ? t("aiSupport.inbox.pwa.inStockCount", { count: previewStock }) : t("aiSupport.inbox.pwa.outOfStock")}</PwaChip>
                        ) : previewStock > 0 ? (
                          <PwaChip tone="emerald">{t("aiSupport.inbox.pwa.inStockCount", { count: previewStock })}</PwaChip>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="ai-pwa-product-sheet__option-card rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-700">{t("aiSupport.inbox.picker.color")}</div>
                    <div className="mt-3 grid grid-cols-4 gap-2.5">
                      {colorOptions.length ? (
                        colorOptions.map((option) => {
                          const active = normalizeKey(selectedColor) === normalizeKey(option.color);
                          return (
                            <button
                              key={option.color}
                              type="button"
                              title={option.color}
                              aria-label={t("aiSupport.inbox.pwa.selectColor", { color: option.color })}
                              aria-pressed={active}
                              onClick={() => {
                                setSelectedColor(option.color);
                                setSelectedSize("");
                              }}
                              className={`ai-pwa-product-sheet__color-option group relative aspect-square min-w-0 overflow-hidden rounded-2xl border bg-slate-50 p-1 transition focus:outline-none focus:ring-2 focus:ring-emerald-500/60 ${
                                active
                                  ? "is-active border-emerald-500 ring-2 ring-emerald-500/30"
                                  : "border-slate-200 hover:border-slate-400"
                              }`}
                            >
                              {option.imageUrl ? (
                                <img
                                  src={option.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full rounded-xl bg-white object-contain"
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : (
                                <span className="grid h-full w-full place-items-center rounded-xl bg-slate-100 text-slate-400">
                                  <Image className="h-5 w-5" />
                                </span>
                              )}
                              {active ? (
                                <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-white">
                                  <CheckCheck className="h-3.5 w-3.5" />
                                </span>
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">{t("aiSupport.inbox.pwa.noColorData")}</div>
                      )}
                    </div>
                  </div>

                  <div className="ai-pwa-product-sheet__option-card rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-700">{t("aiSupport.inbox.picker.size")}</div>
                      {needsColorSelection ? <div className="text-xs text-slate-500">{t("aiSupport.inbox.pwa.optional")}</div> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sizeOptions.length ? (
                        sizeOptions.map(({ size, available, stock }) => {
                          const active = available && normalizeKey(selectedSize) === normalizeKey(size);
                          return (
                            <button
                              key={size}
                              type="button"
                              disabled={!available}
                              onClick={() => setSelectedSize(size)}
                              aria-label={available ? t("aiSupport.inbox.pwa.sizeInStock", { size, count: stock }) : t("aiSupport.inbox.pwa.sizeOutOfStock", { size })}
                              title={available ? t("aiSupport.inbox.pwa.inStockCount", { count: stock }) : t("aiSupport.inbox.pwa.outOfStock")}
                              className={`ai-pwa-product-sheet__size-option relative min-w-11 rounded-full border px-3 py-2 text-sm font-medium transition ${
                                active
                                  ? "is-active border-slate-900 bg-slate-900 text-white shadow-sm"
                                  : available
                                    ? "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                                    : "is-unavailable cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 line-through decoration-rose-500 decoration-2 opacity-70"
                              }`}
                            >
                              {size}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">{t("aiSupport.inbox.pwa.noSizeData")}</div>
                      )}
                    </div>
                    {needsColorSelection && !clean(selectedColor) ? (
                      <div className="mt-2 text-xs text-slate-500">{t("aiSupport.inbox.pwa.selectColorForSizes")}</div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={mobileFullscreenMode ? "ai-pwa-product-sheet__footer sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white px-4 pb-2 pt-3" : "ai-pwa-product-sheet__footer sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"}>
            <button
              type="button"
              onClick={handleSendProduct}
              disabled={!canSend}
              className="ai-pwa-product-sheet__send inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("aiSupport.inbox.picker.sendProduct")}
            </button>
            {!selectedConversation ? (
              <div className="mt-2 text-xs text-slate-500">{t("aiSupport.inbox.pwa.openConversationFirst")}</div>
            ) : (needsColorSelection && !clean(selectedColor)) || (!needsColorSelection && needsSizeSelection && !clean(selectedSize)) ? (
              <div className="mt-2 text-xs text-slate-500">
                {needsColorSelection ? t("aiSupport.inbox.pwa.selectColorToSend") : t("aiSupport.inbox.pwa.selectSizeToSend")}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
  const content = (
    <>
      {sheet}
      <SmartPosFilters
        open={filtersOpen}
        smartFilterOptions={smartFilterOptions}
        selectedGender={draftPosFilters?.audience ?? productFilters.audience}
        onGenderChange={(value) => updateDraftMultiFilter("audience", value)}
        selectedProductType={draftPosFilters?.productType ?? productFilters.productType}
        onProductTypeChange={(value) => updateDraftSingleFilter("productType", value)}
        selectedGrade={draftPosFilters?.grade ?? productFilters.grade}
        onGradeChange={(value) => updateDraftSingleFilter("grade", value)}
        brandOptions={posBrandOptions}
        selectedBrandId={draftPosFilters?.brand ?? productFilters.brand}
        onBrandChange={(value) => updateDraftMultiFilter("brand", value)}
        manufacturerOptions={posManufacturerOptions}
        selectedManufacturerId={draftPosFilters?.manufacturer ?? productFilters.manufacturer}
        onManufacturerChange={(value) => updateDraftMultiFilter("manufacturer", value)}
        activeSmartFilterCount={activeProductFilterCount}
        onApply={applyDraftPosFilters}
        onReset={resetDraftPosFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </>
  );
  return mobileFullscreenMode ? createPortal(content, document.body) : content;
}

function LeadsView({ conversations, onOpenConversation, search, leadFilter, onLeadFilterChange }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "ar" ? "ar" : "en";
  const filtered = useMemo(() => {
    const normalized = clean(search).toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !normalized || [
        conversationName(conversation),
        conversation.external_customer_id,
        conversation.phone,
        conversation.latest_message_preview,
        leadStatusLabel(conversationLeadStatus(conversation), t),
      ]
        .map((item) => clean(item).toLowerCase())
        .some((item) => item.includes(normalized));
      if (!matchesSearch) return false;
      return conversationLeadBucket(conversation) === leadFilter;
    });
  }, [conversations, leadFilter, search, t]);

  return (
    <div className="space-y-3 pb-28">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {LEAD_STATUS_ORDER.map((status) => {
          const active = leadFilter === status;
          const count = conversations.filter((conversation) => conversationLeadBucket(conversation) === status).length;
          return (
            <button
              key={status}
              type="button"
              onClick={() => onLeadFilterChange(status)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold ${
                active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
              }`}
            >
              {leadStatusLabel(status, t)}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length ? (
        <div className="space-y-2">
          {filtered.map((conversation) => {
            const status = conversationLeadStatus(conversation);
            return (
              <button
                key={conversation.conversation_key}
                type="button"
                onClick={() => onOpenConversation(conversation)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{conversationName(conversation)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{getConversationSourceLabel(conversation, t)}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{renderPwaCardTime(conversation, language)}</span>
                    </div>
                  </div>
                  <PwaChip tone={leadStatusTone(status)}>{leadStatusLabel(status, t)}</PwaChip>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          {t("aiSupport.inbox.pwa.noLeadConversations")}
        </div>
      )}
    </div>
  );
}

function MoreView({ installAvailable, onInstall }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 pb-28">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-slate-100 p-3">
            <SmartphoneIcon />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">{t("aiSupport.inbox.pwa.standaloneShell")}</div>
            <div className="mt-1 text-sm text-slate-500">{t("aiSupport.inbox.pwa.standaloneShellHint")}</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onInstall}
        disabled={!installAvailable}
        className="flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm disabled:opacity-50"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">{t("aiSupport.inbox.pwa.installApp")}</div>
          <div className="text-xs text-slate-500">{t("aiSupport.inbox.pwa.installAppHint")}</div>
        </div>
        <Download className="h-4 w-4 text-slate-500" />
      </button>
      <Link to="/admin/ai-inbox" className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm">
        <div>
          <div className="text-sm font-semibold text-slate-900">{t("aiSupport.inbox.pwa.openAdminInbox")}</div>
          <div className="text-xs text-slate-500">{t("aiSupport.inbox.pwa.openAdminInboxHint")}</div>
        </div>
        <ChevronLeft className="h-4 w-4 rotate-180 text-slate-500" />
      </Link>
    </div>
  );
}

function SmartphoneIcon() {
  return <MessageCircleMore className="h-5 w-5 text-slate-700" />;
}

// The settings the desktop reaches from its channel rail. On a phone there is no
// rail, so they live behind the Config tab as one sheet.
function SettingsSheet({ open, onClose, items = [] }) {
  const { t } = useTranslation();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9997] flex items-end bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_40px_rgba(15,23,42,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
        <div className="px-1 pb-2 text-[15px] font-semibold text-slate-900">{t("aiSupport.quickReplies.config")}</div>
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
                  {item.hint ? <span className="block truncate text-xs text-slate-500">{item.hint}</span> : null}
                </span>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 rotate-180 text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function HeaderOverflowMenu({ open, anchorRef, onClose, children }) {
  const { t } = useTranslation();
  const [menuStyle, setMenuStyle] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = 208;
      const gap = 8;
      const left = Math.min(Math.max(gap, rect.right - width), Math.max(gap, window.innerWidth - width - gap));
      const top = Math.max(gap, rect.bottom + gap);
      setMenuStyle({
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const menuElement = document.getElementById("ai-inbox-pwa-header-menu");
      const anchor = anchorRef.current;
      if (menuElement?.contains(event.target) || anchor?.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || !menuStyle) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998]" onClick={onClose}>
      <div
        id="ai-inbox-pwa-header-menu"
        role="menu"
        aria-label={t("aiSupport.inbox.pwa.conversationActions")}
        className="isolate overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.28)] ring-1 ring-black/5"
        style={menuStyle}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function AiInboxPwa() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { theme, setTheme } = useTheme();
  const isDarkTheme = theme?.mode === "dark";
  const togglePwaTheme = useCallback(() => setTheme(isDarkTheme ? "light" : "dark"), [isDarkTheme, setTheme]);
  const tenantId = tenantIdFromAuth();
  const conversationParam = clean(params.conversationId);
  const pageVisible = usePageVisible();
  const realtimeStatus = useRealtimeStatus();
  const socketHealthy = realtimeStatus.connected && !realtimeStatus.connecting;
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const quickRepliesStore = useQuickReplies({ headers, tenantId });

  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [messagePlatformFilter, setMessagePlatformFilter] = useState("all");
  const lastRequestedMessagePlatformRef = useRef("all");
  // Parity with /admin/ai-inbox. Read state and the star are filtered in SQL, not
  // over the page this client already holds: the fetch below is "the newest N per
  // channel", so a quiet unread thread — or a starred one older than the window —
  // never arrives, and a client-side filter could only ever report "nothing".
  const [readFilter, setReadFilter] = useState("all"); // all | unread | read
  const [favoriteFilter, setFavoriteFilter] = useState("all"); // all | favorites
  // Which specific WhatsApp number / Facebook page / Instagram account owns the
  // thread. Filtered on the client because the account key is stamped into the
  // conversation metadata the list already carries.
  const [accountFilter, setAccountFilter] = useState("all");
  const [channelAccounts, setChannelAccounts] = useState([]);
  // Where each channel's page ended, so the list can continue past its window.
  // Without a cursor the window IS the inbox — see AI_INBOX_CHANNEL_WINDOW.
  const [listCursors, setListCursors] = useState({});
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const loadingMoreRef = useRef(false);
  const [metaHistorySyncing, setMetaHistorySyncing] = useState(false);
  const [leadFilter, setLeadFilter] = useState("new");
  const canReply = usePermission("ai_inbox_messenger.reply");
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState("reply");
  const [quickRepliesConfigOpen, setQuickRepliesConfigOpen] = useState(false);
  // The settings the desktop workspace hides behind its channel rail: comment
  // automation, the WhatsApp receipt wordings, and the integrations centre.
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [commentsSettingsOpen, setCommentsSettingsOpen] = useState(false);
  const [invoiceMessagesOpen, setInvoiceMessagesOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  useEffect(() => {
    const handleCustomerAction = (event) => {
      const mode = clean(event?.detail?.mode || "chat");
      if (["reply", "private_reply"].includes(mode)) setComposerMode("reply");
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
      setComposerMode("reply");
      setComposerText(`↪ ${sender}: ${quotedText}\n\n`);
      window.setTimeout(() => {
        const editor = document.querySelector('[data-ai-inbox-composer="true"]');
        editor?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        editor?.focus?.();
      }, 80);
    };
    window.addEventListener("m1:ai-inbox-message-reply", handleMessageReply);
    return () => window.removeEventListener("m1:ai-inbox-message-reply", handleMessageReply);
  }, []);
  const [isFullscreenConversation, setIsFullscreenConversation] = useState(false);
  const [editingAiDraft, setEditingAiDraft] = useState(false);
  // The inline edit lives INSIDE the suggestion card, so it never disturbs the
  // manual composer sitting underneath it.
  const [aiSuggestionEditText, setAiSuggestionEditText] = useState("");
  // The operator's product decisions on the suggestion: dropped, swapped for a
  // picked catalogue product, or a ticked multi-select batch.
  const [suggestionProductRemoved, setSuggestionProductRemoved] = useState(false);
  const [suggestionChosenCard, setSuggestionChosenCard] = useState(null);
  const [suggestionRecommendationCards, setSuggestionRecommendationCards] = useState([]);
  const [dismissedAiSuggestionKey, setDismissedAiSuggestionKey] = useState("");
  const [correctionModal, setCorrectionModal] = useState({ open: false, draft: buildReplyCorrectionDraft() });
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiToggling, setAiToggling] = useState(false);
  const [leadActionLoading, setLeadActionLoading] = useState("");
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [orderComposerOpen, setOrderComposerOpen] = useState(false);
  const [orderComposerBusy, setOrderComposerBusy] = useState(false);
  const [productSending, setProductSending] = useState(false);
  // orderMode: picked models go into the order composer's cart instead of being
  // sent to the customer.
  const [availableBySizePickerConfig, setAvailableBySizePickerConfig] = useState({ open: false, sizeMode: false, allowMultiple: false, orderMode: false, selectMode: false, restockMode: false });
  const [composerPicks, setComposerPicks] = useState(null);
  // A batch of variants to watch for a back-in-stock request, handed to the
  // Customer 360 drawer.
  const [restockPick, setRestockPick] = useState(null);
  const [availableBySizeSending, setAvailableBySizeSending] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [conversationHeaderHeight, setConversationHeaderHeight] = useState(0);
  const [userIsNearBottom, setUserIsNearBottom] = useState(true);
  const [aiAssistantGlobalEnabled, setAiAssistantGlobalEnabled] = useState(true);
  const [aiAssistantGlobalSaving, setAiAssistantGlobalSaving] = useState(false);
  const [socialComments, setSocialComments] = useState(() => ({
    items: readSocialCommentsCache(tenantId),
    loading: false,
    error: "",
    next_cursor: "",
  }));
  const [socialCommentsCursor, setSocialCommentsCursor] = useState("");
  const [socialCommentsLoadingMore, setSocialCommentsLoadingMore] = useState(false);
  const [socialReplySettings, setSocialReplySettings] = useState({
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
  });
  const [selectedSocialThread, setSelectedSocialThread] = useState({ post: null, comments: [], loading: false, error: "" });
  const [selectedSocialTemplate, setSelectedSocialTemplate] = useState({ template: null, loading: false, error: "" });
  const [socialMobileDetailOpen, setSocialMobileDetailOpen] = useState(false);
  const [socialCommentsFilter, setSocialCommentsFilter] = useState("all");
  // Facebook and Instagram posts arrive in one list; these narrow it, and narrow
  // the comments inside an open thread, the same way the desktop workspace does.
  const [socialPostsPlatformFilter, setSocialPostsPlatformFilter] = useState("all");
  const [socialThreadPlatformFilter, setSocialThreadPlatformFilter] = useState("all");
  const [socialCommentsDebug, setSocialCommentsDebug] = useState({ request_url: "", tenant_id: "", status: "", count: "", error: "" });
  const [productLinksPost, setProductLinksPost] = useState(null);
  const [socialActionLoading, setSocialActionLoading] = useState("");
  const [customerDrawer, setCustomerDrawer] = useState({ open: false, customer: null, customerId: "", context: {} });
  const mainScrollRef = useRef(null);
  const pinToBottomAfterRefreshRef = useRef(false);
  const conversationHeaderRef = useRef(null);
  const menuButtonRef = useRef(null);
  const imageInputRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const composerEditorRef = useRef(null);
  const pollRef = useRef(null);
  const restoreScrollStateRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const isHydratingConversationRef = useRef(false);
  const isAppendingNewMessageRef = useRef(false);
  // Synchronous in-flight guard for manual sends: a ref (not the async `sending`
  // state) so a rapid double-click cannot start a second send before the first
  // render commits — preventing duplicate outbound messages.
  const manualSendInFlightRef = useRef(false);
  // Its own guard: an upload takes seconds, and the picker can fire twice.
  const attachmentSendingRef = useRef(false);
  const previousConversationKeyRef = useRef("");
  const previousLatestMessageKeyRef = useRef("");
  const markReadSignatureRef = useRef("");
  const messengerProfileSyncAttemptedRef = useRef(new Set());
  const refreshInFlightRef = useRef(false);
  const socialCommentsLoadedRef = useRef(false);
  const socialCommentsRequestRef = useRef(false);
  const requestSeqRef = useRef(0);
  const socialWorkspaceLoadSeqRef = useRef(0);
  const socialWorkspaceLoadStartRef = useRef(0);
  const socialWorkspaceLoadKeyRef = useRef("");
  const refreshQueueRef = useRef(null);
  const requestRefreshRef = useRef(null);
  const markReadLocalUpdateRef = useRef(0);
  const productCatalogRef = useRef({ loading: false, products: [] });
  const refreshStateRef = useRef({
    pageVisible: false,
    socketHealthy: false,
  });

  const openCustomerDrawer = useCallback((customer = {}, context = {}) => {
    const customerProfile = customer?.customer_profile || customer?.profile || {};
    const channelMetadata = customer?.channel_metadata || {};
    const customerId = clean(
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
          [customer.customer_name, customer.commenter_name, customer.author_name, customer.from_name, customerProfile.name, customerProfile.display_name]
            .map((value) => clean(value))
            .find((value) => value && !isGenericCustomerName(value)) ||
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

  const tab = useMemo(() => {
    const value = new URLSearchParams(location.search).get("tab");
    return NAV_ITEMS.some((item) => item.key === value) ? value : "conversations";
  }, [location.search]);
  const socialPostParam = useMemo(() => clean(new URLSearchParams(location.search).get("postId")), [location.search]);
  const inboxSection = tab;
  const isConversationMode = inboxSection === "conversations";
  const isSocialMode = inboxSection === "social_comments";

  const updateUrlState = useCallback(
    ({ nextConversationId = conversationParam, nextPostId = socialPostParam, nextTab = tab, replace = false } = {}) => {
      const searchParams = new URLSearchParams(location.search);
      if (nextTab && nextTab !== "conversations") searchParams.set("tab", nextTab);
      else searchParams.delete("tab");
      if (nextTab === "social_comments" && nextPostId) searchParams.set("postId", nextPostId);
      else searchParams.delete("postId");
      const searchText = searchParams.toString();
      const nextPath = nextTab === "social_comments" ? "/inbox" : nextConversationId ? `/inbox/${encodeConversationId(nextConversationId)}` : "/inbox";
      navigate(`${nextPath}${searchText ? `?${searchText}` : ""}`, { replace });
    },
    [conversationParam, location.search, navigate, socialPostParam, tab]
  );

  const patchConversation = useCallback((targetId, updater) => {
    const normalizedTargetId = normalizeConversationSessionId(targetId);
    const rawTargetId = stripConversationPrefixes(normalizedTargetId).value || clean(targetId);
    setConversations((current) =>
      sortConversationsByActivity(
        current.map((conversation) => {
          const identifiers = conversationIdentifiers(conversation);
          const matches =
            identifiers.conversationKey === normalizedTargetId ||
            identifiers.sessionId === normalizedTargetId ||
            identifiers.sessionId === rawTargetId ||
            identifiers.rawSessionId === normalizedTargetId ||
            identifiers.rawSessionId === rawTargetId ||
            encodeConversationId(identifiers.sessionId) === clean(targetId) ||
            clean(conversation.conversation_key) === clean(targetId);
          return matches ? updater(conversation) : conversation;
        })
      )
    );
  }, []);

  // ---------------------------------------------------------------------
  // Conversation list actions — ported from /admin/ai-inbox so the two
  // surfaces agree on what a star, a read toggle and a page boundary mean.
  // ---------------------------------------------------------------------

  const toggleConversationFavorite = useCallback(async (item) => {
    const sessionId = clean(item?.session_id || item?.conversation_id || "");
    const conversationIdentifier = clean(item?.conversation_key || sessionId);
    if (!sessionId || !conversationIdentifier) return;
    const previousFavorite = item?.is_favorite === true || clean(item?.is_favorite).toLowerCase() === "true";
    const nextFavorite = !previousFavorite;
    // The server writes the conversation row on this call. A request that carries
    // no channel leaves it defaulting to web_chat — one star was enough to
    // relabel a WhatsApp thread "Web Chat".
    const channel = clean(item?.channel || item?.source || "");
    patchConversation(conversationIdentifier, (conversation) => ({ ...conversation, is_favorite: nextFavorite }));
    try {
      const payload = await api.patch(
        aiAgentInboxEndpoint(sessionId, "/favorite"),
        { tenant_id: tenantId, is_favorite: nextFavorite, ...(channel ? { channel } : {}) },
        { headers, perfComponent: "AiInboxPwa.toggleFavorite" }
      );
      const updatedConversation = payload?.conversation || {};
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        ...updatedConversation,
        is_favorite: updatedConversation.is_favorite === undefined ? nextFavorite : Boolean(updatedConversation.is_favorite),
      }));
    } catch (err) {
      patchConversation(conversationIdentifier, (conversation) => ({ ...conversation, is_favorite: previousFavorite }));
      toast.error(err?.message || t("aiSupport.inbox.pwa.favoriteFailed"));
    }
  }, [headers, patchConversation, t, tenantId]);

  // Marking read reuses the same /read endpoint the auto-mark-on-open effect
  // uses; marking unread persists a manually_unread flag on the server so it
  // survives the next refetch.
  const toggleConversationRead = useCallback(async (item) => {
    const sessionId = clean(item?.session_id || item?.conversation_id || "");
    const conversationIdentifier = clean(item?.conversation_key || sessionId);
    if (!sessionId || !conversationIdentifier) return;
    const previousUnreadCount = Number(item?.unread_count || item?.unread || 0);
    const previousManuallyUnread = item?.manually_unread === true;
    const currentlyUnread = previousUnreadCount > 0 || previousManuallyUnread;
    const channel = clean(item?.channel || item?.source || "");
    if (currentlyUnread) {
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        unread_count: 0,
        unseen_count: 0,
        pending_count: 0,
        unread: false,
        manually_unread: false,
        read_at: new Date().toISOString(),
      }));
      try {
        await api.post(
          aiInboxConversationEndpoint(sessionId, "/read"),
          { tenant_id: tenantId, conversation_id: sessionId, channel },
          { headers, perfComponent: "AiInboxPwa.markReadManual" }
        );
      } catch (err) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          unread_count: previousUnreadCount,
          unread: previousUnreadCount > 0 || previousManuallyUnread,
          manually_unread: previousManuallyUnread,
        }));
        toast.error(err?.message || t("aiSupport.inbox.pwa.markReadFailed"));
      }
      return;
    }
    patchConversation(conversationIdentifier, (conversation) => ({
      ...conversation,
      unread_count: 1,
      unread: true,
      manually_unread: true,
      read_at: null,
    }));
    try {
      await api.post(
        aiInboxConversationEndpoint(sessionId, "/unread"),
        { tenant_id: tenantId, conversation_id: sessionId, channel },
        { headers, perfComponent: "AiInboxPwa.markUnread" }
      );
    } catch (err) {
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        unread_count: previousUnreadCount,
        unread: previousUnreadCount > 0 || previousManuallyUnread,
        manually_unread: previousManuallyUnread,
      }));
      toast.error(err?.message || t("aiSupport.inbox.pwa.markUnreadFailed"));
    }
  }, [headers, patchConversation, t, tenantId]);

  // The product sheet used to await the WHOLE catalog before it rendered a single
  // row, on every open. It now paints the persisted snapshot first (no network at
  // all) and revalidates behind it, so an open with a warm snapshot is instant and
  // the multi-MB download only happens when the catalog watermark actually moved.
  const loadProducts = useCallback(async ({ force = false } = {}) => {
    if (productCatalogRef.current.loading || (!force && productCatalogRef.current.products.length)) return;
    productCatalogRef.current.loading = true;
    setProductLoading(true);
    try {
      const { products: nextProducts } = await loadCustomerProductCatalog({ headers });
      const normalizedProducts = asArray(nextProducts);
      productCatalogRef.current.products = normalizedProducts;
      setProducts(normalizedProducts);
    } catch (loadError) {
      toast.error(loadError?.message || "Failed to load products");
    } finally {
      productCatalogRef.current.loading = false;
      setProductLoading(false);
    }
  }, [headers]);

  const loadSocialComments = useCallback(
    async ({ silent = false, cursor = "", append = false } = {}) => {
      if (socialCommentsRequestRef.current && !append) return;
      socialCommentsRequestRef.current = true;
      if (!silent) setSocialComments((current) => ({ ...current, loading: true, error: "" }));
      setSocialCommentsDebug((current) => ({ ...current, error: "" }));

      const postsRequestUrl = `/api/social-comments/posts?tenant_id=${encodeURIComponent(tenantId)}&limit=200&include_product_links=1`;
      const fastRequestUrl = `/api/social-comments/fast-list?tenant_id=${encodeURIComponent(tenantId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const perfLabel = "AiInboxPwa.socialCommentsPosts";
      if (DEBUG_SOCIAL_PERF) console.time(perfLabel);
      const settingsPromise = api
        .get("/social-comments/auto-reply/settings", {
          params: { tenant_id: tenantId },
          headers,
          timeoutMs: 10000,
          perfComponent: "AiInboxPwa.socialCommentsSettings",
        })
        .catch(() => ({ settings: null }));

      const readListPayload = async () => {
        if (!cursor) {
          try {
            const payload = await api.get("/social-comments/posts", {
              // Include persisted mappings so a product linked to a post remains
              // visibly linked after the PWA is reopened or refreshed.
              params: { tenant_id: tenantId, limit: 200, include_product_links: 1 },
              headers,
              timeoutMs: 30000,
              perfComponent: "AiInboxPwa.socialCommentsPosts",
            });
            return { payload, request_url: postsRequestUrl, fast: false };
          } catch (postsError) {
            console.warn("[AiInboxPwa][social-comments-posts-fallback]", {
              tenant_id: tenantId,
              message: postsError?.message || "",
            });
          }
        }

        const payload = await api.get("/social-comments/fast-list", {
          params: { tenant_id: tenantId, limit: 20, cursor },
          headers,
          timeoutMs: 15000,
          perfComponent: "AiInboxPwa.socialCommentsFastList",
        });
        return { payload, request_url: fastRequestUrl, fast: true };
      };

      try {
        const { payload, request_url, fast } = await readListPayload();
        const rawItems = asArray(payload?.posts || payload?.items || payload?.data?.posts || payload?.data?.items || payload);
        const items = fast ? rawItems.map(normalizeFastSocialCommentItem) : rawItems.map(normalizeSocialPostForPwa);
        setSocialComments((current) => {
          const currentItems = asArray(current.items);
          const cachedItems = readSocialCommentsCache(tenantId);
          const nextItems = append
            ? [...currentItems, ...items]
            : items.length
              ? items
              : currentItems.length
                ? currentItems
                : cachedItems;
          if (nextItems.length) writeSocialCommentsCache(tenantId, nextItems);
          return {
            items: nextItems,
            loading: false,
            error: "",
            next_cursor: fast ? clean(payload?.next_cursor || payload?.data?.next_cursor || "") : "",
          };
        });
        setSocialCommentsCursor(fast ? clean(payload?.next_cursor || payload?.data?.next_cursor || "") : "");
        // Render the posts as soon as their request completes. Reply settings
        // are independent and must not keep the whole Social Comments screen
        // in a loading state when that endpoint is slower.
        void settingsPromise.then((settingsPayload) => {
          setSocialReplySettings({
            generic_enabled: Boolean(settingsPayload?.settings?.generic_enabled),
            generic_like_enabled: settingsPayload?.settings?.generic_like_enabled !== false,
            generic_reply_enabled: settingsPayload?.settings?.generic_reply_enabled !== false,
            generic_template: clean(settingsPayload?.settings?.generic_template || ""),
            mode: clean(settingsPayload?.settings?.mode || "manual_approval") || "manual_approval",
          });
        });
        setSocialCommentsDebug({
          request_url,
          tenant_id: tenantId,
          status: Number(payload?.__status || 200) || 200,
          count: items.length,
          error: "",
        });
      } catch (socialCommentsError) {
        const status = Number(socialCommentsError?.status || socialCommentsError?.responseBody?.status || 0) || "";
        const message = socialCommentsError?.responseBody?.message || socialCommentsError?.message || "تعذر تحميل منشورات التعليقات";
        setSocialComments((current) => ({
          items: Array.isArray(current.items) && current.items.length
            ? current.items
            : readSocialCommentsCache(tenantId),
          loading: false,
          error: message,
          next_cursor: current?.next_cursor || "",
        }));
        setSocialCommentsDebug({
          request_url: postsRequestUrl,
          tenant_id: tenantId,
          status,
          count: 0,
          error: message,
        });
      } finally {
        socialCommentsRequestRef.current = false;
        if (!append) {
          socialCommentsLoadedRef.current = true;
        }
        if (DEBUG_SOCIAL_PERF) console.timeEnd(perfLabel);
      }
    },
    [headers, tenantId]
  );

  const loadMoreSocialComments = useCallback(async () => {
    if (!socialCommentsCursor || socialCommentsLoadingMore) return;
    setSocialCommentsLoadingMore(true);
    try {
      await loadSocialComments({ silent: true, cursor: socialCommentsCursor, append: true });
    } finally {
      setSocialCommentsLoadingMore(false);
    }
  }, [loadSocialComments, socialCommentsCursor, socialCommentsLoadingMore]);

  const loadConversations = useCallback(
    async ({ silent = false } = {}) => {
      refreshInFlightRef.current = true;
      isHydratingConversationRef.current = true;
      // Snapshot whether the transcript is pinned to the bottom BEFORE the reload mutates
      // the DOM, so a refresh keeps the user on the latest messages instead of snapping to
      // the top of the thread. Read synchronously here (pre-fetch) so it can't race a
      // scroll-reset event fired during the re-render.
      {
        const pinScroller = mainScrollRef.current;
        pinToBottomAfterRefreshRef.current = Boolean(
          pinScroller && pinScroller.scrollHeight - pinScroller.scrollTop - pinScroller.clientHeight <= 140
        );
      }
      const seq = ++requestSeqRef.current;
      if (!silent) setLoading(true);
      setError("");
      try {
        // Fair per-channel retrieval, same rule the desktop workspace uses. One
        // global limit lets the largest channel evict the others: 197 WhatsApp
        // threads filled a 200-row page in production and the 2nd Messenger
        // conversation never reached the client at all. Each channel gets its own
        // guaranteed window and the pages merge here. A selected tab is exactly
        // one request — never fetch-all-and-filter.
        //
        // A refresh also restarts paging: the filters that define the result set
        // may have changed, so a cursor taken against the previous set would page
        // into a list that no longer exists.
        const requestedChannels = channelsForFilter(messagePlatformFilter);
        setListCursors({});
        const settled = await Promise.allSettled(requestedChannels.map((backendChannel) =>
          api.get("/ai-inbox/conversations", {
            params: {
              tenant_id: tenantId,
              search: debouncedSearch,
              channel_filter: backendChannel,
              limit: channelWindow(backendChannel),
              message_limit: conversationParam ? 50 : 20,
              read_filter: readFilter,
              ...(favoriteFilter === "all" ? {} : { favorite_only: 1 }),
            },
            headers,
            timeoutMs: 20000,
            perfComponent: `AiInboxPwa.conversations.${backendChannel}`,
          }).then((channelPayload) => {
            setListCursors((current) => ({
              ...current,
              [backendChannel]: channelPayload?.has_more ? channelPayload?.next_cursor || null : null,
            }));
            return asArray(channelPayload?.conversations);
          })
        ));
        if (seq !== requestSeqRef.current) return;
        // Failure isolation: one bad channel must not blank the inbox.
        const channelPages = settled.map((result, index) => {
          if (result.status === "fulfilled") return result.value;
          console.warn("[ai-inbox-pwa] channel page failed", requestedChannels[index], result.reason?.message || result.reason);
          return [];
        });
        if (settled.every((result) => result.status === "rejected") && settled.length) {
          throw settled[0].reason;
        }
        const payload = { conversations: mergeConversationPages(channelPages, conversationKey) };

        const nextConversations = asArray(payload.conversations)
          .map((conversation) => ({
            ...conversation,
            session_id: normalizeConversationSessionId(
              conversation.session_id || conversation.external_conversation_id || conversation.conversation_id || conversation.id,
              conversation.channel || conversation.source || conversation.provider || conversation.platform || ""
            ),
            conversation_id: normalizeConversationSessionId(
              conversation.conversation_id || conversation.id || conversation.session_id,
              conversation.channel || conversation.source || conversation.provider || conversation.platform || ""
            ),
            conversation_key: normalizeConversationSessionId(
              conversation.conversation_key || conversation.session_id || conversation.external_conversation_id || conversation.conversation_id || conversation.id,
              conversation.channel || conversation.source || conversation.provider || conversation.platform || ""
            ),
            messages: uniqueMessages(conversation.messages),
            conversationHydrated: conversationHydrationState(conversation),
          }))
          .sort((left, right) => {
            const leftTime = new Date(left.last_activity_at || left.updated_at || 0).getTime() || 0;
            const rightTime = new Date(right.last_activity_at || right.updated_at || 0).getTime() || 0;
            return rightTime - leftTime;
          });

        setConversations((current) => {
          const activeConversationKeys = normalizeRealtimeConversationKeys({ session_id: conversationParam });
          return sortConversationsByActivity(
            nextConversations.map((nextConversation) => {
              const existingConversation = current.find((conversation) =>
                conversationMatchesIdentifiers(conversation, conversationIdentifiers(nextConversation))
              );
              if (
                existingConversation &&
                conversationMatchesRealtimeKeys(existingConversation, activeConversationKeys) &&
                existingConversation.conversationHydrated === true
              ) {
                return mergeConversationSummaryRefresh(existingConversation, nextConversation);
              }
              return existingConversation
                ? {
                    ...existingConversation,
                    ...nextConversation,
                    conversationHydrated: conversationHydrationState(nextConversation),
                  }
                : nextConversation;
            })
          );
        });
        setLoading(false);
        void api.get("/ai-agent/settings/ai-assistant-global", {
          params: { tenant_id: tenantId },
          headers,
          timeoutMs: 10000,
          perfComponent: "AiInboxPwa.globalAi",
        }).then((globalAiPayload) => {
          if (seq === requestSeqRef.current) {
            setAiAssistantGlobalEnabled(globalAiPayload?.ai_assistant_global_enabled !== false);
          }
        }).catch(() => {});
        if (tab === "social_comments" && !socialCommentsLoadedRef.current && !socialCommentsRequestRef.current) {
          void loadSocialComments({ silent });
        }

        if (conversationParam) {
          const normalizedConversationParam = normalizeConversationSessionId(conversationParam);
          const exists = nextConversations.some(
            (conversation) =>
              normalizeConversationSessionId(conversation.session_id, conversation.channel || conversation.source || conversation.provider || conversation.platform || "") === normalizedConversationParam ||
              normalizeConversationSessionId(conversation.conversation_key, conversation.channel || conversation.source || conversation.provider || conversation.platform || "") === normalizedConversationParam ||
              stripConversationPrefixes(conversation.session_id).value === stripConversationPrefixes(normalizedConversationParam).value ||
              stripConversationPrefixes(conversation.conversation_key).value === stripConversationPrefixes(normalizedConversationParam).value ||
              encodeConversationId(conversation.session_id) === clean(conversationParam)
          );
          if (!exists && tab === "conversations") {
            const fallbackIdentifiers = conversationIdentifiers(nextConversations[0] || {});
            const nextConversationId = clean(fallbackIdentifiers.conversationKey || fallbackIdentifiers.sessionId || fallbackIdentifiers.conversationId || "");
            if (nextConversationId) {
              updateUrlState({ nextConversationId, replace: true });
            }
          }
        }
      } catch (loadError) {
        setError(loadError?.message || "Failed to load AI Social Media Center");
      } finally {
        setLoading(false);
        refreshInFlightRef.current = false;
        window.requestAnimationFrame(() => {
          isHydratingConversationRef.current = false;
        });
        const queuedRefresh = refreshQueueRef.current;
        if (queuedRefresh && refreshStateRef.current.pageVisible) {
          refreshQueueRef.current = null;
          // A queued refresh always runs AFTER an initial load has already
          // completed, so it is a background refresh: force it silent so it
          // never re-raises the blocking full-screen spinner over data that is
          // already on screen.
          requestRefreshRef.current?.(queuedRefresh.source, {
            silent: true,
            force: true,
          });
        }
      }
    },
    [conversationParam, debouncedSearch, favoriteFilter, headers, loadSocialComments, messagePlatformFilter, pageVisible, readFilter, tab, tenantId, updateUrlState]
  );

  const requestRefresh = useCallback(
    (source = "manual", { silent = true, force = false } = {}) => {
      const queueLength = refreshQueueRef.current ? 1 : 0;
      const debugPayload = {
        source,
        page_visible: pageVisible,
        socket_healthy: socketHealthy,
        queue_length: queueLength,
        in_flight: refreshInFlightRef.current,
      };
      const log = (label, payload = {}) => {
        if (!DEBUG_SOCIAL_PERF || typeof console === "undefined") return;
        console.info(label, payload);
      };

      if (!pageVisible && source === "polling") {
        log("REFRESH_SKIPPED_DUPLICATE", { ...debugPayload, reason: "page_hidden" });
        return;
      }

      if (!pageVisible && source !== "visibility") {
        if (!refreshQueueRef.current) {
          refreshQueueRef.current = { source, silent };
          log("REFRESH_QUEUE_LENGTH", { ...debugPayload, queue_length: 1 });
        } else {
          log("REFRESH_SKIPPED_DUPLICATE", debugPayload);
        }
        return;
      }

      if (refreshInFlightRef.current) {
        if (!refreshQueueRef.current) {
          refreshQueueRef.current = { source, silent };
          log("REFRESH_QUEUE_LENGTH", { ...debugPayload, queue_length: 1 });
        } else {
          log("REFRESH_SKIPPED_DUPLICATE", debugPayload);
        }
        return;
      }

      if (refreshQueueRef.current && !force) {
        log("REFRESH_SKIPPED_DUPLICATE", debugPayload);
        return;
      }

      if (refreshQueueRef.current && force) {
        refreshQueueRef.current = null;
        log("REFRESH_QUEUE_LENGTH", { ...debugPayload, queue_length: 0 });
      }

      const sourceLabel =
        source === "socket"
          ? "REFRESH_SOURCE_SOCKET"
          : source === "polling"
            ? "REFRESH_SOURCE_POLLING"
            : source === "visibility"
              ? "REFRESH_SOURCE_VISIBILITY"
              : "REFRESH_SOURCE_MANUAL";
      log(sourceLabel, { ...debugPayload, queue_length: 0 });
      void loadConversations({ silent });
    },
    [loadConversations, pageVisible, socketHealthy]
  );

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  // Unread means "waiting for a reply", so this button discards the whole work
  // queue. Two things follow: it must SAY what it is about to clear, and it must
  // clear only what the operator can actually see — firing it while a channel tab
  // is selected used to wipe every other channel too.
  const markAllConversationsRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    const previousConversations = conversations;
    const scopeChannel = backendChannelFilter(messagePlatformFilter);
    const inScope = (conversation) =>
      !scopeChannel || backendChannelFilter(normalizeConversationChannel(conversation)) === scopeChannel;
    const isUnread = (conversation) =>
      Number(conversation?.unread_count || conversation?.unread || 0) > 0 || conversation?.manually_unread === true;
    const targets = previousConversations.filter((conversation) => inScope(conversation) && isUnread(conversation));
    if (!targets.length) return;

    const scopeLabel = scopeChannel ? t(channelMeta(scopeChannel).labelKey) : t("aiSupport.inbox.ui.markAllReadScopeAll");
    if (!window.confirm(t("aiSupport.inbox.ui.markAllReadConfirm", { count: targets.length, scope: scopeLabel }))) return;

    const targetKeys = new Set(targets.map((conversation) => conversationKey(conversation)));
    setConversations((current) =>
      current.map((conversation) =>
        targetKeys.has(conversationKey(conversation))
          ? {
            ...conversation,
            unread_count: 0,
            unseen_count: 0,
            pending_count: 0,
            unread: false,
            manually_unread: false,
            read_at: readAt,
          }
          : conversation
      )
    );
    try {
      await api.post(
        "/ai-inbox/conversations/read-all",
        { tenant_id: tenantId, ...(scopeChannel ? { channel: scopeChannel } : {}) },
        { headers, perfComponent: "AiInboxPwa.markAllRead" }
      );
      toast.success(t("aiSupport.inbox.ui.markAllReadDone", { count: targets.length }));
    } catch (err) {
      setConversations(previousConversations);
      toast.error(err?.message || t("aiSupport.inbox.ui.markAllReadFailed"));
    }
  }, [conversations, headers, messagePlatformFilter, t, tenantId]);

  const hasMoreConversations = useMemo(
    () => channelsForFilter(messagePlatformFilter).some((backendChannel) => clean(listCursors?.[backendChannel]?.session_id)),
    [listCursors, messagePlatformFilter]
  );

  // One request per channel that still has a cursor, so a channel that has run
  // out does not keep asking. Pages merge through mergeConversationPages — the
  // same function the first load uses — so a conversation that moved between
  // pages collapses instead of appearing twice.
  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const channels = channelsForFilter(messagePlatformFilter)
      .filter((backendChannel) => clean(listCursors?.[backendChannel]?.session_id));
    if (!channels.length) return;
    loadingMoreRef.current = true;
    setLoadingMoreConversations(true);
    try {
      const pages = await Promise.all(channels.map((backendChannel) => api.get("/ai-inbox/conversations", {
        params: {
          tenant_id: tenantId,
          channel_filter: backendChannel,
          search: debouncedSearch,
          limit: channelWindow(backendChannel),
          read_filter: readFilter,
          ...(favoriteFilter === "all" ? {} : { favorite_only: 1 }),
          before_activity_at: listCursors[backendChannel].activity_at,
          before_session_id: listCursors[backendChannel].session_id,
        },
        headers,
        perfComponent: `AiInboxPwa.conversationsPage.${backendChannel}`,
      }).then((payload) => {
        setListCursors((current) => ({ ...current, [backendChannel]: payload?.has_more ? payload?.next_cursor || null : null }));
        return asArray(payload?.conversations);
      }).catch((err) => {
        // One channel running out of pages must not stop the others.
        console.warn("[ai-inbox-pwa] next page failed", backendChannel, err?.message || err);
        setListCursors((current) => ({ ...current, [backendChannel]: null }));
        return [];
      })));
      setConversations((current) => sortConversationsByActivity(
        mergeConversationPages([current, ...pages], conversationKey).map((item) => ({
          ...item,
          session_id: normalizeConversationSessionId(
            item.session_id || item.external_conversation_id || item.conversation_id || item.id,
            item.channel || item.source || item.provider || item.platform || ""
          ),
          conversation_key: item.conversation_key || conversationKey(item),
          messages: uniqueMessages(item.messages),
          conversationHydrated: item.conversationHydrated ?? conversationHydrationState(item),
        }))
      ));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreConversations(false);
    }
  }, [debouncedSearch, favoriteFilter, headers, listCursors, messagePlatformFilter, readFilter, tenantId]);

  // Historical Meta sync — webhooks only carry new events, so this asks the
  // backend to pull the page's existing Messenger + Instagram DM threads from the
  // Graph API into the inbox (safe to re-run; deduped by Meta message id).
  const syncMetaConversations = useCallback(async () => {
    if (metaHistorySyncing) return;
    setMetaHistorySyncing(true);
    try {
      const payload = await api.post(
        "/ai-inbox/sync-meta-conversations",
        { tenant_id: tenantId, conversation_limit: 200 },
        { headers, perfComponent: "AiInboxPwa.syncMetaConversations" }
      );
      if (payload?.success === false) {
        toast.error(payload?.message || t("aiSupport.inbox.pwa.metaSyncFailed"));
        setMetaHistorySyncing(false);
        return;
      }
      if (payload?.already_running) {
        // Keep the spinner: the running sync's done event will clear it.
        toast(t("aiSupport.inbox.pwa.metaSyncAlreadyRunning"));
        return;
      }
      toast.success(t("aiSupport.inbox.pwa.metaSyncStarted"));
    } catch (err) {
      toast.error(err?.message || t("aiSupport.inbox.pwa.metaSyncFailed"));
      setMetaHistorySyncing(false);
    }
  }, [headers, metaHistorySyncing, t, tenantId]);

  // Completion of the background Meta sync (and a safety valve: never let the
  // spinner outlive a lost socket event by more than 8 minutes).
  useEffect(() => {
    const onMetaSyncDone = (payload = {}) => {
      setMetaHistorySyncing(false);
      const facebook = payload?.facebook || {};
      const instagram = payload?.instagram || {};
      toast.success(t("aiSupport.inbox.pwa.metaSyncDone", {
        facebook: Number(facebook.conversations_synced || 0),
        instagram: Number(instagram.conversations_synced || 0),
      }));
      requestRefreshRef.current?.("meta-sync-done", { silent: true, force: true });
    };
    return subscribeRealtime("ai_inbox:meta_sync_done", onMetaSyncDone);
  }, [t]);
  useEffect(() => {
    if (!metaHistorySyncing) return undefined;
    const timer = window.setTimeout(() => setMetaHistorySyncing(false), 8 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [metaHistorySyncing]);

  // The account registry is not needed to render conversations, so it loads once
  // out of band. A tenant with a single number per platform never sees it.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api.get("/ai-agent/channel-accounts", {
      params: { tenant_id: tenantId },
      headers,
      perfComponent: "AiInboxPwa.channelAccounts",
    })
      .then((payload) => {
        if (!cancelled) setChannelAccounts(asArray(payload?.accounts));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [headers, tenantId]);

  useEffect(() => {
    if (lastRequestedMessagePlatformRef.current === messagePlatformFilter) return;
    lastRequestedMessagePlatformRef.current = messagePlatformFilter;
    setAccountFilter("all");
    requestRefresh("platform_filter", { silent: false, force: true });
  }, [messagePlatformFilter, requestRefresh]);

  // read_filter and favorite_only are server-side clauses, so changing either has
  // to refetch — the rows that match may not be in the page currently held.
  const lastRequestedListFiltersRef = useRef("all|all");
  useEffect(() => {
    const signature = `${readFilter}|${favoriteFilter}`;
    if (lastRequestedListFiltersRef.current === signature) return;
    lastRequestedListFiltersRef.current = signature;
    requestRefresh("list_filter", { silent: false, force: true });
  }, [favoriteFilter, readFilter, requestRefresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = buildPageTitle("AI Social Media Center");
      document.documentElement.style.backgroundColor = "#f8fafc";
      document.body.style.backgroundColor = "#f8fafc";
    }
    try {
      localStorage.setItem("ai_inbox_last_url", `${location.pathname}${location.search}`);
      localStorage.setItem("portal_last_url", `${location.pathname}${location.search}`);
    } catch {
      // Ignore storage errors.
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    // `?v=` must move with VERSION inside inbox-sw.js, or clients keep running the
    // old worker and the cache-first `/assets/` rule strands them on a stale bundle.
    navigator.serviceWorker.register("/inbox-sw.js?v=16", { scope: "/inbox" }).catch(() => null);
    return undefined;
  }, []);

  useEffect(() => {
    primeInboxChime();
    // Push endpoints rotate. Re-subscribing on load keeps the stored one live,
    // otherwise notifications stop with nothing on screen to explain why.
    refreshInboxPushSubscription({ surface: "/inbox" }).catch(() => null);
    return subscribeToPushWorkerMessages();
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);


  useEffect(() => {
    if (!productSheetOpen) return;
    void loadProducts();
  }, [loadProducts, productSheetOpen]);

  useEffect(() => {
    if (!orderComposerOpen) return;
    void loadProducts();
  }, [loadProducts, orderComposerOpen]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!pageVisible) return undefined;
    const pollIntervalMs = socketHealthy ? 60000 : 24000;
    pollRef.current = window.setInterval(() => {
      requestRefresh("polling", { silent: true });
    }, pollIntervalMs);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [pageVisible, requestRefresh, socketHealthy]);

  useEffect(() => {
    const previous = refreshStateRef.current;
    refreshStateRef.current = { pageVisible, socketHealthy };

    if (!pageVisible) return;

    if (!previous.pageVisible) {
      const isInitialLoad = requestSeqRef.current === 0;
      requestRefresh("visibility", { silent: !isInitialLoad, force: true });
      return;
    }

    if (!previous.socketHealthy && socketHealthy) {
      requestRefresh("socket", { silent: true, force: true });
    }
  }, [pageVisible, requestRefresh, socketHealthy]);

  useEffect(() => {
    const onMessage = (payload = {}) => {
      try {
        const normalizedPayload = normalizeRealtimeConversationKeys(payload);
        if (normalizedPayload.tenantId && normalizedPayload.tenantId !== clean(tenantId)) return;
        if (!normalizedPayload.message || (!normalizedPayload.sessionId && !normalizedPayload.conversationKey && !normalizedPayload.rawSessionId)) return;

        const incomingMessage = normalizedPayload.message;
        // Sound + notification for inbound customer messages. Fires before the
        // list patch below so the chime is not held up by the state work, and it
        // no-ops on our own AI/staff replies.
        handleInboundInboxMessage({
          message: incomingMessage,
          conversationId: normalizedPayload.sessionId || normalizedPayload.conversationKey || normalizedPayload.rawSessionId || "",
          channel: payload.channel || incomingMessage.channel || incomingMessage.source || "",
          surface: "/inbox",
        }).catch(() => null);
        const incomingCards = normalizeMessageProductCards(incomingMessage);
        const incomingPreview =
          messageDisplayText(incomingMessage) ||
          (incomingCards.length ? productCardPreviewText(incomingCards) : "") ||
          incomingMessage.latest_message_preview ||
          incomingMessage.last_message_preview ||
          "";
        const currentConversationIds = {
          sessionId: normalizedPayload.sessionId,
          rawSessionId: normalizedPayload.rawSessionId,
          conversationKey: normalizedPayload.conversationKey,
          conversationId: normalizedPayload.conversationKey,
          messageId: incomingMessage.id,
          providerMessageId: incomingMessage.provider_message_id || incomingMessage.providerMessageId,
          externalMessageId: incomingMessage.external_message_id || incomingMessage.externalMessageId,
        };
        const activeConversationKeys = normalizeRealtimeConversationKeys({ session_id: conversationParam });
        let matchedConversation = false;

        setConversations((current) => {
          const nextConversations = asArray(current).map((conversation) => {
            if (!conversationMatchesRealtimeKeys(conversation, currentConversationIds)) return conversation;
            matchedConversation = true;
            if (conversationMatchesRealtimeKeys(conversation, activeConversationKeys)) {
              isAppendingNewMessageRef.current = true;
            }

            const existingMessages = asArray(conversation.messages);
            const normalizedMessage = normalizeInboxMessage({
              ...incomingMessage,
              product_cards: incomingCards,
              productCards: incomingCards,
            });
            const nextMessages = mergeMessagesByIdentity([...existingMessages, normalizedMessage]);
            const isInbound = normalizeMessageDirection(normalizedMessage) === "inbound";
            const unreadCount = conversationUnreadCount(conversation);
            const isStaffReply = clean(normalizedMessage.sender_type).toLowerCase() === "staff";
            const nextUnreadCount = isInbound
              ? Math.max(1, unreadCount + 1)
              : isStaffReply
                ? 0
                : unreadCount;
            const nextTimestamp = normalizedMessage.created_at || normalizedMessage.updated_at || new Date().toISOString();

            return {
              ...conversation,
              messages: nextMessages,
              message_count: Math.max(Number(conversation.message_count || existingMessages.length), nextMessages.length),
              latest_message_preview: incomingPreview || conversation.latest_message_preview,
              last_message_preview: incomingPreview || conversation.last_message_preview,
              last_message: incomingPreview || conversation.last_message || "",
              last_message_at: nextTimestamp,
              last_activity_at: nextTimestamp,
              updated_at: nextTimestamp,
              last_product_cards: incomingCards.length ? incomingCards : conversation.last_product_cards,
              latest_product_cards: incomingCards.length ? incomingCards : conversation.latest_product_cards,
              unread_count: nextUnreadCount,
              pending_count: nextUnreadCount,
              unread: nextUnreadCount > 0,
              channel_metadata: {
                ...(conversation.channel_metadata || {}),
                last_message: incomingPreview || conversation.channel_metadata?.last_message || "",
                last_product_cards: incomingCards.length ? incomingCards : conversation.channel_metadata?.last_product_cards || [],
              },
            };
          });

          if (!matchedConversation) return current;
          return sortConversationsByActivity(nextConversations);
        });
      } catch (error) {
        console.warn("[AiInboxPwa][realtime-message-error]", {
          event: "ai_inbox:message",
          tenant_id: clean(tenantId),
          conversation_id: clean(payload?.session_id || payload?.sessionId || payload?.conversation_id || payload?.conversationId || payload?.conversation_key || payload?.conversationKey || ""),
          message_id: clean(payload?.message?.id || payload?.message?.provider_message_id || payload?.message?.providerMessageId || payload?.message?.external_message_id || payload?.message?.externalMessageId || ""),
          error: error?.message || String(error || ""),
        });
      }
    };

    const onRefresh = (payload = {}) => {
      try {
        const payloadTenantId = clean(payload.tenant_id || payload.tenantId || "");
        if (payloadTenantId && payloadTenantId !== clean(tenantId)) return;
        requestRefresh("socket", { silent: true, force: true });
      } catch (error) {
        console.warn("[AiInboxPwa][realtime-refresh-error]", {
          event: "ai_inbox:refresh",
          tenant_id: clean(tenantId),
          conversation_id: clean(payload?.session_id || payload?.sessionId || payload?.conversation_id || payload?.conversationId || payload?.conversation_key || payload?.conversationKey || ""),
          error: error?.message || String(error || ""),
        });
      }
    };

    const offMessage = subscribeRealtime("ai_inbox:message", onMessage);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", onRefresh);
    return () => {
      offMessage();
      offRefresh();
    };
  }, [conversationParam, requestRefresh, tenantId]);

  useEffect(() => {
    if (!ENABLE_SOCIAL_FAST_CENTER) return undefined;

    const patchSocialComment = (payload = {}, { matchOnly = false } = {}) => {
      const normalizedPayload = normalizeFastSocialCommentItem(payload);
      if (!normalizedPayload.id && !normalizedPayload.external_comment_id && !normalizedPayload.post_id) return;

      setSocialComments((current) => {
        const currentItems = asArray(current.items);
        const matchIndex = currentItems.findIndex((item) => fastSocialCommentItemMatches(item, normalizedPayload));
        if (matchOnly && matchIndex < 0) return current;

        const nextItem = matchIndex >= 0
          ? mergeFastSocialCommentItem(currentItems[matchIndex], {
              ...normalizedPayload,
              comments_count: undefined,
              new_comments_count: undefined,
            })
          : normalizedPayload;
        if (matchIndex >= 0 && fastSocialCommentItemsEqual(currentItems[matchIndex], nextItem)) {
          return current;
        }
        const nextItems = matchIndex >= 0
          ? [nextItem, ...currentItems.filter((_, index) => index !== matchIndex)]
          : [nextItem, ...currentItems];
        if (nextItems.length === currentItems.length && nextItems.every((item, index) => item === currentItems[index])) return current;

        return {
          ...current,
          items: nextItems.slice(0, 100),
          loading: false,
          error: "",
        };
      });
    };

    let socketPatchCount = 0;
    const offNew = subscribeRealtime("social_comment:new", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) socketPatchCount += 1;
      patchSocialComment(payload, { matchOnly: false });
    });
    const offUpdated = subscribeRealtime("social_comment:updated", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) socketPatchCount += 1;
      patchSocialComment(payload, { matchOnly: true });
    });
    const offReplyStatus = subscribeRealtime("social_comment:reply_status", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) socketPatchCount += 1;
      patchSocialComment(payload, { matchOnly: true });
    });
    return () => {
      if (DEBUG_SOCIAL_PERF) console.log("[AiInboxPwa][social-comment-socket-patch-count]", socketPatchCount);
      offNew();
      offUpdated();
      offReplyStatus();
    };
  }, []);

  // Multi-account: active registry rows grouped by platform. The account badge
  // and sub-filter only appear for a platform with MORE than one account — a
  // single-number tenant sees exactly the inbox it had before.
  const accountsByPlatform = useMemo(() => {
    const grouped = new Map();
    for (const account of asArray(channelAccounts)) {
      if (account?.is_active === false) continue;
      const platform = clean(account?.platform).toLowerCase();
      if (!platform) continue;
      if (!grouped.has(platform)) grouped.set(platform, []);
      grouped.get(platform).push(account);
    }
    return grouped;
  }, [channelAccounts]);
  // account key (instance name / page id / IG id) -> display label, per platform.
  const accountDirectory = useMemo(() => {
    const directory = new Map();
    for (const account of asArray(channelAccounts)) {
      const platform = clean(account?.platform).toLowerCase();
      const label = clean(account?.display_name) || clean(account?.external_account_id);
      if (!platform || !label) continue;
      for (const key of [clean(account?.external_account_id), clean(account?.metadata?.page_id)]) {
        if (key) directory.set(`${platform}:${key}`, label);
      }
    }
    return directory;
  }, [channelAccounts]);
  const conversationAccountLabel = useCallback((conversation = {}) => {
    const platform = normalizeConversationChannel(conversation);
    if ((accountsByPlatform.get(platform) || []).length < 2) return "";
    const key = conversationAccountKey(conversation);
    if (!key) return "";
    return accountDirectory.get(`${platform}:${key}`) || key;
  }, [accountDirectory, accountsByPlatform]);
  const accountFilterOptions = useMemo(() => {
    const platform = backendChannelFilter(messagePlatformFilter);
    const accounts = accountsByPlatform.get(platform) || [];
    return accounts.length > 1
      ? accounts.map((account) => ({ id: String(account.id), label: clean(account.display_name) || clean(account.external_account_id) }))
      : [];
  }, [accountsByPlatform, messagePlatformFilter]);
  // The keys this filter accepts: the account's own id plus its page id, so an
  // Instagram thread stamped with either identifier still matches.
  const selectedAccountKeys = useMemo(() => {
    if (accountFilter === "all") return null;
    const account = asArray(channelAccounts).find((row) => String(row?.id) === accountFilter);
    if (!account) return null;
    const keys = new Set([clean(account.external_account_id), clean(account.metadata?.page_id)].filter(Boolean));
    return keys.size ? keys : null;
  }, [accountFilter, channelAccounts]);

  // Per-channel counts for the platform chips, so the operator can see where the
  // waiting customers actually are without switching tab by tab.
  const channelSummaries = useMemo(() => {
    const messageConversations = conversations.filter((conversation) => !isSocialCommentThread(conversation));
    const unreadOf = (conversation) =>
      Number(conversation.unread_count || conversation.unread || 0) ||
      (conversation.manually_unread === true ? 1 : 0);
    const buckets = new Map();
    let totalUnread = 0;
    for (const conversation of messageConversations) {
      const key = normalizeConversationChannel(conversation);
      const unread = unreadOf(conversation);
      totalUnread += unread;
      const existing = buckets.get(key) || { key, count: 0, unread: 0 };
      existing.count += 1;
      existing.unread += unread;
      buckets.set(key, existing);
    }
    return { all: { count: messageConversations.length, unread: totalUnread }, byChannel: buckets };
  }, [conversations]);
  // MESSAGE_PLATFORM_FILTERS keys are UI names ("messenger", "web"); the buckets
  // above are keyed by the normalized channel. Map one onto the other so a chip
  // badge cannot silently read zero.
  const platformFilterUnread = useCallback((filterKey = "all") => {
    if (filterKey === "all") return channelSummaries.all.unread;
    const wanted = backendChannelFilter(filterKey);
    let unread = 0;
    for (const [channel, bucket] of channelSummaries.byChannel) {
      if (backendChannelFilter(channel) === wanted) unread += bucket.unread;
    }
    return unread;
  }, [channelSummaries]);

  const filteredConversations = useMemo(() => {
    const normalized = debouncedSearch.toLowerCase();
    return conversations.filter((conversation) => {
      if (isSocialCommentThread(conversation)) return false;
      const matchesSearch = !normalized || [
        conversationName(conversation),
        conversation.external_customer_id,
        conversation.phone,
        conversation.latest_message_preview,
      ]
        .map((item) => clean(item).toLowerCase())
        .some((item) => item.includes(normalized));
      if (!matchesSearch) return false;
      if (!matchesMessagePlatform(conversation, messagePlatformFilter)) return false;
      if (selectedAccountKeys && !selectedAccountKeys.has(conversationAccountKey(conversation))) return false;
      // read_filter and favorite_only are already applied server-side; this
      // second pass keeps the list honest between a local toggle and the
      // refetch that follows it.
      if (favoriteFilter !== "all") {
        const isFavorite = conversation?.is_favorite === true || clean(conversation?.is_favorite).toLowerCase() === "true";
        if (!isFavorite) return false;
      }
      if (readFilter !== "all") {
        const isUnread = Number(conversation?.unread_count || conversation?.unread || 0) > 0 || conversation?.manually_unread === true;
        if (readFilter === "unread" ? !isUnread : isUnread) return false;
      }
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
    });
  }, [conversations, debouncedSearch, favoriteFilter, filter, messagePlatformFilter, readFilter, selectedAccountKeys]);

  const selectedConversation = useMemo(() => {
    if (!conversationParam) return null;
    const normalizedConversationParam = normalizeConversationSessionId(conversationParam);
    const rawConversationParam = stripConversationPrefixes(normalizedConversationParam).value || clean(conversationParam);
    return (
      conversations.find(
        (conversation) => {
          if (isSocialCommentThread(conversation)) return false;
          const identifiers = conversationIdentifiers(conversation);
          return (
            identifiers.sessionId === normalizedConversationParam ||
            identifiers.conversationKey === normalizedConversationParam ||
            identifiers.conversationId === normalizedConversationParam ||
            identifiers.rawSessionId === rawConversationParam ||
            identifiers.rawSessionId === normalizedConversationParam ||
            identifiers.rawSessionId === stripConversationPrefixes(conversationParam).value ||
            encodeConversationId(identifiers.sessionId) === clean(conversationParam) ||
            clean(identifiers.conversationKey) === clean(conversationParam)
          );
        }
    ) || null
    );
  }, [conversationParam, conversations]);

  // ---------------------------------------------------------------------
  // AI Inbox stale-while-revalidate cache (IndexedDB, tenant+user namespaced).
  // Cache is a fast starting point only; the network request stays
  // authoritative and merges over it. Every op is fail-safe (see inboxCache).
  // ---------------------------------------------------------------------
  const cachePrimedThreadsRef = useRef(new Set());
  // Threads already revalidated against the server this session. A cache-primed
  // window counts as "hydrated" by message count alone, so without this one-shot
  // forced revalidation it would never be checked against the server — and a
  // message deleted server-side would keep rendering from the cache forever.
  const revalidatedThreadsRef = useRef(new Set());

  // STEP 1-3: prime the conversation list from cache immediately, so a warm
  // reopen shows recent rows before the network responds. Only fills when state
  // is still empty — never clobbers already-loaded/fresher data.
  useEffect(() => {
    let active = true;
    inboxCache.primeList(messagePlatformFilter).then((cached) => {
      if (!active || !cached || !asArray(cached.conversations).length) return;
      setConversations((current) => (current.length ? current : cached.conversations));
    });
    return () => { active = false; };
  }, [messagePlatformFilter]);

  // Prime cached messages for the open thread before the network hydrates it, so
  // the transcript never flashes cached → empty spinner → fresh.
  useEffect(() => {
    const key = conversationKey(selectedConversation || {});
    if (!key || cachePrimedThreadsRef.current.has(key)) return undefined;
    if (asArray(selectedConversation?.messages).length > 1) {
      cachePrimedThreadsRef.current.add(key);
      return undefined;
    }
    let active = true;
    inboxCache.primeThread(key).then((cached) => {
      if (!active || !cached || !asArray(cached.messages).length) return;
      cachePrimedThreadsRef.current.add(key);
      patchConversation(key, (conversation) => ({
        ...conversation,
        messages: mergeMessagesByIdentity([...asArray(cached.messages), ...asArray(conversation.messages)]),
      }));
    });
    return () => { active = false; };
  }, [selectedConversation, patchConversation]);

  // STEP 5 (list) / event-driven persistence — debounced inside inboxCache.
  useEffect(() => {
    if (conversations.length) inboxCache.saveList(conversations, messagePlatformFilter);
  }, [conversations, messagePlatformFilter]);

  // Persist the open thread's message window (covers hydration, older-message
  // loads, realtime appends, and optimistic send/reconcile — all funnel here).
  useEffect(() => {
    const key = conversationKey(selectedConversation || {});
    const messages = asArray(selectedConversation?.messages);
    if (key && messages.length) inboxCache.saveThread(key, messages, mergeMessagesByIdentity);
  }, [selectedConversation]);

  // Remember the last opened thread for this namespace.
  useEffect(() => {
    if (conversationParam) inboxCache.saveLastThread(normalizeConversationSessionId(conversationParam));
  }, [conversationParam]);

  // Opportunistic expiry sweep on mount; wipe cache on logout / session change
  // so a prior user's cached conversations can never reach the next user.
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

  const currentAgent = useMemo(() => getCurrentUser() || {}, []);
  const aiIntegration = useAIInboxAnalysis(selectedConversation, products, currentAgent);
  const trackAIRecommendation = aiIntegration.track;
  const selectedConversationRouteId = useMemo(
    () => {
      const identifiers = conversationIdentifiers(selectedConversation || {});
      return clean(identifiers.sessionId || identifiers.conversationKey || identifiers.conversationId || "");
    },
    [selectedConversation]
  );
  const socialPostIdentity = useCallback((item = {}) => {
    const safeItem = item || {};
    return clean(
      safeItem.post_link_key ||
      safeItem.postLinkKey ||
      safeItem.product_link_identity?.product_link_key ||
      safeItem.product_link_identity?.post_id ||
      safeItem.conversation_id ||
      safeItem.session_id ||
      safeItem.post_id ||
      safeItem.id ||
      safeItem.comment_id ||
      `${safeItem.platform || "social"}:${safeItem.post_id || safeItem.comment_id || ""}`
    );
  }, []);
  const buildSocialCommentsCenterUrl = useCallback((item = {}) => {
    const params = new URLSearchParams();
    const postId = clean(item?.post_id || item?.conversation_post_id || item?.thread_post_id || item?.conversation_id || item?.id || socialPostIdentity(item) || "");
    const commentId = clean(item?.comment_id || item?.external_comment_id || item?.provider_comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || "");
    const platform = clean(item?.platform || item?.source_platform || item?.channel || item?.source || "");
    const pageId = clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || "");

    if (postId) params.set("postId", postId);
    if (commentId) params.set("commentId", commentId);
    if (platform) params.set("platform", platform);
    if (clean(tenantId)) params.set("tenant", clean(tenantId));
    if (pageId) params.set("pageId", pageId);
    return `/marketing/social-comments${params.toString() ? `?${params.toString()}` : ""}`;
  }, [socialPostIdentity, tenantId]);
  const socialPosts = useMemo(
    () =>
      groupSocialCommentPosts(socialComments.items).filter((item) => {
        const platform = normalizedSocialPlatform(item);
        return platform === "facebook" || platform === "instagram";
      }),
    [socialComments.items]
  );
  const visibleSocialPosts = useMemo(() => {
    if (!isSocialMode) return [];
    return [...socialPosts]
      .filter((item) => socialPostsPlatformFilter === "all"
        || asArray(item.platforms).includes(socialPostsPlatformFilter)
        || normalizedSocialPlatform(item) === socialPostsPlatformFilter)
      .filter((item) => socialPostMatchesFilter(item, socialCommentsFilter))
      .sort((a, b) => socialPostSortValue(b) - socialPostSortValue(a));
  }, [isSocialMode, socialCommentsFilter, socialPosts, socialPostsPlatformFilter]);
  const selectedSocialPost = useMemo(() => {
    if (!isSocialMode) return null;
    if (socialPostParam) {
      return visibleSocialPosts.find((item) => socialPostIdentity(item) === socialPostParam) || visibleSocialPosts[0] || null;
    }
    return visibleSocialPosts[0] || null;
  }, [isSocialMode, socialPostIdentity, socialPostParam, visibleSocialPosts]);
  const selectedSocialThreadStatusLabel = useMemo(() => {
    const source = selectedSocialThread?.post || selectedSocialPost || {};
    const status = clean(
      source.reply_status ||
      source.auto_reply_mode ||
      source.automation_status ||
      source.dm_status ||
      source.private_reply_status ||
      ""
    ).toLowerCase();
    if (["sent", "success", "successfully_sent", "done", "delivered", "replied", "auto_replied"].includes(status)) return "تم الرد تلقائيًا";
    if (["private_reply_sent", "dm_sent", "private_reply"].includes(status)) return "تم إرسال رد خاص";
    if (["failed", "error", "blocked"].includes(status)) return "فشل الرد";
    if (["human_takeover", "human_review", "manual_review"].includes(status)) return "متابعة بشرية";
    return "بانتظار الرد";
  }, [selectedSocialPost, selectedSocialThread?.post]);

  useEffect(() => {
    if (!isSocialMode) return;
    if (socialPostParam) return;
    const fallbackPost = visibleSocialPosts[0] || socialPosts[0];
    const nextPostId = socialPostIdentity(fallbackPost || {});
    if (!nextPostId) return;
    updateUrlState({ nextTab: "social_comments", nextConversationId: "", nextPostId, replace: true });
  }, [isSocialMode, socialPostIdentity, socialPostParam, socialPosts, updateUrlState, visibleSocialPosts]);

  useEffect(() => {
    if (!isSocialMode || !selectedSocialPost) return;
    console.info("AI_INBOX_PWA_SOCIAL_COMMENT_SELECTED", {
      post_id: clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || ""),
      platform: clean(selectedSocialPost?.platform || "facebook"),
      customer_name: clean(selectedSocialPost?.customer_name || selectedSocialPost?.customerName || ""),
      customer_profile_id: clean(selectedSocialPost?.customer_profile_id || selectedSocialPost?.customerProfileId || ""),
      automation_status: selectedSocialThreadStatusLabel,
      private_reply_status: clean(selectedSocialThread?.post?.dm_status || selectedSocialPost?.dm_status || selectedSocialPost?.private_reply_status || ""),
      last_ai_action: clean(selectedSocialThread?.post?.last_ai_action || selectedSocialPost?.last_ai_action || ""),
      comments_count: selectedSocialThread.comments.length,
    });
  }, [isSocialMode, selectedSocialPost, selectedSocialThread.comments.length, selectedSocialThread?.post?.dm_status, selectedSocialThread?.post?.last_ai_action, selectedSocialThreadStatusLabel]);

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF) return;
    console.log("[AiInboxPwa][rendered-rows]", {
      social_comments: socialComments.items.length,
      selected_social_comments: selectedSocialThread.comments.length,
      next_cursor: Boolean(socialCommentsCursor),
    });
  }, [selectedSocialThread.comments.length, socialComments.items.length, socialCommentsCursor]);

  useEffect(() => {
    if (!isSocialMode) {
      setSocialMobileDetailOpen(false);
      if (selectedSocialThread.post || selectedSocialThread.comments.length || selectedSocialTemplate.template) {
        setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
        setSelectedSocialTemplate({ template: null, loading: false, error: "" });
      }
      return undefined;
    }
    const postId = clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || "");
    if (!postId) {
      setSelectedSocialThread({ post: null, comments: [], loading: false, error: "" });
      setSelectedSocialTemplate({ template: null, loading: false, error: "" });
      return undefined;
    }
    let cancelled = false;
    const workspaceSeq = ++socialWorkspaceLoadSeqRef.current;
    const perfStart = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
    socialWorkspaceLoadStartRef.current = perfStart;
    const workspaceCacheKey = socialWorkspaceCacheKey({
      tenantId,
      postId,
      platform: clean(selectedSocialPost?.platform || ""),
    });
    socialWorkspaceLoadKeyRef.current = workspaceCacheKey;
    setSelectedSocialThread((current) => ({ ...current, loading: true, error: "" }));
    setSelectedSocialTemplate((current) => ({ ...current, loading: true, error: "" }));
    const logPerf = (label, startedAt = perfStart, extra = {}) => {
      if (!DEBUG_SOCIAL_PERF) return;
      const now = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
      console.log(label, {
        tenant_id: clean(tenantId),
        post_id: postId,
        platform: clean(selectedSocialPost?.platform || ""),
        duration_ms: Math.max(0, Math.round(now - startedAt)),
        ...extra,
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
        post: cachedWorkspace.thread.post || selectedSocialPost || null,
        comments: asArray(cachedWorkspace.thread.comments),
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
        const platformValue = clean(selectedSocialPost?.platform || "");
        const threadData = cachedWorkspace?.thread
          ? cachedWorkspace.thread
          : await api.get(`/social-comments/posts/${encodeURIComponent(postId)}/comments`, {
              params: {
                tenant_id: tenantId,
                platform: platformValue,
              },
              headers,
              perfComponent: "AiInboxPwa.socialCommentThread",
            }).then((threadPayload) => {
              const nextThread = {
                post: threadPayload.post || selectedSocialPost || null,
                comments: asArray(threadPayload.comments),
              };
              const currentCache = readSocialWorkspaceCache(workspaceCacheKey) || {};
              primeSocialWorkspaceCache(workspaceCacheKey, {
                ...currentCache,
                thread: nextThread,
              });
              logPerf("WORKSPACE_STAGE_2_MS");
              return nextThread;
            });

        if (!cancelled && workspaceSeq === socialWorkspaceLoadSeqRef.current) {
          setSelectedSocialThread({
            post: threadData.post || selectedSocialPost || null,
            comments: asArray(threadData.comments),
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled && workspaceSeq === socialWorkspaceLoadSeqRef.current) {
          setSelectedSocialThread({
            post: selectedSocialPost || null,
            comments: [],
            loading: false,
            error: error?.message || "تعذر تحميل تفاصيل البوست",
          });
        }
      }
    })();
    void (async () => {
      try {
        const platformValue = clean(selectedSocialPost?.platform || "");
        const templateData = cachedWorkspace?.template
          ? cachedWorkspace.template
          : await api.get(`/social-comments/posts/${encodeURIComponent(postId)}/template`, {
              params: {
                tenant_id: tenantId,
                platform: platformValue,
              },
              headers,
              perfComponent: "AiInboxPwa.socialCommentTemplate",
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

        if (!cancelled && workspaceSeq === socialWorkspaceLoadSeqRef.current) {
          setSelectedSocialTemplate({
            template: templateData.template || null,
            loading: false,
            error: "",
          });
        }
      } catch (error) {
        if (!cancelled && workspaceSeq === socialWorkspaceLoadSeqRef.current) {
          setSelectedSocialTemplate({
            template: null,
            loading: false,
            error: error?.message || "تعذر تحميل القالب",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [headers, isSocialMode, selectedSocialPost?.conversation_id, selectedSocialPost?.id, selectedSocialPost?.platform, selectedSocialPost?.post_id, socialPostParam, tenantId]);

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF || !isSocialMode || !selectedSocialPost?.post_id) return;
    if (selectedSocialThread.loading || selectedSocialTemplate.loading) return;
    const activeKey = socialWorkspaceCacheKey({
      tenantId,
      postId: clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || ""),
      platform: clean(selectedSocialPost?.platform || ""),
    });
    if (!activeKey || socialWorkspaceLoadKeyRef.current !== activeKey) return;
    const now = typeof window !== "undefined" && window.performance?.now ? window.performance.now() : Date.now();
    console.log("WORKSPACE_STAGE_5_MS", {
      tenant_id: clean(tenantId),
      post_id: clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || ""),
      platform: clean(selectedSocialPost?.platform || ""),
      duration_ms: Math.max(0, Math.round(now - socialWorkspaceLoadStartRef.current)),
    });
    console.log("WORKSPACE_TOTAL_VISIBLE_MS", {
      tenant_id: clean(tenantId),
      post_id: clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || ""),
      platform: clean(selectedSocialPost?.platform || ""),
      duration_ms: Math.max(0, Math.round(now - socialWorkspaceLoadStartRef.current)),
    });
    socialWorkspaceLoadKeyRef.current = "";
  }, [isSocialMode, selectedSocialPost?.conversation_id, selectedSocialPost?.id, selectedSocialPost?.platform, selectedSocialPost?.post_id, selectedSocialThread.loading, selectedSocialTemplate.loading, tenantId]);

  const activeAiReplyDraft = useMemo(
    () => selectedConversation?.ai_reply_draft || selectedConversation?.last_ai_reply_draft || null,
    [selectedConversation?.ai_reply_draft, selectedConversation?.last_ai_reply_draft]
  );
  const activeAiSuggestionText = useMemo(() => clean(activeAiReplyDraft?.text || ""), [activeAiReplyDraft?.text]);
  const suggestionSourceId = Number(activeAiReplyDraft?.metadata?.source_message_id) || 0;
  // A suggestion composed against an older inbound is stale: the customer has
  // said something since, and approving would answer the wrong message.
  const latestCustomerMessageId = useMemo(() => {
    let maxId = 0;
    for (const message of asArray(selectedConversation?.messages)) {
      const id = Number(message?.id) || 0;
      if (!isFromMeMessage(message) && clean(message?.customer_message) && id > maxId) maxId = id;
    }
    return maxId;
  }, [selectedConversation?.messages]);
  const suggestionStale = latestCustomerMessageId > 0 && suggestionSourceId > 0 && latestCustomerMessageId > suggestionSourceId;
  const activeAiSuggestionKey = useMemo(() => {
    if (!selectedConversation?.session_id || !activeAiSuggestionText) return "";
    const stamp = selectedConversation?.last_ai_reply_draft_updated_at || activeAiReplyDraft?.updated_at || activeAiReplyDraft?.metadata?.updated_at || "";
    // Keyed by source_message_id so a new draft (new inbound) is a NEW suggestion:
    // not dismissed, and it resets the inline edit / product selection below.
    return `${selectedConversation.session_id}:${suggestionSourceId || 0}:${stamp || activeAiSuggestionText.length}`;
  }, [activeAiReplyDraft?.metadata?.updated_at, activeAiReplyDraft?.updated_at, activeAiSuggestionText, selectedConversation?.last_ai_reply_draft_updated_at, selectedConversation?.session_id, suggestionSourceId]);
  // A completed/cleared TOMBSTONE (status "sent"/"cleared") is never actionable,
  // even if a stale payload still carried text.
  const draftCompleted = ["sent", "cleared"].includes(String(activeAiReplyDraft?.status || "").toLowerCase());
  const aiSuggestionVisible = Boolean(activeAiSuggestionText) && !draftCompleted && !suggestionStale && dismissedAiSuggestionKey !== activeAiSuggestionKey;

  // The grounded product attachment on the suggestion. The single enriched card
  // (unambiguous) is the draft's first product_card; ambiguous choices + delivery
  // format come from metadata.send_package.
  const suggestionDraftCard = useMemo(() => {
    const cards = asArray(activeAiReplyDraft?.product_cards);
    return cards.length ? cards[0] : null;
  }, [activeAiReplyDraft]);
  const suggestionSendPackage = activeAiReplyDraft?.metadata?.send_package || activeAiReplyDraft?.send_package || null;
  const effectiveSuggestionCard = suggestionProductRemoved ? null : (suggestionChosenCard || suggestionDraftCard);
  // Recommendation (multi-select) vs identity disambiguation (single-select). The
  // mode comes from the grounded send_package, never inferred from card count.
  const suggestionSelectionSemantics = suggestionSendPackage?.selection_semantics || null;
  const isRecommendationSuggestion = selectionModeFromSemantics(suggestionSelectionSemantics) === SELECTION_MODES.RECOMMENDATION;
  // Grounded VARIANT OPTIONS of one identified product (size asked, no colour
  // asked, >1 in-stock colour). Decided from the package, not the persisted
  // label, so a draft written before this shipped still becomes selectable.
  const variantOptionsEligible = useMemo(() => {
    const choices = asArray(suggestionSendPackage?.color_choices);
    if (!suggestionSendPackage?.color_choice_required || choices.length <= 1) return false;
    return new Set(choices.map((choice) => String(choice?.product_id ?? choice?.id ?? ""))).size === 1;
  }, [suggestionSendPackage]);
  const isVariantOptionsSuggestion = variantOptionsEligible && !isRecommendationSuggestion;
  const isMultiSelectSuggestion = isRecommendationSuggestion || isVariantOptionsSuggestion;
  const suggestionRecommendationKeys = useMemo(
    () => new Set(suggestionRecommendationCards.map(productSelectionKey)),
    [suggestionRecommendationCards]
  );
  const suggestionDeliveryFormat = useMemo(() => {
    const channel = String(selectedConversation?.channel || selectedConversation?.source || "").toLowerCase();
    if (channel.includes("messenger") || channel === "facebook") return { labelKey: "aiSupport.inbox.ui.fmtRichCard" };
    if (channel.includes("whatsapp")) return { labelKey: "aiSupport.inbox.ui.fmtImageLink" };
    if (channel.includes("instagram")) return { labelKey: "aiSupport.inbox.ui.fmtTextLink" };
    return { labelKey: "aiSupport.inbox.ui.fmtLink" };
  }, [selectedConversation?.channel, selectedConversation?.source]);
  // Reset the operator's product + text edits whenever a FRESH suggestion
  // arrives — never mid-edit of the same one.
  useEffect(() => {
    setSuggestionProductRemoved(false);
    setSuggestionChosenCard(null);
    setSuggestionRecommendationCards([]);
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
  }, [activeAiSuggestionKey]);
  const activeAiReplyValidation = useMemo(
    () => normalizeValidationSummary(
      selectedConversation?.last_ai_reply_validation ||
      activeAiReplyDraft?.validation ||
      activeAiReplyDraft?.metadata?.validation ||
      {}
    ),
    [activeAiReplyDraft?.metadata?.validation, activeAiReplyDraft?.validation, selectedConversation?.last_ai_reply_validation]
  );
  const activeAiReplyConfidence = useMemo(
    () => normalizeConfidenceEngineSummary(
      selectedConversation?.last_ai_reply_confidence_engine ||
      activeAiReplyDraft?.confidence_engine ||
      activeAiReplyDraft?.metadata?.confidence_engine ||
      {}
    ),
    [activeAiReplyDraft?.confidence_engine, activeAiReplyDraft?.metadata?.confidence_engine, selectedConversation?.last_ai_reply_confidence_engine]
  );
  useEffect(() => {
    setEditingAiDraft(false);
  }, [selectedConversation?.session_id]);
  const selectedTranscriptRows = useMemo(() => {
    const messages = cascadeDeliveryStatuses(
      uniqueMessages(selectedConversation?.messages || []).filter((message) => !isHiddenAiReplyDraftMessage(message))
    );
    return messages
      .map((message) => {
        const normalizedMessage = normalizeInboxMessage(message);
        const cards = normalizeMessageProductCards(normalizedMessage);
        const hasProductCards = cards.length > 0;
        const isFromMe = isFromMeMessage(normalizedMessage);
        const isCustomer = Boolean(clean(normalizedMessage.customer_message)) && !isFromMe;
        const isStaff = Boolean(clean(normalizedMessage.staff_message)) && !hasProductCards;
        const isAiSender = ["assistant", "ai", "bot", "system"].includes(clean(normalizedMessage.sender_type).toLowerCase());
        const isAi = !isStaff && (isAiSender || Boolean(clean(normalizedMessage.ai_answer)) || (normalizedMessage.direction === "outbound" && !isFromMe));
        if (!isCustomer && !isAi && !isStaff && !hasProductCards) return null;
        return {
          key: messageKey(normalizedMessage),
          message: normalizedMessage,
          cards,
          kind: hasProductCards || normalizedMessage.message_type === "product_card" ? "product_card" : isCustomer ? "customer" : isStaff ? "staff" : "ai",
          visible: true,
          createdAt: absoluteTime(normalizedMessage.created_at),
          conversationMetadata: selectedConversation?.channel_metadata || selectedConversation?.metadata || {},
        };
      })
      .filter(Boolean);
  }, [selectedConversation?.messages]);

  useEffect(() => {
    const draftText = clean(activeAiReplyDraft?.text || "");
    if (!draftText) return;
    setComposerText((current) => (clean(current) ? current : draftText));
  }, [activeAiReplyDraft?.text, selectedConversation?.session_id]);

  const markConversationAsRead = useCallback(
    async (conversation) => {
      const identifiers = conversationIdentifiers(conversation);
      const sessionId = identifiers.sessionId;
      const conversationIdentifier = identifiers.conversationKey || sessionId;
      if (!sessionId) return false;

      isHydratingConversationRef.current = true;
      markReadLocalUpdateRef.current += 1;
      console.debug("[AiInboxPwa][mark-read-local-update]", {
        mark_read_local_update: markReadLocalUpdateRef.current,
        conversation_id: sessionId,
      });
      patchConversation(conversationIdentifier, (currentConversation) => ({
        ...currentConversation,
        unread_count: 0,
        unseen_count: 0,
        pending_count: 0,
        unread: false,
      }));
      void api.post(
        aiInboxConversationEndpoint(identifiers.conversationId || sessionId, "/read"),
        { tenant_id: tenantId, conversation_id: sessionId, channel: conversation.channel || conversation.source || "" },
        { headers, perfComponent: "AiInboxPwa.markRead" }
      ).catch((markError) => {
        markReadSignatureRef.current = "";
        if (import.meta?.env?.DEV) {
          console.warn("[AiInboxPwa] mark-read failed", {
            conversation_id: sessionId,
            status: markError?.status || 0,
            message: markError?.message || "",
          });
          toast.error(markError?.message || "Failed to mark conversation as read");
        }
      }).finally(() => {
        window.requestAnimationFrame(() => {
          isHydratingConversationRef.current = false;
        });
      });
      return true;
    },
    [headers, patchConversation, tenantId]
  );

  const syncMessengerProfile = useCallback(
    async (conversation, { silent = false } = {}) => {
      if (!conversation?.session_id || !(isMessengerConversation(conversation) || isInstagramDmConversation(conversation))) return false;
      const sessionId = normalizeConversationSessionId(conversation.session_id, conversation.channel || conversation.source || conversation.provider || conversation.platform || "");
      if (!sessionId) return false;
      // Stored names only: the derived label (@username / id tail) is not a reason to
      // skip the fetch that could replace it with the real name.
      const currentName = clean(conversation.customer_name || conversation.customer_profile?.name);
      if (currentName && !isGenericCustomerName(currentName) && !isLikelyMessengerExternalId(currentName) && !looksLikeMessageName(currentName)) return false;
      const externalCustomerId = clean(conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "");
      if (!externalCustomerId) return false;
      const attemptKey = `${sessionId}:${externalCustomerId}`;
      if (messengerProfileSyncAttemptedRef.current.has(attemptKey)) return false;
      messengerProfileSyncAttemptedRef.current.add(attemptKey);
      try {
        const payload = await api.post(aiInboxConversationEndpoint(conversationIdentifiers(selectedConversation).conversationId || sessionId, "/sync-messenger-profile"), {
          tenant_id: tenantId,
          external_customer_id: externalCustomerId,
        }, { headers, perfComponent: "AiInboxPwa.syncMessengerProfile" });
        const conversationIdentifier = conversation.conversation_key || sessionId;
        if (payload.conversation) {
          patchConversation(conversationIdentifier, (currentConversation) => ({
            ...currentConversation,
            ...payload.conversation,
            messages: asArray(payload.conversation.messages).length ? payload.conversation.messages : currentConversation.messages,
          }));
        } else {
          patchConversation(conversationIdentifier, (currentConversation) => ({
            ...currentConversation,
            customer_name: payload.customer_name || payload.display_name || payload.facebook_name || payload.messenger_name || currentConversation.customer_name,
            customer_avatar_url: payload.customer_avatar_url || currentConversation.customer_avatar_url,
            customer_profile: {
              ...(currentConversation.customer_profile || {}),
              name: payload.customer_name || payload.display_name || payload.facebook_name || payload.messenger_name || currentConversation.customer_profile?.name || "",
              display_name: payload.display_name || payload.customer_name || currentConversation.customer_profile?.display_name || "",
              facebook_name: payload.facebook_name || payload.display_name || payload.customer_name || currentConversation.customer_profile?.facebook_name || "",
              messenger_name: payload.messenger_name || payload.display_name || payload.customer_name || currentConversation.customer_profile?.messenger_name || "",
              avatar_url: payload.customer_avatar_url || currentConversation.customer_profile?.avatar_url || "",
              profile_pic_url: payload.customer_avatar_url || currentConversation.customer_profile?.profile_pic_url || "",
            },
          }));
        }
        if (!silent) toast.success(t("aiSupport.inbox.pwa.messengerProfileSynced"));
        return true;
      } catch (error) {
        console.warn("[AiInboxPwa][messenger-profile-sync-failed]", {
          conversation_id: sessionId,
          external_customer_id: externalCustomerId,
          message: error?.message || "",
        });
        if (!silent) toast.error(t("aiSupport.inbox.pwa.messengerProfileFailed"));
        return false;
      }
    },
    [headers, patchConversation, tenantId]
  );

  const openConversation = useCallback(
    (conversation) => {
      setComposerMode("reply");
      setMenuOpen(false);
      if (isSocialCommentThread(conversation)) {
        const nextUrl = buildSocialCommentsCenterUrl(conversation);
        console.info("AI_INBOX_OPEN_SOCIAL_COMMENT", {
          post_id: clean(conversation?.post_id || conversation?.conversation_post_id || conversation?.thread_post_id || socialPostIdentity(conversation) || ""),
          comment_id: clean(conversation?.comment_id || conversation?.external_comment_id || conversation?.provider_comment_id || conversation?.metadata?.comment_id || conversation?.channel_metadata?.comment_id || ""),
          platform: clean(conversation?.platform || conversation?.source_platform || conversation?.channel || conversation?.source || ""),
          tenant: clean(tenantId),
          page_id: clean(conversation?.page_id || conversation?.metadata?.page_id || conversation?.channel_metadata?.page_id || ""),
          customer_name: clean(conversation?.customer_name || conversation?.commenter_name || conversation?.author_name || conversation?.from_name || conversation?.metadata?.customer_name || conversation?.metadata?.commenter_name || ""),
          url: nextUrl,
        });
        navigate(nextUrl);
        return;
      }
      const identifiers = conversationIdentifiers(conversation);
      const nextConversationId = clean(identifiers.conversationKey || identifiers.sessionId || identifiers.conversationId || "");
      if (!nextConversationId) return;
      restoreScrollStateRef.current = null;
      setComposerText("");
      updateUrlState({ nextConversationId, nextTab: "conversations" });
    },
    [buildSocialCommentsCenterUrl, navigate, socialPostIdentity, tenantId, updateUrlState]
  );

  const backToList = useCallback(() => {
    setMenuOpen(false);
    updateUrlState({ nextConversationId: "", nextTab: "conversations" });
  }, [updateUrlState]);

  const handleBackNavigation = useCallback(() => {
    setMenuOpen(false);
    const historyState = window.history.state;
    if (historyState && typeof historyState.idx === "number" && historyState.idx > 0) {
      navigate(-1);
      return;
    }
    backToList();
  }, [backToList, navigate]);

  useEffect(() => {
    if (!selectedConversation) return undefined;
    const onPopState = () => {
      const historyState = window.history.state;
      if (historyState && typeof historyState.idx === "number" && historyState.idx > 0) return;
      backToList();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [backToList, selectedConversation]);

  useEffect(() => {
    const sessionId = normalizeConversationSessionId(selectedConversation?.session_id, selectedConversation?.channel || selectedConversation?.source || selectedConversation?.provider || selectedConversation?.platform || "");
    if (!sessionId || tab !== "conversations") return;

    const unreadCount = conversationUnreadCount(selectedConversation);
    if (unreadCount <= 0) return;

    const signature = `${sessionId}:${selectedConversation.last_activity_at || selectedConversation.updated_at || ""}`;
    if (markReadSignatureRef.current === signature) return;
    markReadSignatureRef.current = signature;

    void markConversationAsRead(selectedConversation);
  }, [markConversationAsRead, selectedConversation, tab]);

  useEffect(() => {
    if (!selectedConversation || tab !== "conversations") return;
    if (!(isMessengerConversation(selectedConversation) || isInstagramDmConversation(selectedConversation))) return;
    const currentName = clean(selectedConversation.customer_name || selectedConversation.customer_profile?.name);
    if (currentName && !isGenericCustomerName(currentName) && !isLikelyMessengerExternalId(currentName) && !looksLikeMessageName(currentName)) return;
    void syncMessengerProfile(selectedConversation, { silent: true });
  }, [selectedConversation, syncMessengerProfile, tab]);

  useLayoutEffect(() => {
    if (!selectedConversation || tab !== "conversations") return undefined;
    const scroller = mainScrollRef.current;
    if (!scroller) return undefined;

    const restoreState = restoreScrollStateRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!scroller) return;
      const pinBottomAfterRefresh = pinToBottomAfterRefreshRef.current;
      pinToBottomAfterRefreshRef.current = false;
      if (restoreState) {
        scroller.scrollTop = Math.max(0, restoreState.scrollTop + (scroller.scrollHeight - restoreState.scrollHeight));
        restoreScrollStateRef.current = null;
        setUserIsNearBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 140);
        isLoadingOlderRef.current = false;
        isAppendingNewMessageRef.current = false;
        return;
      }
      const conversationKey = selectedConversation.conversation_key || selectedConversation.session_id || "";
      const latestVisibleMessage = [...asArray(selectedConversation.messages)].reverse().find((message) => !isHiddenAiReplyDraftMessage(message));
      const latestMessageKey = messageKey(latestVisibleMessage || {});
      const conversationChanged = previousConversationKeyRef.current !== conversationKey;
      const latestMessageAppended = latestMessageKey && latestMessageKey !== previousLatestMessageKeyRef.current;

      if (conversationChanged || (latestMessageAppended && userIsNearBottom) || pinBottomAfterRefresh) {
        scroller.scrollTop = scroller.scrollHeight;
        setUserIsNearBottom(true);
      } else {
        setUserIsNearBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 140);
      }

      previousConversationKeyRef.current = conversationKey;
      previousLatestMessageKeyRef.current = latestMessageKey;
      isAppendingNewMessageRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedConversation, selectedConversation?.conversation_key, selectedConversation?.messages, selectedConversation?.session_id, tab, userIsNearBottom]);

  useLayoutEffect(() => {
    if (!selectedConversation || tab !== "conversations") {
      setConversationHeaderHeight(0);
      return undefined;
    }

    const updateHeaderHeight = () => {
      const header = conversationHeaderRef.current;
      if (!header) return;
      setConversationHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    };

    updateHeaderHeight();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(updateHeaderHeight);
    if (conversationHeaderRef.current) {
      observer.observe(conversationHeaderRef.current);
    }

    return () => observer.disconnect();
  }, [selectedConversation, tab]);

  const loadOlderMessages = useCallback(async ({ forceHydrate = false } = {}) => {
    if (!selectedConversation?.session_id || olderLoading || isLoadingOlderRef.current) return;
    const currentMessages = asArray(selectedConversation.messages);
    // forceHydrate: the window on screen came from the cache, so fetch the
    // newest page (no `before` cursor) to revalidate it against the server.
    const shouldHydrateFullPage = forceHydrate === true
      // Unread recovered chats may not have imported message rows yet. An empty
      // summary is therefore a reason to call /messages, not proof that the
      // conversation has no history.
      || currentMessages.length === 0
      || (currentMessages.length <= 1 && Number(selectedConversation.message_count || 0) > currentMessages.length);
    const before = shouldHydrateFullPage ? "" : selectedConversation.next_messages_before || currentMessages[0]?.created_at || "";
    const beforeId = shouldHydrateFullPage ? "" : selectedConversation.next_messages_before_id || currentMessages[0]?.id || "";
    if (!shouldHydrateFullPage && !before) return;
    const scroller = mainScrollRef.current;
    if (scroller) {
      restoreScrollStateRef.current = {
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
      };
    }
    isLoadingOlderRef.current = true;
    setOlderLoading(true);
    try {
      const payload = await api.get(aiInboxConversationEndpoint(selectedConversationRouteId || normalizeConversationSessionId(selectedConversation.session_id, selectedConversation.channel || selectedConversation.source || selectedConversation.provider || selectedConversation.platform || ""), "/messages"), {
        params: { tenant_id: tenantId, ...(before ? { before, before_id: beforeId } : {}), limit: 30 },
        headers,
        perfComponent: "AiInboxPwa.messages",
      });
      const conversationCacheKey = clean(selectedConversation.conversation_key || selectedConversation.session_id);
      patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => {
        const incoming = asArray(payload.messages);
        // Inside the window the authoritative full page covers, the server's
        // word is final: a cache-primed message with a real server id that the
        // page no longer returns was DELETED on the server and must not
        // survive the merge (union-only merges kept deleted duplicates alive).
        const existing = shouldHydrateFullPage
          ? inboxCache.reconcileWithServerPage(asArray(conversation.messages), incoming, messageIdentityKeys)
          : asArray(conversation.messages);
        const mergedMessages = mergeMessagesByIdentity([...incoming, ...existing]);
        // Replace-write (not union) so dropped messages leave the cached record
        // too — a union write would resurrect them next session.
        if (shouldHydrateFullPage) inboxCache.replaceThreadNow(conversationCacheKey, mergedMessages);
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
    } catch (loadError) {
      toast.error(loadError?.message || "Failed to load older messages");
    } finally {
      setOlderLoading(false);
      isLoadingOlderRef.current = false;
    }
  }, [headers, olderLoading, patchConversation, selectedConversation, selectedConversationRouteId, tenantId]);

  useEffect(() => {
    if (!selectedConversation?.session_id || tab !== "conversations") return;
    if (isHydratingConversationRef.current || isLoadingOlderRef.current || isAppendingNewMessageRef.current) return;
    const key = conversationKey(selectedConversation || {});
    // A cache-primed window passes the count-based hydration check without ever
    // consulting the server, so revalidate it exactly ONCE per session (marked
    // up-front so a failing fetch can't retry-loop). The reconcile inside the
    // full-page hydrate then drops any cached message the server deleted.
    const primedNeedsRevalidate = Boolean(key) &&
      cachePrimedThreadsRef.current.has(key) &&
      !revalidatedThreadsRef.current.has(key);
    if (selectedConversation.conversationHydrated !== false && !primedNeedsRevalidate) return;
    if (primedNeedsRevalidate) revalidatedThreadsRef.current.add(key);
    void loadOlderMessages({ forceHydrate: primedNeedsRevalidate });
  }, [loadOlderMessages, selectedConversation?.conversationHydrated, selectedConversation?.session_id, selectedConversation, tab]);

  const reactToMessage = useCallback(async ({ emoji = "", targetMessageId = "", remoteJid = "", targetFromMe = false } = {}) => {
    if (!selectedConversation?.session_id || !targetMessageId) return null;
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/reaction"), {
        tenant_id: tenantId,
        emoji,
        target_message_id: targetMessageId,
        remote_jid: remoteJid,
        target_from_me: targetFromMe,
      }, { headers, perfComponent: "AiInboxPwa.messageReaction" });
      toast.success(emoji ? `تم إضافة التفاعل ${emoji}` : "تم حذف التفاعل");
      requestRefresh("message-reaction", { silent: true, force: true });
      return payload;
    } catch (reactionError) {
      toast.error(reactionError?.message || "تعذر إرسال التفاعل");
      throw reactionError;
    }
  }, [headers, requestRefresh, selectedConversation, selectedConversationRouteId, tenantId]);

  // Edits a message the customer already received. WhatsApp only, and only
  // inside its 15-minute window — the server is the authority, so the thread is
  // refreshed from it rather than patched optimistically.
  const editMessage = useCallback(async ({ text = "", targetMessageId = "", remoteJid = "" } = {}) => {
    if (!selectedConversation?.session_id || !targetMessageId) return null;
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/message/edit"), {
        tenant_id: tenantId,
        text,
        target_message_id: targetMessageId,
        remote_jid: remoteJid,
      }, { headers, perfComponent: "AiInboxPwa.messageEdit" });
      toast.success("تم تعديل الرسالة عند العميل");
      requestRefresh("message-edit", { silent: true, force: true });
      return payload;
    } catch (editError) {
      toast.error(editError?.message || "تعذر تعديل الرسالة");
      throw editError;
    }
  }, [headers, requestRefresh, selectedConversation, selectedConversationRouteId, tenantId]);

  const sendManualReply = useCallback(async (overrideText = "", options = {}) => {
    const explicitText = typeof overrideText === "string" ? overrideText : "";
    const message = cleanMessageText(explicitText || composerText);
    if (!selectedConversation?.session_id || !message) return { ok: false, skipped: true };
    if (manualSendInFlightRef.current) return { ok: false, skipped: true }; // double-click / in-flight guard
    manualSendInFlightRef.current = true;
    const clientRequestId = buildClientRequestId();
    const canonicalSessionId = selectedConversationRouteId || normalizeConversationSessionId(selectedConversation.session_id, selectedConversation.channel || selectedConversation.source || selectedConversation.provider || selectedConversation.platform || "");
    const messageIdentityKey = buildMessageIdentityKey({
      tenantId,
      sessionId: canonicalSessionId,
      direction: composerMode === "note" ? "note" : "outbound",
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
      sessionId: canonicalSessionId,
      validationViolationsCount: validationState.violationsCount,
      validationWarningsCount: validationState.warningsCount,
      confidenceDecision: confidenceState.decision,
      confidenceReasonsCount: confidenceState.reasonsCount,
      confidenceRiskFlagsCount: confidenceState.riskFlagsCount,
    });
    if (composerMode !== "note" && warningCount > 0) {
      const confirmed = window.confirm(sendWarnings.join("\n"));
      if (!confirmed) { manualSendInFlightRef.current = false; return { ok: false, cancelled: true }; }
    }
    const allowSameTextCorrection = options.allowSameTextCorrection === true || editingAiDraft;
    const correctionMetadata = options.correctionMetadata || {};
    const sendFlow = options.flow || (allowSameTextCorrection ? "edit" : "normal");
    // Optimistic pending message: appears immediately (<100 ms) so the send feels
    // instant even while the authoritative Meta/Evolution send (2-5s) is in flight.
    // Reconciled on success and marked failed on error below — never shown as sent
    // before the server acknowledges.
    const optimisticMessageId = `pending:${clientRequestId}`;
    const optimisticMessage = {
      id: optimisticMessageId,
      client_request_id: clientRequestId,
      message_identity_key: messageIdentityKey,
      staff_message: message,
      message_text: message,
      direction: "outbound",
      sender_type: composerMode === "note" ? "note" : "staff",
      message_type: composerMode === "note" ? "internal_note" : "manual_reply",
      delivery_status: "sending",
      is_optimistic: true,
      created_at: new Date().toISOString(),
    };
    patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
      ...conversation,
      messages: mergeMessagesByIdentity([...asArray(conversation.messages), optimisticMessage]),
      latest_message_preview: messageDisplayText(optimisticMessage) || message,
      last_activity_at: optimisticMessage.created_at,
      updated_at: optimisticMessage.created_at,
    }));
    setSending(true);
    try {
      const payload =
        composerMode === "note"
          ? await api.post(
              aiInboxConversationEndpoint(canonicalSessionId, "/reply"),
              { tenant_id: tenantId, message, client_request_id: clientRequestId, message_identity_key: messageIdentityKey },
              { headers, perfComponent: "AiInboxPwa.note" }
            )
          : await api.post(
              aiInboxConversationEndpoint(canonicalSessionId, "/send"),
              { tenant_id: tenantId, message, client_request_id: clientRequestId, message_identity_key: messageIdentityKey },
              { headers, perfComponent: "AiInboxPwa.send" }
            );

      const returnedMessage =
        payload?.message ||
        (composerMode === "note"
          ? {
              id: `note:${Date.now()}`,
              client_request_id: clientRequestId,
              message_identity_key: messageIdentityKey,
              staff_message: message,
              message_type: "internal_note",
              created_at: new Date().toISOString(),
            }
          : null);

      if (returnedMessage) {
        if (composerMode !== "note" && payload?.delivery_status) {
          returnedMessage.delivery_status = payload.delivery_status;
          if (payload.delivery_status === "failed" || payload.delivery_status === "stored_only") {
            returnedMessage.delivery_error = payload?.delivery_error || payload?.message || (payload.delivery_status === "stored_only" ? "Saved only, not delivered" : "Failed to send");
          }
        }
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ai_reply_draft: null,
          last_ai_reply_draft: null,
          last_ai_reply_validation: null,
          last_ai_reply_confidence_engine: null,
          last_ai_reply_draft_updated_at: null,
          messages: mergeMessagesByIdentity([...asArray(conversation.messages).filter((existing) => existing?.id !== optimisticMessageId), returnedMessage]),
          latest_message_preview: messageDisplayText(returnedMessage) || message,
          last_activity_at: returnedMessage.created_at || new Date().toISOString(),
          updated_at: returnedMessage.created_at || new Date().toISOString(),
          ai_paused: composerMode === "note" ? conversation.ai_paused : true,
          human_takeover: composerMode === "note" ? conversation.human_takeover : true,
          conversation_status: composerMode === "note" ? conversation.conversation_status : "human_takeover",
        }));
        if (composerMode !== "note" && payload?.delivery_status === "sent") {
          const customerQuestion = [...asArray(selectedConversation?.messages)]
            .reverse()
            .find((item) => clean(item.customer_message || item.message_text || item.last_message || ""));
          const draftText = clean(activeDraft?.text || "");
          if (draftText && draftText !== message && ["not_sent", "draft"].includes(clean(activeDraft?.status || "not_sent").toLowerCase())) {
            let correctionSaved = true;
            try {
              await api.post(
                aiReplyCorrectionEndpoint(canonicalSessionId, returnedMessage.id || payload?.message?.id || ""),
                {
                  tenant_id: tenantId,
                  customer_question: clean(customerQuestion?.customer_message || customerQuestion?.message_text || customerQuestion?.last_message || selectedConversation.latest_message_preview || selectedConversation.last_message || ""),
                  ai_wrong_answer: draftText,
                  employee_correct_answer: message,
                  correction_type: activeDraft?.metadata?.correction_type || "other",
                  product_id: activeDraft?.metadata?.product_id || null,
                  channel: selectedConversation.channel || selectedConversation.source || "",
                  metadata: {
                    ...(activeDraft?.metadata || {}),
                    ...correctionMetadata,
                  },
                },
                { headers, perfComponent: "AiInboxPwa.aiReplyCorrection" }
              );
            } catch (error) {
              correctionSaved = false;
              console.warn("[ai-inbox-pwa][ai-reply-correction] skipped", {
                session_id: selectedConversation.session_id,
                message_id: returnedMessage.id || payload?.message?.id || "",
                error: error?.message || String(error),
              });
              toast.warn(t("aiSupport.inbox.pwa.sentCorrectionNotSaved"));
            }
            if (sendFlow === "approve") {
              toast.success(t("aiSupport.inbox.pwa.aiReplyApprovedSent"));
            } else if (allowSameTextCorrection) {
              toast[correctionSaved ? "success" : "warn"](
                correctionSaved ? "تم إرسال الرد المعدل وحفظ التصحيح للتعلم" : "تم الإرسال، لكن لم يتم حفظ التصحيح"
              );
            }
          } else if (allowSameTextCorrection && draftText && activeDraft) {
            let correctionSaved = true;
            try {
              await api.post(
                aiReplyCorrectionEndpoint(canonicalSessionId, returnedMessage.id || payload?.message?.id || ""),
                {
                  tenant_id: tenantId,
                  customer_question: clean(
                    [...asArray(selectedConversation?.messages)]
                      .slice()
                      .reverse()
                      .find((item) => clean(item.customer_message || item.message_text || item.last_message || ""))?.customer_message ||
                    selectedConversation.latest_message_preview ||
                    selectedConversation.last_message ||
                    ""
                  ),
                  ai_wrong_answer: draftText,
                  employee_correct_answer: message,
                  correction_type: activeDraft?.metadata?.correction_type || "other",
                  product_id: activeDraft?.metadata?.product_id || null,
                  channel: selectedConversation.channel || selectedConversation.source || "",
                  metadata: {
                    ...(activeDraft?.metadata || {}),
                    ...correctionMetadata,
                    approval: true,
                    approved_ai_reply: true,
                  },
                },
                { headers, perfComponent: "AiInboxPwa.aiReplyApproval" }
              );
            } catch (error) {
              correctionSaved = false;
              console.warn("[ai-inbox-pwa][ai-reply-approval] skipped", {
                session_id: selectedConversation.session_id,
                message_id: returnedMessage.id || payload?.message?.id || "",
                error: error?.message || String(error),
              });
              toast.warn(t("aiSupport.inbox.pwa.sentCorrectionNotSaved"));
            }
            if (sendFlow === "approve") {
              toast.success(t("aiSupport.inbox.pwa.aiReplyApprovedSent"));
            } else if (allowSameTextCorrection) {
              toast[correctionSaved ? "success" : "warn"](
                correctionSaved ? "تم إرسال الرد المعدل وحفظ التصحيح للتعلم" : "تم الإرسال، لكن لم يتم حفظ التصحيح"
              );
            }
          }
        }
      }

      if (composerMode === "note") {
        toast.success(t("aiSupport.inbox.pwa.internalNoteSaved"));
      } else if (payload?.delivery_status === "failed") {
        toast.error(payload?.delivery_error || payload?.message || "Failed to send");
      } else if (payload?.delivery_status === "stored_only") {
        toast.info(t("aiSupport.inbox.pwa.savedNotDelivered"));
      } else if (!editingAiDraft && !allowSameTextCorrection) {
        toast.success(t("aiSupport.inbox.pwa.messageSent"));
      }
      setEditingAiDraft(false);
      setComposerText("");
      if (composerMode === "note") setComposerMode("reply");
      // The caller needs to know whether the customer actually received this.
      // An assisted approval sends the reply text FIRST and the product cards
      // second; sending cards after a failed text is how a customer gets a
      // carousel with no message attached to it.
      return { ok: payload?.delivery_status !== "failed", message: payload?.message || null };
    } catch (sendError) {
      // Mark the optimistic message failed (with retry affordance) — never leave it
      // looking sent, and never claim success without a server acknowledgement.
      patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
        ...conversation,
        messages: asArray(conversation.messages).map((existing) =>
          existing?.id === optimisticMessageId
            ? { ...existing, delivery_status: "failed", delivery_error: clean(sendError?.responseBody?.delivery_error || sendError?.responseBody?.message || sendError?.message || "Failed to send") }
            : existing
        ),
      }));
      toast.error(sendError?.responseBody?.delivery_error || sendError?.responseBody?.message || sendError?.message || "فشل الإرسال");
      return { ok: false, error: sendError?.message || "" };
    } finally {
      manualSendInFlightRef.current = false;
      setSending(false);
    }
  }, [composerMode, composerText, editingAiDraft, headers, patchConversation, selectedConversation, tenantId]);

  // The inline edit lives inside the suggestion card and does NOT touch the
  // manual composer; Approve & Send uses the edited text.
  const handleEditAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionText) return;
    trackAIRecommendation({ id: activeAiSuggestionKey, title: t("aiSupport.inbox.pwa.aiReplyDraft"), confidence: activeAiReplyConfidence.score }, "Manual Override");
    setEditingAiDraft(true);
    setDismissedAiSuggestionKey("");
    setAiSuggestionEditText(activeAiSuggestionText);
  }, [activeAiReplyConfidence.score, activeAiSuggestionKey, activeAiSuggestionText, t, trackAIRecommendation]);

  const handleCancelEditAiSuggestion = useCallback(() => {
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
  }, []);

  // Labels drive the lead status the whole pipeline reads, so the phone has to
  // be able to set them too — not just display whatever the desk decided.
  const conversationLabels = useMemo(
    () => aiInboxLabelsFromConversation(selectedConversation || {}),
    [selectedConversation]
  );
  const updateConversationLabels = useCallback(async (nextLabels) => {
    if (!selectedConversation?.session_id) return false;
    const labels = normalizeAiInboxConversationLabels(nextLabels);
    const sessionId = selectedConversation.session_id;
    const conversationIdentifier = selectedConversation.conversation_key || sessionId;
    setLeadActionLoading("labels");
    try {
      const payload = await api.patch(
        aiAgentInboxEndpoint(sessionId, "/labels"),
        { tenant_id: tenantId, labels },
        { headers, timeoutMs: 12000, perfComponent: "AiInboxPwa.updateConversationLabels" }
      );
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
      toast.success(t("aiSupport.inbox.pwa.labelsSaved"));
      return true;
    } catch (err) {
      toast.error(err?.message || t("aiSupport.inbox.pwa.labelsSaveFailed"));
      return false;
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, selectedConversation, t, tenantId]);

  // "This answer was wrong" — the correction the AI learns from. Reachable from
  // any AI message in the transcript, the same as on the desktop.
  const openReplyCorrection = useCallback((message = {}) => {
    if (!selectedConversation?.session_id) return;
    setCorrectionModal({ open: true, draft: buildReplyCorrectionDraft({ conversation: selectedConversation, message }) });
  }, [selectedConversation]);
  const closeReplyCorrection = useCallback(() => {
    setCorrectionModal({ open: false, draft: buildReplyCorrectionDraft() });
  }, []);
  const patchReplyCorrection = useCallback((patch = {}) => {
    setCorrectionModal((current) => ({ ...current, draft: { ...current.draft, ...patch } }));
  }, []);
  const saveReplyCorrection = useCallback(async () => {
    if (!selectedConversation?.session_id || !correctionModal.draft.messageId || !clean(correctionModal.draft.employeeCorrectAnswer)) return;
    setCorrectionSaving(true);
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
        { headers, perfComponent: "AiInboxPwa.saveCorrection" }
      );
      toast.success(t("aiSupport.inbox.pwa.correctionSaved"));
      closeReplyCorrection();
    } catch (err) {
      toast.error(err?.message || t("aiSupport.inbox.pwa.correctionSaveFailed"));
    } finally {
      setCorrectionSaving(false);
    }
  }, [closeReplyCorrection, correctionModal.draft, headers, selectedConversation, t, tenantId]);

  const handleRemoveSuggestionProduct = useCallback(() => {
    setSuggestionProductRemoved(true);
    setSuggestionChosenCard(null);
  }, []);
  const handleChangeSuggestionProduct = useCallback(() => {
    setAvailableBySizePickerConfig({ open: true, sizeMode: false, allowMultiple: false, orderMode: false, selectMode: true, restockMode: false });
  }, []);
  const handleChooseSuggestionProduct = useCallback((choice) => {
    if (!choice) return;
    setSuggestionChosenCard(choice);
    setSuggestionProductRemoved(false);
  }, []);
  // Toggle a grounded product in the multi-select batch (ordered, max 5).
  // Blocking the 6th selection surfaces the limit — never a silent drop.
  const handleToggleRecommendationCard = useCallback((choice) => {
    if (!choice) return;
    setSuggestionRecommendationCards((current) => {
      const { list, blocked } = toggleProductSelection(current, choice, { max: MAX_BATCH_PRODUCTS });
      if (blocked) toast(isVariantOptionsSuggestion ? maxVariantBatchReachedText() : maxBatchReachedText());
      return list;
    });
  }, [isVariantOptionsSuggestion]);

  // PACKAGE Approve & Send: the (approved/edited) TEXT first — stale-guarded —
  // then the approved grounded PRODUCT CARDS. One operator action. If the text
  // send is stale or fails, the cards are NOT sent (the whole package is
  // blocked) and the suggestion stays actionable.
  // A plain async function, NOT a useCallback: it closes over sendProductCards,
  // which is declared further down this component. A hook dependency on a const
  // that is still uninitialised is a temporal-dead-zone crash on first render.
  const handleApproveAiSuggestion = async () => {
    if (!activeAiSuggestionText) return;
    // Identity disambiguation stays single-select: an ambiguous match still
    // requires picking exactly one product, or removing it.
    if (!isMultiSelectSuggestion && suggestionSendPackage?.product_ambiguous && !suggestionChosenCard && !suggestionProductRemoved) {
      toast(t("aiSupport.inbox.pwa.pickProductBeforeSend"));
      return;
    }
    // Ticking a colour never sends, so approving with nothing ticked would
    // promise options and deliver none.
    if (isVariantOptionsSuggestion && !suggestionRecommendationCards.length && !suggestionProductRemoved) {
      toast(t("aiSupport.inbox.pwa.pickColorsBeforeSend"));
      return;
    }
    if (!isMultiSelectSuggestion && suggestionSendPackage?.color_choice_required && !suggestionChosenCard && !suggestionProductRemoved) {
      toast(t("aiSupport.inbox.pwa.pickColorBeforeSend"));
      return;
    }
    trackAIRecommendation({ id: activeAiSuggestionKey, title: t("aiSupport.inbox.pwa.aiReplyDraft"), confidence: activeAiReplyConfidence.score }, "Suggestion Accepted");

    const recommendationCards = isMultiSelectSuggestion ? suggestionRecommendationCards : [];
    const cardsToSend = recommendationCards.length ? recommendationCards : (effectiveSuggestionCard ? [effectiveSuggestionCard] : []);
    const disposition = suggestionProductRemoved
      ? "removed"
      : (recommendationCards.length
        ? (isVariantOptionsSuggestion ? "variant_options_batch" : "recommendation_batch")
        : (suggestionChosenCard ? "changed" : (suggestionDraftCard ? "kept" : "none")));

    // A variant-options suggestion's text lists every colour with its sizes,
    // price and link — exactly what the carousel is about to show as cards.
    // Sending both makes the customer read the same catalogue twice, so the text
    // leg shrinks to a one-line lead. A manual edit still wins: edited words are
    // deliberate.
    const editedText = editingAiDraft && clean(aiSuggestionEditText) ? clean(aiSuggestionEditText) : "";
    const variantOptionsLead = isVariantOptionsSuggestion && cardsToSend.length >= 2
      ? `${clean(cardsToSend[0]?.product_name || cardsToSend[0]?.name || "المنتج")} متوفر بالألوان دي — اختار اللي يعجبك 👇`
      : "";
    const textToSend = editedText || variantOptionsLead || activeAiSuggestionText;

    setComposerMode("reply");
    const result = await sendManualReply(textToSend, {
      allowSameTextCorrection: true,
      flow: "approve",
      assistedApproval: true,
      correctionMetadata: {
        source: "ai_suggestion_approved",
        approved_ai_reply: true,
        product_disposition: disposition,
        selection_semantics: suggestionSelectionSemantics || null,
        product_id: cardsToSend[0]?.product_id || cardsToSend[0]?.id || null,
        variant_id: cardsToSend[0]?.variant_id || null,
        product_count: cardsToSend.length,
      },
    });
    // Text failed, was cancelled, or was stale (409) → keep the suggestion
    // actionable and never send the cards on their own.
    if (!result?.ok) return;

    if (cardsToSend.length) await sendProductCards(cardsToSend);

    // A successful assisted approval CONSUMES the suggestion: drop the card at
    // once and reset the local state so it can never be re-approved. The backend
    // already cleared the draft; writing the tombstone here means no refetch or
    // cache race can bring the completed suggestion back.
    setDismissedAiSuggestionKey(activeAiSuggestionKey);
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
    setSuggestionProductRemoved(false);
    setSuggestionChosenCard(null);
    setSuggestionRecommendationCards([]);
    const completedTombstone = {
      status: "sent",
      text: "",
      source_message_id: suggestionSourceId || null,
      metadata: { source_message_id: suggestionSourceId || null },
      updated_at: new Date().toISOString(),
    };
    patchConversation(selectedConversation?.conversation_key || selectedConversation?.session_id, (conversation) => ({
      ...conversation,
      ai_reply_draft: completedTombstone,
      last_ai_reply_draft: completedTombstone,
      last_ai_reply_draft_updated_at: completedTombstone.updated_at,
    }));
  };

  const handleDismissAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionKey) return;
    trackAIRecommendation({ id: activeAiSuggestionKey, title: t("aiSupport.inbox.pwa.aiReplyDraft"), confidence: activeAiReplyConfidence.score }, "Suggestion Rejected");
    setEditingAiDraft(false);
    setAiSuggestionEditText("");
    setDismissedAiSuggestionKey(activeAiSuggestionKey);
  }, [activeAiReplyConfidence.score, activeAiSuggestionKey, t, trackAIRecommendation]);

  const sendProductCards = useCallback(
    async (cards = []) => {
      const conversationId = clean(selectedConversation?.session_id || selectedConversation?.conversation_key || selectedConversation?.conversation_id || "");
      if (!conversationId || !cards.length) return;
      const clientRequestId = buildClientRequestId();
      console.info("[selected-conversation-product-send]", {
        route_id: selectedConversationRouteId || conversationId,
        channel: selectedConversation?.channel,
        external_customer_id: selectedConversation?.external_customer_id,
        name: selectedConversation?.customer_name,
      });
      const messageIdentityKey = buildMessageIdentityKey({
        tenantId,
        sessionId: conversationId,
        direction: "outbound",
        clientRequestId,
      });
      setProductSending(true);
      try {
        const sentCards = cards.map((card) => {
          const exactUrl = clean(card.product_url || card.storefront_url || productUrl(card));
          const productName = clean(card.product_name || card.name || card.title || card.display_name || card.label || "");
          const imageUrl = clean(
            card.image_url ||
              card.product_image_url ||
              card.variant_image_url ||
              card.image ||
              card.thumbnail_url ||
              card.media_url ||
              card.main_image ||
              card.color_image ||
              card.color_image_url ||
              ""
          );
          return {
            ...card,
            id: card.product_id ?? card.id ?? null,
            product_url: exactUrl,
            storefront_url: exactUrl,
            url: exactUrl,
            share_url: clean(card.share_url || card.shareUrl || ""),
            product_name: productName,
            name: productName,
            title: productName,
            display_name: productName,
            label: productName,
            image_url: imageUrl,
            product_image_url: clean(card.product_image_url || ""),
            variant_image_url: clean(card.variant_image_url || ""),
            image: imageUrl,
            thumbnail_url: imageUrl,
            media_url: clean(card.media_url || card.mediaUrl || ""),
          };
        });
        console.info("[product-card-send]", {
          conversationId,
          conversation: selectedConversation,
        });
        console.debug("[AiInboxPwa][product-card-send]", {
          conversation_id: conversationId,
          product_cards: sentCards.map((card) => ({
            product_id: card.product_id || card.id || "",
            name: card.product_name || card.name || card.title || "",
            color: card.color || "",
            size: card.size || "",
            price: card.price ?? "",
            product_url: card.product_url || "",
            image_url: card.image_url || card.image || "",
          })),
        });
        const payload = await api.post(
          aiInboxConversationEndpoint(conversationId, "/product-card/send"),
          {
            tenant_id: tenantId,
            product_cards: sentCards,
            client_request_id: clientRequestId,
            message_identity_key: messageIdentityKey,
          },
          { headers, perfComponent: "AiInboxPwa.productCard" }
        );

        const deliveryStatus = payload?.delivery_status || "sent";
        const returnedMessage = payload?.message
          ? {
              ...payload.message,
              delivery_status: payload?.delivery_status || payload?.message?.delivery_status,
              delivery_error: payload?.delivery_error || payload?.message?.delivery_error || "",
              fallback_used: payload?.fallback_used === true,
            }
          : null;
        const normalizedReturnedMessage = normalizeInboxMessage(returnedMessage || {});
        const returnedCards = normalizeProductCardsValue(normalizedReturnedMessage?.product_cards || normalizedReturnedMessage?.productCards);
        const normalizedCards = returnedCards.length
          ? returnedCards.map((card, index) => {
              const fallbackCard = sentCards[index] || sentCards[0] || {};
              const exactUrl = clean(
                card.product_url ||
                  card.storefront_url ||
                  card.url ||
                  fallbackCard.product_url ||
                  fallbackCard.storefront_url ||
                  productUrl(card) ||
                  productUrl(fallbackCard)
              );
              return {
                ...fallbackCard,
                ...card,
                product_url: exactUrl,
                storefront_url: exactUrl,
              };
            })
          : sentCards;
        patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => ({
          ...conversation,
          messages: normalizedReturnedMessage
            ? mergeMessagesByIdentity([
                ...asArray(conversation.messages),
                {
                  ...normalizedReturnedMessage,
                  product_cards: normalizedCards,
                  client_request_id: normalizedReturnedMessage.client_request_id || clientRequestId,
                  message_identity_key: normalizedReturnedMessage.message_identity_key || messageIdentityKey,
                },
              ])
            : conversation.messages,
          latest_message_preview:
            productCardPreviewText(sentCards) ||
            normalizedReturnedMessage?.staff_message ||
            normalizedReturnedMessage?.message_text ||
            normalizedReturnedMessage?.text ||
            (deliveryStatus === "stored_only" ? "Saved only" : deliveryStatus === "failed" ? "Failed to send product" : "Product sent"),
          last_activity_at: normalizedReturnedMessage?.created_at || new Date().toISOString(),
          updated_at: normalizedReturnedMessage?.created_at || new Date().toISOString(),
        }));

        setProductSheetOpen(false);
        if (deliveryStatus === "stored_only") {
          toast.info(t("aiSupport.inbox.pwa.savedNotDelivered"));
        } else if (deliveryStatus === "failed") {
          toast.error(`Failed to send${payload?.delivery_error ? `: ${payload.delivery_error}` : ""}`);
        } else {
          toast.success(t("aiSupport.inbox.productCard.sentProduct"));
        }
      } catch (sendError) {
        toast.error(sendError?.message || "Failed to send product");
      } finally {
        setProductSending(false);
      }
    },
    [headers, patchConversation, selectedConversation, tenantId]
  );

  // The shared composer hands back ONE payload for the whole cart — lines,
  // discount, payment method, shipping override, address — and `confirm: true`
  // when the operator chose "save invoice" rather than "draft". Same call the
  // desktop workspace makes, so an order written from the phone is the same
  // order written at the desk.
  const submitComposerOrder = useCallback(async (payload = {}) => {
    if (!selectedConversation?.session_id) return;
    const confirmed = payload.confirm === true;
    setOrderComposerBusy(true);
    try {
      const response = await api.post(
        aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/create-draft-order"),
        { tenant_id: tenantId, ...payload },
        { headers, perfComponent: "AiInboxPwa.createDraftOrder" }
      );
      const order = response?.order || {};
      const number = order.public_order_number || order.invoice_number || order.id || "";
      if (confirmed) {
        const invoiceUrl = clean(response?.invoice_url);
        if (invoiceUrl) {
          try {
            // Customer-facing text stays Arabic on purpose: the shopper reads
            // it, not whoever set the ERP interface language.
            await api.post(
              aiInboxConversationEndpoint(selectedConversationRouteId || selectedConversation.session_id, "/send"),
              { tenant_id: tenantId, message: `تم تأكيد طلبك ✅\nرقم الفاتورة: ${number}\n\n🧾 الفاتورة:\n${invoiceUrl}` },
              { headers, perfComponent: "AiInboxPwa.sendInvoiceLink" }
            );
            toast.success(t("aiSupport.inbox.order.invoiceSaved", { number }));
          } catch (sendError) {
            toast.error(t("aiSupport.inbox.order.invoiceSavedSendFailed", { number, reason: sendError?.message || "" }));
          }
        } else {
          toast.error(t("aiSupport.inbox.order.invoiceSavedNoLink", { number }));
        }
      } else {
        toast.success(t("aiSupport.inbox.order.draftCreated", { number }));
      }
      setOrderComposerOpen(false);
      setComposerPicks([]);
      void requestRefresh("order-created", { silent: true, force: true });
    } catch (createError) {
      const outOfStock = asArray(createError?.responseBody?.out_of_stock);
      toast.error(outOfStock.length
        ? t("aiSupport.inbox.order.outOfStockLines", { lines: outOfStock.map((item) => `${item.product_name} ${item.variant_name} (${item.available})`).join("، ") })
        : createError?.responseBody?.message || createError?.message || t("aiSupport.inbox.order.saveFailed"));
    } finally {
      setOrderComposerBusy(false);
    }
  }, [headers, requestRefresh, selectedConversation, selectedConversationRouteId, t, tenantId]);

  const openAvailableBySizePicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: true, sizeMode: true, allowMultiple: true, orderMode: false, selectMode: false, restockMode: false });
  }, []);

  const openOrderCartPicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: true, sizeMode: false, allowMultiple: true, orderMode: true, selectMode: false, restockMode: false });
  }, []);

  const openRestockPicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: true, sizeMode: false, allowMultiple: true, orderMode: false, selectMode: false, restockMode: true });
  }, []);

  const closeAvailableBySizePicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: false, sizeMode: false, allowMultiple: false, orderMode: false, selectMode: false, restockMode: false });
  }, []);

  // The picker does NOT always carry a variant_id — the multi-select path builds
  // its card before a colour/size is chosen — so colour+size travel with the line
  // and the server resolves the variant. Filtering on variant_id here silently
  // emptied the cart on the desktop once.
  const normalizeChosenCartCard = (card = {}) => ({
    product_id: card.product_id || card.id || null,
    id: card.product_id || card.id || null,
    variant_id: card.variant_id || null,
    product_name: card.product_name || card.name || "",
    name: card.product_name || card.name || "",
    image_url: card.image_url || card.image || card.thumbnail_url || "",
    storefront_url: card.storefront_url || card.product_url || card.url || "",
    product_url: card.storefront_url || card.product_url || card.url || "",
    color: card.color || "",
    size: card.size || "",
    price: card.price ?? card.display_price ?? null,
    display_price: card.display_price ?? card.price ?? null,
    available_sizes: card.available_sizes || card.sizes || [],
    grounded: false,
    in_stock: true,
  });

  // Each hand-over carries a batch id: the composer appends a batch once and
  // never has to clear this shared state (clearing it raced the append).
  const handleOrderCartPickerSubmit = useCallback((cards = []) => {
    const picked = asArray(cards).map(normalizeChosenCartCard).filter((card) => card.product_id);
    // Each restock pick names a variant to watch for a back-in-stock request; a
    // fresh object every time, because the drawer keys its "picks arrived"
    // effect on identity and appends (re-picking the same variant must register).
    if (availableBySizePickerConfig.restockMode) {
      if (picked.length) setRestockPick({ batch: performance.now(), cards: picked });
      closeAvailableBySizePicker();
      return Promise.resolve();
    }
    // "Change product" on a suggestion resolves ONE identity and never sends.
    if (availableBySizePickerConfig.selectMode) {
      const [first] = picked;
      if (first) {
        setSuggestionChosenCard(first);
        setSuggestionProductRemoved(false);
      }
      closeAvailableBySizePicker();
      return Promise.resolve();
    }
    setComposerPicks({
      batch: `${picked.length}:${picked.map((card) => `${card.product_id}-${card.variant_id || ""}-${card.color}-${card.size}`).join("|")}:${performance.now()}`,
      cards: picked,
    });
    closeAvailableBySizePicker();
    return Promise.resolve();
  }, [availableBySizePickerConfig.restockMode, availableBySizePickerConfig.selectMode, closeAvailableBySizePicker]);

  const sendAvailableBySizeCards = useCallback(
    async ({ message = "" } = {}) => {
      setAvailableBySizeSending(true);
      try {
        await sendManualReply(message);
      } finally {
        setAvailableBySizeSending(false);
        closeAvailableBySizePicker();
      }
    },
    [closeAvailableBySizePicker, sendManualReply]
  );

  const openImagePicker = useCallback(() => {
    if (!imageInputRef.current) return;
    imageInputRef.current.value = "";
    imageInputRef.current.click();
  }, []);

  const insertComposerEmoji = useCallback((emoji) => {
    const editor = composerEditorRef.current;
    const selection = window.getSelection?.();
    const hasEditorSelection = selection?.rangeCount && editor?.contains(selection.anchorNode);
    if (editor && hasEditorSelection) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(emoji);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      const nextText = String(editor.innerText || "").replace(/\u00a0/g, " ");
      setComposerText(nextText);
      editor.focus();
      return;
    }
    setComposerText((current) => `${current || ""}${emoji}`);
    window.requestAnimationFrame(() => editor?.focus());
  }, []);

  /*
   * The picker used to open, take a file, and answer "not supported" — the
   * button existed but nothing behind it did. The channel senders all accept
   * media by URL, so the file is uploaded and sent in one request; see
   * POST /conversations/:id/attachment.
   */
  const handleImageAttachmentChange = useCallback(async (event) => {
    const file = event.target.files?.[0] || null;
    // Reset before the await: picking the same file twice must fire onChange
    // again, and it will not while the value is still set.
    event.target.value = "";
    const sessionId = selectedConversation?.session_id;
    if (!file || !sessionId) return;
    if (attachmentSendingRef.current) return;
    attachmentSendingRef.current = true;
    const canonicalSessionId = selectedConversationRouteId || sessionId;
    const caption = cleanMessageText(composerText);
    const form = new FormData();
    form.append("file", file);
    form.append("tenant_id", String(tenantId || ""));
    if (caption) form.append("caption", caption);
    form.append("client_request_id", buildClientRequestId());
    setSending(true);
    try {
      const payload = await api.post(
        aiInboxConversationEndpoint(canonicalSessionId, "/attachment"),
        form,
        { headers, perfComponent: "AiInboxPwa.sendAttachment" }
      );
      if (payload?.message) {
        patchConversation(selectedConversation.conversation_key || sessionId, (conversation) => ({
          ...conversation,
          messages: mergeMessagesByIdentity([...asArray(conversation.messages), payload.message]),
          latest_message_preview: caption || t("aiSupport.inbox.composer.imagePreview"),
          last_activity_at: payload.message.created_at || new Date().toISOString(),
          updated_at: payload.message.created_at || new Date().toISOString(),
        }));
      }
      setComposerText("");
      // The transcript row is written even when the channel refused it, so the
      // 201 is not by itself proof of delivery.
      if (payload?.delivery_status === "failed") {
        toast.error(payload?.delivery_error || t("aiSupport.inbox.composer.imageSendFailed"));
      } else {
        toast.success(t("aiSupport.inbox.composer.imageSent"));
      }
    } catch (error) {
      toast.error(error?.message || t("aiSupport.inbox.composer.imageSendFailed"));
    } finally {
      attachmentSendingRef.current = false;
      setSending(false);
    }
  }, [composerText, headers, patchConversation, selectedConversation, selectedConversationRouteId, t, tenantId]);

  const toggleConversationAi = useCallback(async () => {
    if (!selectedConversation?.session_id) return;
    setAiToggling(true);
    try {
      const identifiers = conversationIdentifiers(selectedConversation);
      const sessionId = identifiers.sessionId;
      const conversationIdentifier = identifiers.conversationKey || sessionId;
      const workflowStatus = conversationWorkflowStatus(selectedConversation);
      const nextEnabled = !isConversationAiEnabled(selectedConversation);
      const payload = workflowStatus === "human_takeover"
        ? await api.post(
            aiInboxConversationEndpoint(conversationIdentifiers(selectedConversation).conversationId || sessionId, "/return-to-ai"),
            { tenant_id: tenantId, channel: selectedConversation.channel || selectedConversation.source || "" },
            { headers, perfComponent: "AiInboxPwa.returnToAi" }
          )
        : await api.patch(
            aiInboxConversationEndpoint(conversationIdentifiers(selectedConversation).conversationId || sessionId, "/ai-enabled"),
            {
              tenant_id: tenantId,
              conversation_id: sessionId,
              ai_enabled: nextEnabled,
              channel: selectedConversation.channel || selectedConversation.source || "",
              external_conversation_id: selectedConversation.external_conversation_id || "",
            },
            { headers, perfComponent: "AiInboxPwa.aiToggle" }
          );
      const returnedConversation = payload.conversation || {};
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        ...returnedConversation,
        conversation_status: returnedConversation.conversation_status || returnedConversation.status || conversation.conversation_status || "ai_active",
        status: returnedConversation.status || returnedConversation.conversation_status || conversation.status || "ai_active",
        human_takeover: returnedConversation.human_takeover !== undefined ? returnedConversation.human_takeover : conversation.human_takeover,
        ai_paused: returnedConversation.ai_paused !== undefined ? returnedConversation.ai_paused : conversation.ai_paused,
        ai_enabled: returnedConversation.ai_enabled !== undefined ? returnedConversation.ai_enabled : (workflowStatus === "human_takeover" ? true : nextEnabled),
      }));
      toast.success(workflowStatus === "human_takeover" ? "أعيدت المحادثة إلى الذكاء الاصطناعي." : (nextEnabled ? "AI enabled" : "AI paused"));
      requestRefresh("manual", { silent: true });
      setMenuOpen(false);
    } catch (toggleError) {
      toast.error(toggleError?.message || "Failed to update AI state");
    } finally {
      setAiToggling(false);
    }
  }, [headers, patchConversation, requestRefresh, selectedConversation, tenantId]);

  const toggleGlobalAiAssistant = useCallback(() => {
    void (async () => {
      setAiAssistantGlobalSaving(true);
      try {
        const nextEnabled = !aiAssistantGlobalEnabled;
        const payload = await api.patch("/ai-agent/settings/ai-assistant-global", {
          tenant_id: tenantId,
          ai_assistant_global_enabled: nextEnabled,
          enabled: nextEnabled,
        }, { headers, perfComponent: "AiInboxPwa.globalAiToggle" });
        const resolvedEnabled = payload?.ai_assistant_global_enabled !== false;
        setAiAssistantGlobalEnabled(resolvedEnabled);
        toast.success(resolvedEnabled ? "تم تشغيل مساعد الذكاء الاصطناعي لكل المحادثات." : "مساعد الذكاء الاصطناعي متوقف على كل المحادثات.");
        requestRefresh("manual", { silent: true });
      } catch (err) {
        toast.error(err?.message || "تعذر تحديث حالة مساعد الذكاء الاصطناعي العامة");
      } finally {
        setAiAssistantGlobalSaving(false);
      }
    })();
  }, [aiAssistantGlobalEnabled, headers, requestRefresh, tenantId]);

  const updateLeadStatus = useCallback(
    async (nextLeadStatus) => {
      if (!selectedConversation?.session_id) return;
      const leadStatus = normalizeLeadStatus(nextLeadStatus);
      const identifiers = conversationIdentifiers(selectedConversation);
      const sessionId = identifiers.sessionId;
      const conversationIdentifier = identifiers.conversationKey || sessionId;
      setLeadActionLoading("lead_status");
      try {
        const payload = await api.patch(
          aiAgentInboxEndpoint(sessionId, "/lead-status"),
          {
            tenant_id: tenantId,
            lead_status: leadStatus,
          },
          { headers, perfComponent: "AiInboxPwa.updateLeadStatus" }
        );
        const returned = payload.conversation || {};
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ...returned,
          lead_status: returned.lead_status || leadStatus,
          channel_metadata: {
            ...(conversation.channel_metadata || {}),
            ...(returned.channel_metadata || {}),
            lead_status: returned.lead_status || leadStatus,
          },
        }));
        requestRefresh("manual", { silent: true });
      } catch (err) {
        toast.error(err?.message || "تعذر تحديث حالة العميل المحتمل");
      } finally {
        setLeadActionLoading("");
      }
    },
    [headers, patchConversation, requestRefresh, selectedConversation, tenantId]
  );

  const createLeadCustomer = useCallback(async () => {
    if (!selectedConversation?.session_id) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    setLeadActionLoading("create_customer");
    try {
      const payload = await api.post(
        aiAgentInboxEndpoint(sessionId, "/create-customer"),
        { tenant_id: tenantId },
        { headers, perfComponent: "AiInboxPwa.createLeadCustomer" }
      );
      if (payload?.conversation) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          customer_profile: payload.conversation.customer_profile || conversation.customer_profile,
          channel_metadata: payload.conversation.channel_metadata || conversation.channel_metadata,
        }));
      }
      requestRefresh("manual", { silent: true });
      toast.success(t("aiSupport.inbox.pwa.customerCreated"));
    } catch (err) {
      toast.error(err?.message || "تعذر إنشاء العميل");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, requestRefresh, selectedConversation, tenantId]);

  const createLeadOpportunity = useCallback(async () => {
    if (!selectedConversation?.session_id) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    setLeadActionLoading("create_opportunity");
    try {
      const payload = await api.post(
        aiAgentInboxEndpoint(sessionId, "/create-opportunity"),
        { tenant_id: tenantId },
        { headers, perfComponent: "AiInboxPwa.createLeadOpportunity" }
      );
      if (payload?.conversation) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          customer_profile: payload.conversation.customer_profile || conversation.customer_profile,
          channel_metadata: payload.conversation.channel_metadata || conversation.channel_metadata,
        }));
      }
      requestRefresh("manual", { silent: true });
      toast.success(t("aiSupport.inbox.pwa.leadCreated"));
    } catch (err) {
      toast.error(err?.message || "تعذر إنشاء فرصة البيع");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, requestRefresh, selectedConversation, tenantId]);

  const sendLeadPrivateMessage = useCallback(async (targetComment = null) => {
    if (!selectedConversation?.session_id) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    const message = buildLeadPrivateMessageText(selectedConversation, targetComment || {});
    setLeadActionLoading("private_message");
    try {
      const payload = await api.post(
        aiAgentInboxEndpoint(sessionId, "/private-message"),
        {
          tenant_id: tenantId,
          message,
          comment_id: clean(targetComment?.comment_id || targetComment?.external_message_id || targetComment?.id || ""),
        },
        { headers, perfComponent: "AiInboxPwa.privateMessage" }
      );
      const sentAt = new Date().toISOString();
      const returnedMessage = payload?.message || {
        id: `private:${Date.now()}`,
        staff_message: message,
        sender_type: "staff",
        created_at: sentAt,
        message_type: "private_message",
      };
      patchConversation(conversationIdentifier, (conversation) => ({
        ...conversation,
        messages: mergeMessagesByIdentity([...asArray(conversation.messages), returnedMessage]),
        latest_message_preview: message,
        last_activity_at: returnedMessage.created_at || sentAt,
        updated_at: returnedMessage.created_at || sentAt,
      }));
      requestRefresh("manual", { silent: true });
      toast.success(t("aiSupport.inbox.pwa.privateMessageSent"));
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال الرسالة الخاصة");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, requestRefresh, selectedConversation, tenantId]);

  const sendLeadCommentReply = useCallback(async (targetComment = null) => {
    if (!selectedConversation?.session_id || !isCommentConversation(selectedConversation)) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    const commentId = clean(
      targetComment?.comment_id ||
        targetComment?.external_message_id ||
        targetComment?.id ||
        selectedConversation?.channel_metadata?.comment_id ||
        selectedConversation?.channel_metadata?.lead?.comment_id ||
        selectedConversation?.external_comment_id ||
        selectedConversation?.comment_id ||
        ""
    );
    if (!commentId) {
      toast.error(t("aiSupport.inbox.pwa.commentNotResolved"));
      return;
    }
    const message = buildLeadCommentReplyText(selectedConversation, targetComment || {});
    setLeadActionLoading("comment_reply");
    try {
      const payload = await api.post(
        `/ai-inbox/comments/${encodeURIComponent(commentId)}/reply`,
        {
          tenant_id: tenantId,
          reply_text: message,
        },
        { headers, perfComponent: "AiInboxPwa.commentReply" }
      );
      const sentAt = new Date().toISOString();
      if (payload?.message) {
        patchConversation(conversationIdentifier, (conversation) => ({
          ...conversation,
          messages: mergeMessagesByIdentity([...asArray(conversation.messages), payload.message]),
          latest_message_preview: message,
          last_activity_at: payload.message.created_at || sentAt,
          updated_at: payload.message.created_at || sentAt,
        }));
      }
      requestRefresh("manual", { silent: true });
      toast.success(t("aiSupport.inbox.pwa.commentReplied"));
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال رد الكومنت");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, patchConversation, requestRefresh, selectedConversation, tenantId]);

  const saveSocialReplySettings = useCallback(async () => {
    setSocialActionLoading("global_settings");
    try {
      await api.post(
        "/social-comments/auto-reply/settings",
        {
          tenant_id: tenantId,
          ...socialReplySettings,
        },
        { headers, perfComponent: "AiInboxPwa.socialReplySettings" }
      );
      toast.success(t("aiSupport.inbox.pwa.globalAutoReplySaved"));
        requestRefresh("manual", { silent: true });
    } catch (err) {
      toast.error(err?.message || "تعذر حفظ إعدادات الرد التلقائي العامة");
    } finally {
      setSocialActionLoading("");
    }
  }, [headers, requestRefresh, socialReplySettings, tenantId]);

  const saveSelectedSocialTemplate = useCallback(async () => {
    const postId = clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || "");
    if (!postId) return;
    setSocialActionLoading("post_template");
    try {
      await api.post(
        `/social-comments/posts/${encodeURIComponent(postId)}/template`,
        {
          tenant_id: tenantId,
          platform: clean(selectedSocialPost?.platform || "facebook"),
          ...(selectedSocialTemplate.template || {}),
        },
        { headers, perfComponent: "AiInboxPwa.socialPostTemplate" }
      );
      toast.success(t("aiSupport.inbox.pwa.postTemplateSaved"));
        requestRefresh("manual", { silent: true });
    } catch (err) {
      toast.error(err?.message || "تعذر حفظ قالب الرد لهذا البوست");
    } finally {
      setSocialActionLoading("");
    }
  }, [headers, requestRefresh, selectedSocialPost?.conversation_id, selectedSocialPost?.id, selectedSocialPost?.platform, selectedSocialPost?.post_id, selectedSocialTemplate.template, tenantId]);

  const refreshAfterSocialAutomation = useCallback(async (source = "unknown", payload = {}) => {
    console.info("AI_INBOX_PWA_REFRESH_AFTER_AUTOMATION", {
      source,
      socket_healthy: socketHealthy,
      ...payload,
    });
    if (!socketHealthy) {
      requestRefresh("manual", { silent: true });
    }
  }, [requestRefresh, socketHealthy]);

  const sendSelectedSocialCommentAction = useCallback(async (comment, action = "reply") => {
    const commentId = clean(comment?.comment_id || comment?.id || "");
    if (!commentId) return;
    const postId = clean(selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || selectedSocialPost?.id || comment?.post_id || "");
    const platform = clean(selectedSocialPost?.platform || comment?.platform || "facebook");
    const normalizedAction = action === "private_message" ? "private" : action;
    const publicReplyText = clean(
      selectedSocialTemplate.template?.template ||
      selectedSocialThread?.post?.rendered_reply ||
      selectedSocialThread?.post?.reply_text ||
      socialReplySettings.generic_template ||
      "أهلاً وسهلاً يا {{customer_name}} ❤️\nتم الرد في الخاص يا صديقي \nوعندنا شحن لجميع محافظات مصر \n━━━━━━━━━━━━━━━━━━\n العنوان:\nدمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️\n\n اللوكيشن:\nhttps://share.google/1e0cM7JVmxyLTpWVe"
    );
    const privateReplyText = clean(
      selectedSocialThread?.post?.rendered_private_reply ||
      selectedSocialThread?.post?.private_reply_text ||
      selectedSocialTemplate.template?.privateReplyTemplate ||
      selectedSocialTemplate.template?.template ||
      socialReplySettings.generic_template ||
      "تم الرد على حضرتك في الخاص ✅"
    );
    const optimisticTimestamp = new Date().toISOString();
    const optimisticMessage = {
      id: `optimistic:${action}:${commentId}:${optimisticTimestamp}`,
      comment_id: commentId,
      post_id: postId,
      platform,
      customer_name: firstUsefulCustomerName(
        comment?.customer_name,
        selectedSocialPost?.customer_name,
        comment?.from?.name,
        selectedSocialPost?.author_name
      ) || "Customer",
      customer_avatar_url: clean(comment?.customer_avatar_url || selectedSocialPost?.customer_avatar_url || ""),
      original_comment_text: action === "private_message" ? privateReplyText : publicReplyText,
      comment_text: action === "private_message" ? privateReplyText : publicReplyText,
      message_text: action === "private_message" ? privateReplyText : publicReplyText,
      reply_status: "pending",
      automation_status: "pending",
      created_at: optimisticTimestamp,
      updated_at: optimisticTimestamp,
      __optimistic: true,
    };
    setSocialActionLoading(`${normalizedAction}:${commentId}`);
    setSelectedSocialThread((current) => ({
      ...current,
      comments: [optimisticMessage, ...asArray(current.comments)],
    }));
    setSocialComments((current) => {
      const currentItems = asArray(current.items);
      const matchIndex = currentItems.findIndex((item) => fastSocialCommentItemMatches(item, { id: commentId, comment_id: commentId, external_comment_id: commentId, post_id: postId }));
      if (matchIndex < 0) return current;
      const nextItem = {
        ...currentItems[matchIndex],
        reply_status: "pending",
        automation_status: "pending",
        last_activity_at: optimisticTimestamp,
      };
      const nextItems = [nextItem, ...currentItems.filter((_, index) => index !== matchIndex)];
      return { ...current, items: nextItems };
    });
    try {
      if (action === "ignore") {
        await api.post(
          `/social-comments/comments/${encodeURIComponent(commentId)}/ignore`,
          {
            tenant_id: tenantId,
            platform,
            post_id: postId,
          },
          { headers, perfComponent: "AiInboxPwa.socialCommentIgnore" }
        );
        toast.success(t("aiSupport.inbox.pwa.commentIgnored"));
      } else if (action === "private_message") {
        console.info("SOCIAL_COMMENT_PRIVATE_REPLY_ATTEMPT", {
          comment_id: commentId,
          post_id: postId,
          platform,
          message_preview: privateReplyText.slice(0, 120),
        });
        await api.post(
          `/ai-agent/comments/${encodeConversationId(commentId)}/private-message`,
          {
            tenant_id: tenantId,
            platform,
            post_id: postId,
            comment_id: commentId,
            message: privateReplyText,
          },
          { headers, perfComponent: "AiInboxPwa.socialCommentPrivateReply" }
        );
        toast.success(t("aiSupport.inbox.pwa.privateMessageSent"));
        console.info("SOCIAL_COMMENT_PRIVATE_REPLY_SUCCESS", {
          comment_id: commentId,
          post_id: postId,
          platform,
        });
      } else {
        console.info("SOCIAL_COMMENT_REPLY_SEND_ATTEMPT", {
          comment_id: commentId,
          post_id: postId,
          platform,
          action,
          source: "pwa",
          message_preview: publicReplyText.slice(0, 120),
        });
        await api.post(
          `/ai-agent/comments/${encodeConversationId(commentId)}/reply`,
          {
            tenant_id: tenantId,
            platform,
            post_id: postId,
            reply_text: publicReplyText,
            message: publicReplyText,
          },
          { headers, perfComponent: "AiInboxPwa.socialCommentReply" }
        );
        toast.success(t("aiSupport.inbox.pwa.commentReplySent"));
        console.info("SOCIAL_COMMENT_REPLY_SEND_SUCCESS", {
          comment_id: commentId,
          post_id: postId,
          platform,
          action,
          source: "pwa",
        });
      }
      setSelectedSocialThread((current) => ({
        ...current,
        comments: asArray(current.comments).map((entry) =>
          clean(entry?.comment_id || entry?.id || "") === commentId && entry?.__optimistic
            ? { ...entry, reply_status: "sent", automation_status: "sent", updated_at: new Date().toISOString() }
            : entry
        ),
      }));
      setSocialComments((current) => ({
        ...current,
        items: asArray(current.items).map((item) =>
          fastSocialCommentItemMatches(item, { id: commentId, comment_id: commentId, external_comment_id: commentId, post_id: postId })
            ? { ...item, reply_status: "sent", automation_status: "sent", last_activity_at: new Date().toISOString() }
            : item
        ),
      }));
      await refreshAfterSocialAutomation(action, { comment_id: commentId, post_id: postId, platform });
    } catch (err) {
      if (action === "private_message") {
        console.warn("SOCIAL_COMMENT_PRIVATE_REPLY_FAILED", {
          comment_id: commentId,
          post_id: postId,
          platform,
          message: err?.message || String(err),
        });
      } else if (action === "ignore") {
        console.warn("SOCIAL_COMMENT_REPLY_SEND_FAILED", {
          comment_id: commentId,
          post_id: postId,
          platform,
          action,
          message: err?.message || String(err),
        });
      } else {
        console.warn("SOCIAL_COMMENT_REPLY_SEND_FAILED", {
          comment_id: commentId,
          post_id: postId,
          platform,
          action,
          message: err?.message || String(err),
        });
      }
      setSelectedSocialThread((current) => ({
        ...current,
        comments: asArray(current.comments).map((entry) =>
          clean(entry?.comment_id || entry?.id || "") === commentId && entry?.__optimistic
            ? { ...entry, reply_status: "failed", automation_status: "failed", error_message: err?.message || "failed" }
            : entry
        ),
      }));
      setSocialComments((current) => ({
        ...current,
        items: asArray(current.items).map((item) =>
          fastSocialCommentItemMatches(item, { id: commentId, comment_id: commentId, external_comment_id: commentId, post_id: postId })
            ? { ...item, reply_status: "failed", automation_status: "failed" }
            : item
        ),
      }));
      toast.error(err?.message || "تعذر تنفيذ إجراء التعليق");
    } finally {
      setSocialActionLoading("");
    }
  }, [headers, refreshAfterSocialAutomation, selectedSocialPost?.conversation_id, selectedSocialPost?.id, selectedSocialPost?.platform, selectedSocialPost?.post_id, selectedSocialTemplate.template?.template, selectedSocialTemplate.template?.privateReplyTemplate, selectedSocialThread?.post?.private_reply_text, selectedSocialThread?.post?.reply_text, selectedSocialThread?.post?.rendered_private_reply, selectedSocialThread?.post?.rendered_reply, socialReplySettings.generic_template, socketHealthy, tenantId]);

  const handleSocialCommentCustomerSelect = useCallback(
    (rawComment = {}, data = {}) => {
      const commentPlatform = clean(rawComment.platform || selectedSocialThread?.post?.platform || selectedSocialPost?.platform || "facebook");
      const commentId = clean(rawComment.comment_id || rawComment.id || "");
      const commentPostId = clean(rawComment.post_id || rawComment.postId || selectedSocialThread?.post?.post_id || selectedSocialPost?.post_id || selectedSocialPost?.conversation_id || "");
      const commentPageId = clean(rawComment.page_id || selectedSocialThread?.post?.page_id || selectedSocialPost?.page_id || "");
      const commenterName = clean(rawComment.customer_name || rawComment.commenter_name || rawComment.from_name || "مستخدم مجهول");
      const commenterAvatar = clean(rawComment.customer_avatar_url || rawComment.avatar_url || rawComment.profile_pic || "");
      openCustomerDrawer(
        {
          ...rawComment,
          customer_name: commenterName,
          customer_avatar_url: commenterAvatar,
          customer_profile_id: clean(rawComment.customer_profile_id || rawComment.customerProfileId || ""),
          platform: commentPlatform,
          post_id: commentPostId,
          page_id: commentPageId,
        },
        {
          source: "pwa_social_comment",
          platform: commentPlatform,
          postId: commentPostId,
          commentId,
          pageId: commentPageId,
          summary: data?.text || clean(rawComment.original_comment_text || rawComment.comment_text || rawComment.message_text || rawComment.text || rawComment.message || ""),
          lastActiveAt: clean(getSocialCommentRealTimestamp(rawComment).timestamp || ""),
          customerName: commenterName,
        }
      );
    },
    [openCustomerDrawer, selectedSocialPost?.conversation_id, selectedSocialPost?.page_id, selectedSocialPost?.platform, selectedSocialPost?.post_id, selectedSocialThread?.post?.page_id, selectedSocialThread?.post?.platform, selectedSocialThread?.post?.post_id]
  );
  const handleSocialCommentReply = useCallback((comment = {}) => sendSelectedSocialCommentAction(comment, "reply"), [sendSelectedSocialCommentAction]);
  const handleSocialCommentPrivateMessage = useCallback((comment = {}) => sendSelectedSocialCommentAction(comment, "private_message"), [sendSelectedSocialCommentAction]);
  const handleSocialCommentIgnore = useCallback((comment = {}) => sendSelectedSocialCommentAction(comment, "ignore"), [sendSelectedSocialCommentAction]);
  const handleSocialCommentCreateLead = useCallback(() => {}, []);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }, [installPrompt]);

  const contentScreen = isConversationMode && Boolean(selectedConversation);
  const selectedAnalysisCustomerId = clean(selectedConversation?.customer_profile_id || selectedConversation?.customerProfileId || selectedConversation?.external_customer_id || selectedConversation?.customer_profile?.id || selectedConversation?.id || "");
  const drawerAnalysisCustomerId = clean(customerDrawer.customerId || customerDrawer.customer?.customer_profile_id || customerDrawer.customer?.customerProfileId || customerDrawer.customer?.external_customer_id || customerDrawer.customer?.customer_profile?.id || customerDrawer.customer?.id || "");
  const customerDrawerAnalysis = selectedAnalysisCustomerId && selectedAnalysisCustomerId === drawerAnalysisCustomerId ? aiIntegration.analysis : null;
  const fullscreenConversation = Boolean(isFullscreenConversation && contentScreen);
  // The API gates sending on ai_inbox_messenger:reply, separately from the
  // :view grant that opens this screen. Hide the composer for a read-only
  // operator instead of letting every send collect a 403.
  const showComposer = contentScreen && canReply;
  const selectedMetaLabel = getConversationSourceLabel(selectedConversation || {}, t);
  const SelectedChannelIcon = getConversationSourceIcon(selectedConversation || {});
  const currentLeadStatus = conversationLeadStatus(selectedConversation || {});
  const selectedWorkflowStatus = conversationWorkflowStatus(selectedConversation || {});
  const selectedConversationAiEnabled = isConversationAiEnabled(selectedConversation || {});
  const selectedAvatar = isCommentConversation(selectedConversation || {}) ? commentThreadCustomerAvatarUrl(selectedConversation || {}) : customerAvatarUrl(selectedConversation || {});
  const selectedLastSeen = relativeSeenLabel(
    selectedConversation?.last_activity_at || selectedConversation?.updated_at,
    i18n.resolvedLanguage === "ar" ? "ar" : "en",
    t
  );
  const lastOrder = asArray(selectedConversation?.customer_profile?.previous_orders)[0] || selectedConversation?.last_order || selectedConversation?.order || null;
  const confirmationMeta = confirmationStatusMeta(lastOrder?.status);
  const quickActionBusy = Boolean(leadActionLoading || aiToggling || productSending || availableBySizeSending || sending);
  const isRtlLayout =
    typeof document !== "undefined" &&
    ((document.documentElement.dir || document.body?.dir || "").toLowerCase() === "rtl");

  const renderSocialCommentsWorkspace = () => {
    const selectedPost = selectedSocialPost || null;
    const selectedPostImage = commentThreadPostImageUrl(selectedPost || {});
    const threadPostImage = commentThreadPostImageUrl(selectedSocialThread?.post || {});
    const postImage = selectedPostImage || threadPostImage;
    const postCaption = clean(
      selectedPost?.post_caption ||
      selectedPost?.post_message ||
      selectedPost?.last_message ||
      selectedPost?.post_text ||
      ""
    );
    const postLink = clean(
      selectedPost?.post_permalink ||
      selectedPost?.post_permalink_url ||
      selectedPost?.permalink_url ||
      selectedPost?.post_url ||
      ""
    );
    const platformLabel = clean(selectedPost?.platform || "facebook");
    const commentCount = Math.max(
      Number(selectedPost?.comments_count || selectedPost?.comment_count || 0),
      Number(selectedSocialThread?.post?.comments_count || selectedSocialThread?.post?.comment_count || 0),
      selectedSocialThread.comments.length
    );
    const newCommentCount = Number(selectedPost?.new_comments_count || 0);
    const selectedTemplate = selectedSocialTemplate.template || null;
    const templateText = clean(selectedTemplate?.template || "");
    const templateMode = clean(selectedTemplate?.mode || socialReplySettings.mode || "manual_approval") || "manual_approval";
    const templateEnabled = Boolean(selectedTemplate?.enabled);
    const genericTemplateText = clean(socialReplySettings.generic_template || "");
    const showProductSkeleton = Boolean(selectedSocialThread.loading && !clean(selectedSocialThread?.post?.product_name || selectedPost?.product_name || ""));
    const showTemplateSkeleton = Boolean(selectedSocialTemplate.loading && !templateText);
    const showTimelineSkeleton = Boolean(selectedSocialThread.loading && !selectedSocialThread.comments.length);

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <aside className={`${socialMobileDetailOpen ? "hidden lg:block" : "block"} min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm`}>
            <div className="hidden rounded-2xl border border-slate-200 bg-slate-950/5 p-3 lg:block">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.inbox.ui.autoReplySystem")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_enabled ? "bg-emerald-300 text-slate-950" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  {socialReplySettings.generic_enabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off")}
                </button>
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_like_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  {t("aiSupport.inbox.pwa.likeState", { state: socialReplySettings.generic_like_enabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off") })}
                </button>
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_reply_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  {t("aiSupport.inbox.pwa.replyState", { state: socialReplySettings.generic_reply_enabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off") })}
                </button>
                <select
                  value={socialReplySettings.mode}
                  onChange={(event) => setSocialReplySettings((current) => ({ ...current, mode: event.target.value }))}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                >
                  <option value="off">{t("aiSupport.inbox.ui.offLabel")}</option>
                  <option value="draft">{t("aiSupport.inbox.ui.draftOnly")}</option>
                  <option value="manual_approval">{t("aiSupport.inbox.ui.manualApproval")}</option>
                  <option value="full_auto">{t("aiSupport.inbox.ui.fullAuto")}</option>
                </select>
                <button
                  type="button"
                  onClick={saveSocialReplySettings}
                  disabled={socialActionLoading === "global_settings"}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                >
                  {socialActionLoading === "global_settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("aiSupport.inbox.pwa.save")}
                </button>
              </div>
              <textarea
                value={socialReplySettings.generic_template}
                onChange={(event) => setSocialReplySettings((current) => ({ ...current, generic_template: event.target.value }))}
                rows={4}
                placeholder={t("aiSupport.inbox.ui.genericTemplate")}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none"
              />
              <div className="mt-2 text-[11px] font-semibold text-slate-500">
                {t("aiSupport.inbox.pwa.autoReplySummary", { mode: socialReplySettings.mode, like: socialReplySettings.generic_like_enabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off"), reply: socialReplySettings.generic_reply_enabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off") })}
              </div>
            </div>

            {/* Facebook and Instagram posts arrive in one list; this narrows it
                to one platform, the same control the desktop workspace has. */}
            <div className="flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
              {[
                { key: "all", label: t("aiSupport.inbox.filters.all") },
                { key: "facebook", label: t("aiSupport.inbox.pwa.messenger") },
                { key: "instagram", label: t("aiSupport.inbox.pwa.instagram") },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSocialPostsPlatformFilter(item.key)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-black ${socialPostsPlatformFilter === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-hidden lg:mt-2">
              <SocialCommentsPanel
                items={visibleSocialPosts}
                totalItemsCount={socialPosts.length}
                loading={socialComments.loading}
                error={socialComments.error}
                filter={socialCommentsFilter}
                debugInfo={DEBUG_SOCIAL_PERF ? socialCommentsDebug : null}
                mode="posts"
                selectedItemId={socialPostIdentity(selectedPost || {})}
                onSelectItem={(item) => {
                  const nextPostId = socialPostIdentity(item);
                  console.info("AI_INBOX_OPEN_SOCIAL_COMMENT", {
                    post_id: clean(item?.post_id || item?.conversation_id || item?.id || socialPostIdentity(item) || ""),
                    comment_id: clean(item?.comment_id || item?.external_comment_id || item?.provider_comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || ""),
                    platform: clean(item?.platform || item?.source_platform || item?.channel || item?.source || ""),
                    tenant: clean(tenantId),
                    page_id: clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || ""),
                    customer_name: clean(item?.customer_name || item?.commenter_name || item?.author_name || item?.from_name || item?.metadata?.customer_name || item?.metadata?.commenter_name || ""),
                    url: `/inbox?tab=social_comments&postId=${encodeURIComponent(nextPostId)}`,
                  });
                  updateUrlState({ nextTab: "social_comments", nextConversationId: "", nextPostId, replace: false });
                  setSocialMobileDetailOpen(true);
                  window.requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
                }}
                onFilterChange={setSocialCommentsFilter}
                onRefresh={() => {
                  socialCommentsLoadedRef.current = false;
                  void requestRefresh("manual", { silent: true });
                  void loadSocialComments({ silent: false });
                }}
                nextCursor={socialCommentsCursor}
                onLoadMore={loadMoreSocialComments}
                loadingMore={socialCommentsLoadingMore}
                onLinkProduct={(item) => setProductLinksPost(item)}
                onPrefetchItem={(item) => {
                  const postId = clean(item?.post_id || item?.conversation_id || item?.id || socialPostIdentity(item) || "");
                  if (!ENABLE_SOCIAL_FAST_CENTER || !postId) return;
                  void prefetchSocialWorkspace({
                    api,
                    headers,
                    tenantId,
                    postId,
                    platform: clean(item?.platform || item?.source_platform || item?.channel || item?.source || ""),
                  });
                }}
              />
            </div>
          </aside>

          <div className={`${socialMobileDetailOpen ? "block" : "hidden lg:block"} min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm`}>
            {selectedPost ? (
              <div className="flex min-h-0 flex-col gap-2 lg:h-full">
                <button
                  type="button"
                  onClick={() => {
                    setSocialMobileDetailOpen(false);
                    window.requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
                  }}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-900 lg:hidden"
                >
                  <ChevronLeft className="h-5 w-5" />
                  {t("aiSupport.inbox.pwa.backToPosts")}
                </button>
                <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                      {postImage ? <img src={postImage} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.inbox.pwa.postPreview")}</div>
                      <h2 className="mt-1 line-clamp-3 text-lg font-black text-slate-900">{postCaption || t("aiSupport.inbox.pwa.post")}</h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{platformLabel}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{t("aiSupport.inbox.pwa.comment")}</span>
                        <span title={t("aiSupport.inbox.pwa.commentsTotalHint")} className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{t("aiSupport.inbox.pwa.commentCount", { count: commentCount })}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{t("aiSupport.inbox.pwa.newCount", { count: newCommentCount })}</span>
                        <span title={t("aiSupport.inbox.pwa.pendingCommentHint")} className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{selectedSocialThreadStatusLabel}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialPost?.platform || selectedSocialThread?.post?.platform || "Facebook")}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialThread?.post?.dm_status || selectedPost?.dm_status || selectedPost?.private_reply_status || t("aiSupport.inbox.pwa.manual"))}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialThread?.post?.product_name || selectedPost?.product_name || selectedSocialThread?.post?.product_id || selectedPost?.product_id || t("aiSupport.inbox.ui.product"))}</span>
                      </div>
                      <details className="mt-3 hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 lg:block">
                        <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.ui.developerInfo")}</summary>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {[
                            ["post_id", clean(selectedSocialThread?.post?.post_id || selectedPost?.post_id || selectedPost?.conversation_id || selectedPost?.id || "")],
                            ["page_id", clean(selectedSocialThread?.post?.page_id || selectedPost?.page_id || selectedPost?.metadata?.page_id || "")],
                            ["customer_name", clean(selectedSocialThread?.post?.customer_name || selectedPost?.customer_name || selectedPost?.customerName || "")],
                            ["customer_profile_id", clean(selectedSocialThread?.post?.customer_profile_id || selectedPost?.customer_profile_id || selectedPost?.customerProfileId || "")],
                            ["automation_status", clean(selectedSocialThreadStatusLabel)],
                            ["private_reply_status", clean(selectedSocialThread?.post?.dm_status || selectedPost?.dm_status || selectedPost?.private_reply_status || "")],
                            ["last_ai_action", clean(selectedSocialThread?.post?.last_ai_action || selectedPost?.last_ai_action || "")],
                            ["product_context", clean(selectedSocialThread?.post?.product_name || selectedPost?.product_name || selectedSocialThread?.post?.product_id || selectedPost?.product_id || "")],
                          ]
                            .filter(([, value]) => Boolean(value))
                            .map(([label, value]) => (
                              <div key={label} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
                                <div className="mt-1 truncate text-xs font-black text-slate-900">{value}</div>
                              </div>
                            ))}
                        </div>
                      </details>
                      {postLink ? (
                        <a href={postLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">
                          <ExternalLink className="h-4 w-4" />
                          {t("aiSupport.inbox.pwa.openPost")}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="hidden rounded-2xl border border-slate-200 bg-slate-950/5 p-3 lg:block">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.inbox.pwa.linkedProduct")}</div>
                    <button type="button" className="inline-flex h-8 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-600" disabled>
                      <ShoppingBag className="h-4 w-4" />
                      {t("aiSupport.inbox.picker.sendProduct")}
                    </button>
                  </div>
                  {showProductSkeleton ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {[1, 2, 3, 4, 5, 6].map((item) => (
                        <div key={item} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-2.5">
                          <div className="h-3 w-16 rounded bg-slate-200" />
                          <div className="mt-2 h-4 w-24 rounded bg-slate-200" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.pwa.name")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_name || "—")}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.ui.price")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_price || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.pwa.salePrice")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_sale_price || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.ui.sizes")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_sizes || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.ui.colors")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_colors || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.ui.stock2")}</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_stock || selectedPost?.stock || "—") || "—"}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="hidden rounded-2xl border border-slate-200 bg-slate-950/5 p-3 lg:block">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.inbox.ui.postTemplate")}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">{t("aiSupport.inbox.pwa.templateMode", { mode: templateMode })}</div>
                    </div>
                    <button
                      type="button"
                      onClick={saveSelectedSocialTemplate}
                      disabled={socialActionLoading === "post_template"}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                    >
                      {socialActionLoading === "post_template" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {t("aiSupport.inbox.pwa.save")}
                    </button>
                  </div>
                  {showTemplateSkeleton ? (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3].map((item) => <div key={item} className="h-9 rounded-xl bg-slate-200 animate-pulse" />)}
                      </div>
                      <div className="h-24 rounded-2xl bg-slate-200 animate-pulse" />
                      <div className="h-20 rounded-2xl bg-slate-200 animate-pulse" />
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), enabled: !templateEnabled } }))}
                          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${templateEnabled ? "bg-emerald-300 text-slate-950" : "border border-slate-200 bg-white text-slate-700"}`}
                        >
                          {templateEnabled ? t("aiSupport.inbox.pwa.enabled") : t("aiSupport.inbox.pwa.disabled")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), like_enabled: !(current.template?.like_enabled ?? true) } }))}
                          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${(selectedTemplate?.like_enabled ?? true) ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                        >
                          {t("aiSupport.inbox.pwa.likeState", { state: selectedTemplate?.like_enabled === false ? t("aiSupport.inbox.pwa.off") : t("aiSupport.inbox.pwa.on") })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), reply_enabled: !(current.template?.reply_enabled ?? true) } }))}
                          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${(selectedTemplate?.reply_enabled ?? true) ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                        >
                          {t("aiSupport.inbox.pwa.replyState", { state: selectedTemplate?.reply_enabled === false ? t("aiSupport.inbox.pwa.off") : t("aiSupport.inbox.pwa.on") })}
                        </button>
                        <select
                          value={templateMode}
                          onChange={(event) => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), mode: event.target.value } }))}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        >
                          <option value="off">{t("aiSupport.inbox.ui.offLabel")}</option>
                          <option value="draft">{t("aiSupport.inbox.ui.draftOnly")}</option>
                          <option value="manual_approval">{t("aiSupport.inbox.ui.manualApproval")}</option>
                          <option value="full_auto">{t("aiSupport.inbox.ui.fullAuto")}</option>
                        </select>
                      </div>
                      <textarea
                        value={templateText}
                        onChange={(event) => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), template: event.target.value } }))}
                        rows={4}
                        placeholder={t("aiSupport.inbox.ui.postTemplateHint")}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none"
                      />
                      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.pwa.preview")}</div>
                        <div className="mt-2 whitespace-pre-wrap">{templateText || genericTemplateText || t("aiSupport.inbox.pwa.noTemplateText")}</div>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.inbox.ui.commentsTimeline")}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">{t("aiSupport.inbox.pwa.commentCount", { count: selectedSocialThread.comments.length })}</div>
                    </div>
                    {selectedSocialThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
                  </div>
                  {/* A reel and its cross-posted copy land in one thread, so the
                      operator needs to be able to answer one platform at a time. */}
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {[
                      { key: "all", label: t("aiSupport.inbox.filters.all") },
                      { key: "facebook", label: t("aiSupport.inbox.pwa.messenger") },
                      { key: "instagram", label: t("aiSupport.inbox.pwa.instagram") },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSocialThreadPlatformFilter(item.key)}
                        className={`whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-black ${socialThreadPlatformFilter === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {selectedSocialThread.error ? (
                    <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{selectedSocialThread.error}</div>
                  ) : null}
                  <div className="mt-2 space-y-2 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    {showTimelineSkeleton ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((item) => (
                          <div key={item} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="h-4 w-28 rounded bg-slate-200" />
                            <div className="mt-3 h-12 rounded-2xl bg-slate-200" />
                          </div>
                        ))}
                      </div>
                    ) : !selectedSocialThread.loading && !selectedSocialThread.comments.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                        {t("aiSupport.inbox.pwa.noSocialComments")}
                      </div>
                    ) : null}
                    {selectedSocialThread.comments.filter((comment) => {
                      if (socialThreadPlatformFilter === "all") return true;
                      const platform = clean(comment.platform || selectedSocialThread?.post?.platform || selectedPost?.platform || "facebook").toLowerCase();
                      return socialThreadPlatformFilter === "instagram"
                        ? platform.includes("instagram")
                        : !platform.includes("instagram");
                    }).map((comment, index) => {
                      const commentPlatform = clean(comment.platform || selectedSocialThread?.post?.platform || selectedPost?.platform || "facebook");
                      if (import.meta.env.DEV && index === 0 && commentPlatform.toLowerCase().includes("facebook")) {
                        console.log({
                          post_id: clean(comment.post_id || comment.postId || selectedSocialThread?.post?.post_id || selectedPost?.post_id || selectedPost?.conversation_id || ""),
                          comment_id: clean(comment.comment_id || comment.id || ""),
                          latest_comment: comment?.latest_comment || null,
                          metadata: comment?.metadata || {},
                          created_at: comment.created_at || "",
                          updated_at: comment.updated_at || "",
                          last_comment_at: comment.last_comment_at || "",
                          latest_comment_at: comment.latest_comment_at || "",
                          comment_created_time: comment.comment_created_time || "",
                          source_created_time: comment.source_created_time || "",
                        });
                      }
                      return (
                        <SocialCommentsWorkspaceCommentRow
                          key={clean(comment.comment_id || comment.id || comment.created_at || `${index}`)}
                          comment={comment}
                          selectedCommentKey=""
                          highlightedCommentKey=""
                          activePostPlatform={commentPlatform}
                          replyDraft={templateText || genericTemplateText}
                          replyLoadingKey={socialActionLoading.startsWith("reply:") ? socialActionLoading.slice("reply:".length) : ""}
                          privateMessageLoadingKey={socialActionLoading.startsWith("private:") ? socialActionLoading.slice("private:".length) : ""}
                          privateMessageStatus={clean(comment.private_reply_status || comment.dm_status || selectedSocialThread?.post?.dm_status || "")}
                          leadLoadingKey=""
                          ignoreLoadingKey={socialActionLoading.startsWith("ignore:") ? socialActionLoading.slice("ignore:".length) : ""}
                          onSelectCustomer={handleSocialCommentCustomerSelect}
                          onReply={handleSocialCommentReply}
                          onPrivateMessage={handleSocialCommentPrivateMessage}
                          onCreateLead={handleSocialCommentCreateLead}
                          onIgnore={handleSocialCommentIgnore}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid min-h-[20rem] place-items-center rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                {t("aiSupport.inbox.pwa.noSocialComments")}
              </div>
            )}
          </div>
        </div>
        <PostProductLinksDrawer
          open={Boolean(productLinksPost)}
          post={productLinksPost}
          tenantId={tenantId}
          onClose={() => setProductLinksPost(null)}
          onSaved={(payload = {}) => {
            const linkedProducts = asArray(payload?.linked_products);
            const primaryProduct = payload?.primary_product || payload?.primary_linked_product || linkedProducts[0] || null;
            const targetKey = socialPostIdentity(productLinksPost || {});
            setSocialComments((current) => ({
              ...current,
              items: asArray(current.items).map((item) =>
                socialPostIdentity(item) === targetKey
                  ? {
                      ...item,
                      linked_products: linkedProducts,
                      linked_products_count: Number(payload?.count ?? linkedProducts.length ?? 0) || 0,
                      has_direct_product_link: linkedProducts.length > 0,
                      primary_product: primaryProduct,
                      primary_linked_product: primaryProduct,
                      product_name: clean(primaryProduct?.name || primaryProduct?.title || primaryProduct?.product_name || ""),
                      product_id: primaryProduct?.id || primaryProduct?.product_id || null,
                      product_link_source: linkedProducts.length ? "v2_direct" : "none",
                      post_link_key: clean(payload?.post_link_key || item?.post_link_key || ""),
                      product_link_identity: payload?.product_link_identity || item?.product_link_identity || null,
                      mapping_summary: {
                        ...(item?.mapping_summary || {}),
                        linked_products: linkedProducts,
                        primary_product: primaryProduct,
                        count: Number(payload?.count ?? linkedProducts.length ?? 0) || 0,
                      },
                    }
                  : item
              ),
            }));
          }}
        />
      </div>
    );
  };

  return (
    <div className="ai-inbox-pwa h-dvh overflow-hidden bg-slate-50 text-slate-900">
      <div className="ai-pwa-shell mx-auto flex h-full w-full flex-col bg-slate-50">
        <QuickRepliesConfig
          open={quickRepliesConfigOpen}
          onClose={() => setQuickRepliesConfigOpen(false)}
          replies={quickRepliesStore.quickReplies}
          loading={quickRepliesStore.loading}
          saving={quickRepliesStore.saving}
          onCreate={quickRepliesStore.createReply}
          onUpdate={quickRepliesStore.updateReply}
          onDelete={quickRepliesStore.deleteReply}
          onReorder={quickRepliesStore.reorderReplies}
          light={!isDarkTheme}
        />
        {contentScreen && tab === "conversations" ? (
          <header
            ref={conversationHeaderRef}
            className="ai-pwa-fixed ai-pwa-conversation-header fixed inset-x-0 top-0 z-[60] mx-auto w-full border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur"
          >
            <div className="ai-pwa-conversation-top flex items-center justify-between gap-3" style={{ flexDirection: isRtlLayout ? "row-reverse" : "row" }}>
              <div className="ai-pwa-conversation-identity flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleBackNavigation}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label={t("aiSupport.inbox.pwa.backToConversations")}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {selectedAvatar ? (
                  <AvatarZoom
                    url={selectedAvatar}
                    name={isCommentConversation(selectedConversation || {}) ? commentThreadCommenterName(selectedConversation || {}) : conversationName(selectedConversation)}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openCustomerDrawer(selectedConversation || {}, {
                          customerId: clean(selectedConversation?.customer_profile_id || selectedConversation?.customerProfileId || selectedConversation?.external_customer_id || selectedConversation?.customer_profile?.id || selectedConversation?.id || ""),
                          source: "pwa_header",
                          platform: clean(selectedConversation?.platform || selectedConversation?.channel || selectedConversation?.source || ""),
                        })
                      }
                      className="overflow-hidden rounded-full ring-1 ring-slate-200 transition hover:ring-cyan-300/40"
                      aria-label={t("aiSupport.inbox.pwa.openCustomerDetails")}
                    >
                      <CustomerAvatar
                        url={selectedAvatar}
                        name={isCommentConversation(selectedConversation || {}) ? commentThreadCommenterName(selectedConversation || {}) : conversationName(selectedConversation)}
                        className="h-10 w-10 shrink-0 rounded-full"
                        imgClassName="object-cover"
                        fallbackClassName="bg-slate-200 text-slate-600"
                      />
                    </button>
                  </AvatarZoom>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      openCustomerDrawer(selectedConversation || {}, {
                        customerId: clean(selectedConversation?.customer_profile_id || selectedConversation?.customerProfileId || selectedConversation?.external_customer_id || selectedConversation?.customer_profile?.id || selectedConversation?.id || ""),
                        source: "pwa_header",
                        platform: clean(selectedConversation?.platform || selectedConversation?.channel || selectedConversation?.source || ""),
                      })
                    }
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300"
                    aria-label={t("aiSupport.inbox.pwa.openCustomerDetails")}
                  >
                    <UserRound className="h-4.5 w-4.5" />
                  </button>
                )}
                <div className="ai-pwa-contact-copy min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      openCustomerDrawer(selectedConversation || {}, {
                        customerId: clean(selectedConversation?.customer_profile_id || selectedConversation?.customerProfileId || selectedConversation?.external_customer_id || selectedConversation?.customer_profile?.id || selectedConversation?.id || ""),
                        source: "pwa_header",
                        platform: clean(selectedConversation?.platform || selectedConversation?.channel || selectedConversation?.source || ""),
                      })
                    }
                    className="truncate text-left text-[15px] font-semibold leading-5 text-slate-900 hover:underline"
                  >
                    {isCommentConversation(selectedConversation || {}) ? commentThreadCommenterName(selectedConversation || {}) : conversationName(selectedConversation)}
                  </button>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                      <SelectedChannelIcon className={`h-3 w-3 ${isSocialCommentThread(selectedConversation || {}) ? "text-blue-600" : "text-cyan-600"}`} />
                      {selectedMetaLabel}
                    </span>
                    {selectedWorkflowStatus === "human_takeover" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                        <AlertCircle className="h-3 w-3" />
                        {t("aiSupport.inbox.ui.needsHuman")}
                      </span>
                    ) : null}
                    <span className="truncate">{selectedLastSeen}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {conversationLabels.slice(0, 3).map((label) => (
                      <span key={label.id} className={`inline-flex h-5 items-center rounded-md border px-1.5 text-[10px] font-black ${conversationLabelClass(label.color)}`}>
                        {label.name}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setLabelsOpen(true)}
                      className="inline-flex h-5 items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-black text-slate-500"
                    >
                      <Tag className="h-3 w-3" />
                      {conversationLabels.length > 3 ? `+${conversationLabels.length - 3}` : t("aiSupport.inbox.pwa.labels")}
                    </button>
                  </div>
                  {lastOrder ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <PwaChip tone={confirmationMeta.tone}>{t(confirmationMeta.labelKey)}</PwaChip>
                      <span className="text-[10px] font-semibold text-slate-500">
                        {lastOrder.invoice_number || lastOrder.order_number || lastOrder.id}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="ai-pwa-header-actions relative flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={togglePwaTheme}
                  className="ai-pwa-icon-button inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label={isDarkTheme ? t("aiSupport.inbox.pwa.lightMode") : t("aiSupport.inbox.pwa.darkMode")}
                  title={isDarkTheme ? t("aiSupport.inbox.pwa.lightMode") : t("aiSupport.inbox.pwa.darkMode")}
                >
                  {isDarkTheme ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreenConversation((current) => !current)}
                  className="ai-pwa-icon-button inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label={fullscreenConversation ? t("aiSupport.inbox.pwa.restoreLayout") : t("aiSupport.inbox.header.expandLayout")}
                  title={fullscreenConversation ? t("aiSupport.inbox.pwa.restoreLayout") : t("aiSupport.inbox.header.expandLayout")}
                >
                  {fullscreenConversation ? <Minimize2 className="h-4.5 w-4.5" /> : <Maximize2 className="h-4.5 w-4.5" />}
                </button>
                <button
                  type="button"
                  ref={menuButtonRef}
                  onClick={() => setMenuOpen((current) => !current)}
                  className="ai-pwa-icon-button inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <MoreHorizontal className="h-4.5 w-4.5" />
                </button>
                <HeaderOverflowMenu
                  open={menuOpen}
                  anchorRef={menuButtonRef}
                  onClose={() => setMenuOpen(false)}
                >
                  <button type="button" onClick={() => { void toggleGlobalAiAssistant(); setMenuOpen(false); }} disabled={aiAssistantGlobalSaving} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">
                    <span className="flex items-center gap-3">
                      {aiAssistantGlobalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      {t("aiSupport.inbox.pwa.globalAiAssistant")}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${aiAssistantGlobalEnabled ? "bg-emerald-100 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {aiAssistantGlobalEnabled ? t("aiSupport.inbox.pwa.on") : t("aiSupport.inbox.pwa.off")}
                    </span>
                  </button>
                  <button type="button" onClick={() => { void toggleConversationAi(); setMenuOpen(false); }} disabled={aiToggling} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">
                    {aiToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    {selectedWorkflowStatus === "human_takeover" ? t("aiSupport.inbox.header.returnToAi") : isConversationAiEnabled(selectedConversation) ? t("aiSupport.inbox.header.aiOn") : t("aiSupport.inbox.header.aiOff")}
                  </button>
                  <button type="button" onClick={() => { setProductSheetOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                    <PackagePlus className="h-4 w-4" />
                    {t("aiSupport.inbox.picker.sendProduct")}
                  </button>
                  <button type="button" onClick={() => { setOrderComposerOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                    <ShoppingCart className="h-4 w-4" />
                    {t("aiSupport.inbox.pwa.createOrderFromConversation")}
                  </button>
                  <button type="button" onClick={() => { setComposerMode("note"); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                    <Sparkles className="h-4 w-4" />
                    {t("aiSupport.inbox.pwa.internalNote")}
                  </button>
                  {/* Turn the chat contact into a real customer record. The
                      handler existed here for months with no button on it. */}
                  <button
                    type="button"
                    onClick={() => { void createLeadCustomer(); setMenuOpen(false); }}
                    disabled={leadActionLoading === "create_customer"}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {leadActionLoading === "create_customer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                    {t("aiSupport.inbox.pwa.createCustomer")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast(t("aiSupport.inbox.pwa.blockApiUnavailable"));
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <ShieldBan className="h-4 w-4" />
                    {t("aiSupport.inbox.pwa.blockCustomer")}
                  </button>
                </HeaderOverflowMenu>
              </div>
            </div>
            {!fullscreenConversation ? (
              <div className="ai-pwa-conversation-toolbar mt-2">
                <div className="ai-pwa-status-card flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      leadStatusTone(currentLeadStatus) === "amber"
                        ? "bg-amber-400"
                        : leadStatusTone(currentLeadStatus) === "emerald"
                          ? "bg-emerald-400"
                          : "bg-blue-400"
                    }`} />
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{t("aiSupport.inbox.pwa.leadStatus")}</div>
                      <div className="truncate text-[12px] font-semibold text-slate-700">{leadStatusLabel(currentLeadStatus, t)}</div>
                    </div>
                  </div>
                  <label className="min-w-[8.5rem] shrink-0">
                    <span className="sr-only">{t("aiSupport.inbox.pwa.changeLeadStatus")}</span>
                    <select
                      value={currentLeadStatus}
                      onChange={(event) => void updateLeadStatus(event.target.value)}
                      disabled={leadActionLoading === "lead_status"}
                      className="h-8 w-full rounded-full border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 outline-none disabled:opacity-50"
                    >
                      {LEAD_STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {leadStatusLabel(status, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOrderComposerOpen(true)}
                  disabled={quickActionBusy || orderComposerBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800 disabled:opacity-50"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {t("aiSupport.inbox.pwa.createOrder")}
                </button>
                <button
                  type="button"
                  onClick={() => setProductSheetOpen(true)}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                  {t("aiSupport.inbox.picker.sendProduct")}
                </button>
                <button
                  type="button"
                  onClick={() => openAvailableBySizePicker()}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] font-semibold text-cyan-700 disabled:opacity-50"
                >
                  <Ruler className="h-3.5 w-3.5" />
                  {t("aiSupport.inbox.picker.availableBySize")}
                </button>
              </div>
              </div>
            ) : null}
          </header>
        ) : (
          <header className="ai-pwa-list-header border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{t("aiSupport.inbox.kpi.socialCenter")}</h1>
                <div className="flex shrink-0 items-center gap-2">
                  {tab === "conversations" ? (
                    // Webhooks only carry new events. This pulls the page's
                    // existing Messenger + Instagram threads out of the Graph API.
                    <button
                      type="button"
                      onClick={() => void syncMetaConversations()}
                      disabled={metaHistorySyncing}
                      className="ai-pwa-icon-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm ring-1 ring-slate-200 disabled:opacity-50"
                      aria-label={t("aiSupport.inbox.pwa.syncMeta")}
                      title={t("aiSupport.inbox.pwa.syncMetaHint")}
                    >
                      {metaHistorySyncing ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <FaFacebookMessenger className="h-4.5 w-4.5" />}
                    </button>
                  ) : null}
                  <InboxNotificationBell surface="/inbox" />
                  <button
                    type="button"
                    onClick={togglePwaTheme}
                    className="ai-pwa-icon-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                    aria-label={isDarkTheme ? t("aiSupport.inbox.pwa.lightMode") : t("aiSupport.inbox.pwa.darkMode")}
                    title={isDarkTheme ? t("aiSupport.inbox.pwa.lightMode") : t("aiSupport.inbox.pwa.darkMode")}
                  >
                    {isDarkTheme ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("aiSupport.inbox.pwa.searchMessages")}
                  className="h-10 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400"
                />
              </label>
              {tab === "conversations" ? (
                // A dead WhatsApp session looks exactly like a quiet day, which is
                // how one went unnoticed for 37 hours. Say it where the operator is
                // already looking.
                <WhatsappSessionAlert
                  headers={headers}
                  enabled={pageVisible}
                  onConnected={() => requestRefresh("whatsapp-reconnected", { silent: true, force: true })}
                />
              ) : null}
              {tab === "conversations" ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {MESSAGE_PLATFORM_FILTERS.map((item) => {
                    const unread = platformFilterUnread(item.key);
                    const activeChip = messagePlatformFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setMessagePlatformFilter(item.key)}
                        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-black ${activeChip ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                      >
                        {t(item.labelKey)}
                        {unread > 0 ? (
                          <span className={`inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black ${activeChip ? "bg-white/20 text-white" : "bg-emerald-500 text-white"}`}>
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {tab === "conversations" ? (
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
                    {[["all", t("aiSupport.inbox.ui.readFilterAll")], ["unread", t("aiSupport.inbox.ui.readFilterUnread")], ["read", t("aiSupport.inbox.ui.readFilterRead")]].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReadFilter(key)}
                        aria-pressed={readFilter === key}
                        className={`min-w-0 flex-1 truncate rounded-xl px-2 py-1.5 text-[11px] font-black transition ${readFilter === key ? "bg-slate-900 text-white" : "text-slate-500"}`}
                      >
                        {label}{key === "unread" && channelSummaries.all.unread > 0 ? ` (${channelSummaries.all.unread})` : ""}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFavoriteFilter(favoriteFilter === "favorites" ? "all" : "favorites")}
                    aria-pressed={favoriteFilter === "favorites"}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition ${favoriteFilter === "favorites" ? "border-amber-300 bg-amber-50 text-amber-600" : "border-slate-200 bg-white text-slate-400"}`}
                    aria-label={t("aiSupport.inbox.ui.favorites")}
                    title={t("aiSupport.inbox.ui.favorites")}
                  >
                    <Star className={`h-4 w-4 ${favoriteFilter === "favorites" ? "fill-current" : ""}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void markAllConversationsRead()}
                    disabled={!channelSummaries.all.unread}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition ${channelSummaries.all.unread ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-white text-slate-300"}`}
                    aria-label={t("aiSupport.inbox.ui.markAllRead")}
                    title={t("aiSupport.inbox.ui.markAllRead")}
                  >
                    <CheckCheck className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
              {tab === "conversations" && accountFilterOptions.length ? (
                <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
                  {[{ id: "all", label: t("aiSupport.inbox.ui.accountFilterAll") }, ...accountFilterOptions].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setAccountFilter(option.id)}
                      aria-pressed={accountFilter === option.id}
                      className={`shrink-0 truncate rounded-xl px-2.5 py-1.5 text-[11px] font-black transition ${accountFilter === option.id ? "bg-slate-900 text-white" : "text-slate-500"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </header>
        )}
        <main
          ref={mainScrollRef}
          onScroll={() => {
            const scroller = mainScrollRef.current;
            if (!scroller) return;
            setUserIsNearBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 140);
          }}
          className={`ai-pwa-main flex-1 min-h-0 overflow-y-auto px-2 ${contentScreen && tab === "conversations" ? "" : "pt-1.5"} ${showComposer ? "pb-[calc(5.9rem+env(safe-area-inset-bottom))]" : "pb-[calc(4.1rem+env(safe-area-inset-bottom))]"}`}
          style={contentScreen && tab === "conversations" ? { paddingTop: `${conversationHeaderHeight || 88}px` } : undefined}
        >
          {error && !loading ? (
            <div className="mb-3 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {isConversationMode ? (
            contentScreen ? (
              <>
                <AIInboxAnalysisPanel key={selectedConversation?.session_id || selectedConversation?.conversation_key} analysis={aiIntegration.analysis} copilot={aiIntegration.copilot} loading={aiIntegration.loading} cacheHit={aiIntegration.cacheHit} onTrack={aiIntegration.track} flags={aiIntegration.flags} />
                <OptimizedTranscript
                  conversation={selectedConversation}
                  rows={selectedTranscriptRows}
                  loadingOlder={olderLoading}
                  onLoadOlder={loadOlderMessages}
                  olderMessagesAvailable={Boolean(selectedConversation?.older_messages_available)}
                  onReplyComment={sendLeadCommentReply}
                  onPrivateMessage={sendLeadPrivateMessage}
                  onReact={["whatsapp", "instagram", "messenger"].includes(normalizeConversationChannel(selectedConversation || {})) ? reactToMessage : null}
                  onEditMessage={normalizeConversationChannel(selectedConversation || {}) === "whatsapp" ? editMessage : null}
                  onOpenCorrection={openReplyCorrection}
                  reactionOptions={normalizeConversationChannel(selectedConversation || {}) === "instagram" ? INSTAGRAM_MESSAGE_REACTIONS : normalizeConversationChannel(selectedConversation || {}) === "messenger" ? MESSENGER_MESSAGE_REACTIONS : undefined}
                />
              </>
            ) : filteredConversations.length ? (
              // Render the conversation list as soon as data exists. A background
              // refresh (visibility/socket/polling/filter re-entrancy) can leave
              // `loading` raised while conversations are already populated; the list
              // must never be hidden behind the spinner once we have rows to show.
              <div className="divide-y divide-slate-100 pb-2">
                {filteredConversations.map((conversation) => {
                  const identifiers = conversationIdentifiers(conversation);
                  const itemKey = clean(identifiers.conversationKey || identifiers.sessionId || identifiers.conversationId || messageKey(conversation));
                  return (
                    <div key={itemKey} className="py-0.5">
                      <ConversationListItem
                        conversation={conversation}
                        active={false}
                        accountLabel={conversationAccountLabel(conversation)}
                        onSelect={openConversation}
                        onToggleFavorite={toggleConversationFavorite}
                        onToggleRead={toggleConversationRead}
                      />
                    </div>
                  );
                })}
                {hasMoreConversations ? (
                  <div className="flex justify-center py-3">
                    <button
                      type="button"
                      onClick={() => void loadMoreConversations()}
                      disabled={loadingMoreConversations}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-[12px] font-semibold text-slate-700 shadow-sm disabled:opacity-60"
                    >
                      {loadingMoreConversations ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                      {loadingMoreConversations ? t("aiSupport.inbox.ui.loadingMore") : t("aiSupport.inbox.ui.loadMore")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : loading ? (
              <div className="grid min-h-60 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                {t("aiSupport.inbox.pwa.noMessagesMatch")}
              </div>
            )
          ) : isSocialMode ? (
            renderSocialCommentsWorkspace()
          ) : null}

          {tab === "leads" ? (
            <LeadsView
              conversations={conversations}
              search={debouncedSearch}
              leadFilter={leadFilter}
              onLeadFilterChange={setLeadFilter}
              onOpenConversation={openConversation}
            />
          ) : null}
          {tab === "more" ? <MoreView installAvailable={Boolean(installPrompt)} onInstall={installApp} /> : null}
        </main>

        {showComposer ? (
          <div className={`ai-pwa-fixed ai-pwa-composer fixed inset-x-0 z-20 mx-auto w-full px-2 ${contentScreen ? "bottom-[max(0.4rem,env(safe-area-inset-bottom))]" : "bottom-[calc(4rem+env(safe-area-inset-bottom))]"}`}>
            <div className="rounded-[24px] border border-slate-200 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
              {composerMode === "note" ? (
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("aiSupport.inbox.pwa.internalNoteMode")}
                </div>
              ) : null}
              {activeAiReplyValidation.violationsCount || activeAiReplyValidation.warningsCount || activeAiReplyValidation.details.length ? (
                <div className={`mb-2 rounded-2xl border px-3 py-2 text-[11px] leading-5 ${activeAiReplyValidation.violationsCount > 0 ? "border-amber-300/40 bg-amber-50 text-amber-900" : activeAiReplyValidation.warningsCount > 0 ? "border-slate-200 bg-slate-50 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t("aiSupport.inbox.pwa.aiDraftValidation")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyValidation.violationsCount > 0 ? "bg-amber-200 text-amber-950" : activeAiReplyValidation.warningsCount > 0 ? "bg-slate-200 text-slate-800" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyValidation.status}</span>
                    <span className="font-black">{activeAiReplyValidation.confidencePercent.toFixed(0)}%</span>
                    <span className="font-bold">{t("aiSupport.inbox.pwa.violationsCount", { count: activeAiReplyValidation.violationsCount })}</span>
                    <span className="font-bold">{t("aiSupport.inbox.pwa.warningsCount", { count: activeAiReplyValidation.warningsCount })}</span>
                  </div>
                  {activeAiReplyValidation.details.length ? <div className="mt-1.5 space-y-1">{activeAiReplyValidation.details.slice(0, 3).map((item) => <div key={item} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/80" /><span>{item}</span></div>)}</div> : null}
                </div>
              ) : null}
              {activeAiReplyConfidence.reasonsCount || activeAiReplyConfidence.riskFlagsCount || activeAiReplyConfidence.score ? (
                <div className={`mb-2 rounded-2xl border px-3 py-2 text-[11px] leading-5 ${activeAiReplyConfidence.tone === "rose" ? "border-rose-300/40 bg-rose-50 text-rose-900" : activeAiReplyConfidence.tone === "amber" ? "border-amber-300/40 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em]">{t("aiSupport.inbox.pwa.confidenceEngine")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyConfidence.tone === "rose" ? "bg-rose-200 text-rose-950" : activeAiReplyConfidence.tone === "amber" ? "bg-amber-200 text-amber-950" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyConfidence.levelLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyConfidence.tone === "rose" ? "bg-rose-200 text-rose-950" : activeAiReplyConfidence.tone === "amber" ? "bg-amber-200 text-amber-950" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyConfidence.decisionLabel}</span>
                    <span className="font-black">{activeAiReplyConfidence.score.toFixed(0)}%</span>
                    <span className="font-bold">{t("aiSupport.inbox.pwa.reasonsCount", { count: activeAiReplyConfidence.reasonsCount })}</span>
                  </div>
                  {activeAiReplyConfidence.reasonsPreview.length ? <div className="mt-1.5 space-y-1">{activeAiReplyConfidence.reasonsPreview.slice(0, 3).map((item) => <div key={item} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/80" /><span>{item}</span></div>)}</div> : null}
                  {activeAiReplyConfidence.decision === "high_risk" ? <div className="mt-1.5 font-black uppercase tracking-[0.12em]">{t("aiSupport.inbox.pwa.highRiskReview")}</div> : null}
                </div>
              ) : null}
              {aiSuggestionVisible ? (
                <AiSuggestionCard
                  text={activeAiSuggestionText}
                  editing={editingAiDraft}
                  editText={aiSuggestionEditText}
                  onEditTextChange={setAiSuggestionEditText}
                  onCancelEdit={handleCancelEditAiSuggestion}
                  onEdit={handleEditAiSuggestion}
                  onApprove={handleApproveAiSuggestion}
                  onDismiss={handleDismissAiSuggestion}
                  reviewNeeded={activeAiReplyValidation.violationsCount > 0 || activeAiReplyConfidence.decision === "high_risk"}
                  productCard={effectiveSuggestionCard}
                  productChoices={suggestionSendPackage?.card_choices || []}
                  productAmbiguous={Boolean(suggestionSendPackage?.product_ambiguous)}
                  colorChoices={suggestionSendPackage?.color_choices || []}
                  colorRequired={Boolean(suggestionSendPackage?.color_choice_required)}
                  productRemoved={suggestionProductRemoved}
                  recommendationMode={isRecommendationSuggestion}
                  variantOptionsMode={isVariantOptionsSuggestion}
                  recommendationSelectedKeys={suggestionRecommendationKeys}
                  onToggleRecommendation={handleToggleRecommendationCard}
                  onRemoveProduct={handleRemoveSuggestionProduct}
                  onChangeProduct={handleChangeSuggestionProduct}
                  onChooseProduct={handleChooseSuggestionProduct}
                  deliveryFormat={suggestionDeliveryFormat?.labelKey ? t(suggestionDeliveryFormat.labelKey) : ""}
                  channelName={selectedMetaLabel}
                  instagramDelivery={normalizeConversationChannel(selectedConversation || {}) === "instagram"}
                />
              ) : null}
              <QuickRepliesPicker
                replies={quickRepliesStore.quickReplies}
                customerName={conversationName(selectedConversation || {})}
                value={composerText}
                onUse={(message) => setComposerText(message)}
                light={!isDarkTheme}
              />
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductSheetOpen(true)}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-100"
                  aria-label={t("aiSupport.inbox.picker.sendProduct")}
                >
                  <PackagePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={openImagePicker}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                  aria-label={t("aiSupport.inbox.pwa.attachImage")}
                  title={t("aiSupport.inbox.pwa.attachImage")}
                >
                  <Image className="h-5 w-5" />
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageAttachmentChange}
                  className="hidden"
                  aria-hidden="true"
                />
                <PwaReplyEditor
                  editorRef={composerEditorRef}
                  value={composerText}
                  onChange={setComposerText}
                  onSubmit={sendManualReply}
                  disabled={sending}
                  placeholder={composerMode === "note" ? t("aiSupport.inbox.pwa.writeInternalNote") : t("aiSupport.inbox.pwa.typeReply")}
                />
                <button
                  ref={emojiButtonRef}
                  type="button"
                  onClick={() => setEmojiPickerOpen((current) => !current)}
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 transition ${emojiPickerOpen ? "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-300/20" : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-200 dark:ring-white/10"}`}
                  aria-label={t("aiSupport.inbox.pwa.emoji")}
                  aria-expanded={emojiPickerOpen}
                >
                  <Smile className="h-5 w-5" />
                </button>
                <AppleEmojiPicker
                  open={emojiPickerOpen}
                  anchorRef={emojiButtonRef}
                  onClose={() => setEmojiPickerOpen(false)}
                  onSelect={insertComposerEmoji}
                  title={t("aiSupport.inbox.emoji.choose")}
                />
                <button
                  type="button"
                  onClick={() => void sendManualReply()}
                  disabled={!clean(composerText) || /^\s*\//.test(composerText) || sending}
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white disabled:opacity-50 ${composerMode !== "note" && (activeAiReplyConfidence.decision === "high_risk" || activeAiReplyValidation.violationsCount > 0) ? "bg-amber-500" : "bg-sky-600"}`}
                  aria-label={composerMode === "note" ? t("aiSupport.inbox.pwa.saveNote") : t("aiSupport.inbox.pwa.sendReply")}
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!contentScreen ? (
        <nav className="ai-pwa-fixed ai-pwa-nav fixed inset-x-0 bottom-0 z-20 mx-auto w-full border-t border-slate-200 bg-white/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
          <div className="grid grid-cols-5 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (item.key === "config") {
                      setSettingsSheetOpen(true);
                      return;
                    }
                    if (item.key === "social_comments") setSocialMobileDetailOpen(false);
                    updateUrlState({ nextConversationId: item.key === "conversations" ? conversationParam : "", nextTab: item.key });
                  }}
                  className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[10px] font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </nav>
        ) : null}

        <ProductSheet
          open={productSheetOpen}
          products={products}
          loading={productLoading}
          query={productQuery}
          onQueryChange={setProductQuery}
          onClose={() => setProductSheetOpen(false)}
          onSend={sendProductCards}
          sending={productSending}
          selectedConversation={selectedConversation}
        />
        <InboxOrderComposer
          open={orderComposerOpen}
          conversation={selectedConversation || {}}
          busy={orderComposerBusy}
          headers={headers}
          onClose={() => setOrderComposerOpen(false)}
          onSubmit={submitComposerOrder}
          onSendMessage={sendManualReply}
          picks={composerPicks}
          onRequestPick={openOrderCartPicker}
        />
        <ProductCardPicker
          open={availableBySizePickerConfig.open}
          onClose={closeAvailableBySizePicker}
          onSubmit={availableBySizePickerConfig.sizeMode ? undefined : handleOrderCartPickerSubmit}
          onSubmitLink={availableBySizePickerConfig.sizeMode ? sendAvailableBySizeCards : undefined}
          sizeMode={availableBySizePickerConfig.sizeMode}
          allowMultiple={availableBySizePickerConfig.allowMultiple}
          orderMode={availableBySizePickerConfig.orderMode}
          restockMode={availableBySizePickerConfig.restockMode}
          mode="inlineFullscreen"
        />
        <SettingsSheet
          open={settingsSheetOpen}
          onClose={() => setSettingsSheetOpen(false)}
          items={[
            {
              key: "quick_replies",
              icon: MessageSquareText,
              label: t("aiSupport.quickReplies.config"),
              hint: t("aiSupport.inbox.pwa.quickRepliesHint"),
              onClick: () => { setSettingsSheetOpen(false); setQuickRepliesConfigOpen(true); },
            },
            {
              key: "comments_settings",
              icon: MessageCircleMore,
              label: t("aiSupport.inbox.pwa.commentsSettings"),
              hint: t("aiSupport.inbox.pwa.commentsSettingsHint"),
              onClick: () => { setSettingsSheetOpen(false); setCommentsSettingsOpen(true); },
            },
            {
              key: "invoice_messages",
              icon: FaWhatsapp,
              label: t("aiSupport.inbox.pwa.receiptMessages"),
              hint: t("aiSupport.inbox.pwa.receiptMessagesHint"),
              onClick: () => { setSettingsSheetOpen(false); setInvoiceMessagesOpen(true); },
            },
            {
              key: "integrations",
              icon: Settings,
              label: t("aiSupport.inbox.pwa.integrations"),
              hint: t("aiSupport.inbox.pwa.integrationsHint"),
              onClick: () => { setSettingsSheetOpen(false); setIntegrationsOpen(true); },
            },
          ]}
        />
        <CommentsSettingsModal
          open={commentsSettingsOpen}
          onClose={() => setCommentsSettingsOpen(false)}
          selectedPost={selectedSocialPost}
          postToolsEnabled={isSocialMode}
        />
        <WhatsappMessageVariantsModal
          open={invoiceMessagesOpen}
          onClose={() => setInvoiceMessagesOpen(false)}
          initialType="invoice_receipt"
        />
        {integrationsOpen ? (
          <Suspense fallback={null}>
            <IntegrationsCenter
              open
              initialTab="overview"
              headers={headers}
              onClose={() => setIntegrationsOpen(false)}
            />
          </Suspense>
        ) : null}
        <ConversationLabelsModal
          open={labelsOpen}
          labels={conversationLabels}
          saving={leadActionLoading === "labels"}
          onClose={() => setLabelsOpen(false)}
          onSave={updateConversationLabels}
        />
        <ReplyCorrectionModal
          open={correctionModal.open}
          draft={correctionModal.draft}
          saving={correctionSaving}
          onClose={closeReplyCorrection}
          onChange={patchReplyCorrection}
          onSave={saveReplyCorrection}
        />
        <Customer360Drawer
          open={customerDrawer.open}
          onClose={() => setCustomerDrawer((current) => ({ ...current, open: false }))}
          customer={customerDrawer.customer}
          customerId={customerDrawer.customerId}
          context={customerDrawer.context}
          aiAnalysis={customerDrawerAnalysis}
          title={t("aiSupport.inbox.ui.customer360")}
          restockPick={restockPick}
          onRequestRestockPick={openRestockPicker}
          onClearRestockPick={() => setRestockPick(null)}
        />
      </div>
    </div>
  );
}
