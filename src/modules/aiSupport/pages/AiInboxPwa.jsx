import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  Camera,
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
  ShieldBan,
  ShoppingBag,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { VirtualList } from "../../../shared/components/VirtualList";
import { subscribeRealtime, useRealtimeStatus } from "../../../shared/realtime/socketStore";
import { formatCurrency } from "../../../shared/lib/currency";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import { getPosSellableProducts } from "../../pos/services/posProductsApi";
import Customer360Drawer from "../components/Customer360Drawer.jsx";
import TranscriptMessage from "../components/TranscriptMessage";
import SocialCommentsPanel from "../components/SocialCommentsPanel";
import { SocialCommentsWorkspaceCommentRow } from "../components/SocialCommentsWorkspace.jsx";
import { CommentTimelineCard, getSocialCommentRealTimestamp } from "../components/socialCommentTimeline.jsx";
import ProductCardPicker from "../components/ProductCardPicker";
import { prefetchSocialWorkspace, readSocialWorkspaceCache, socialWorkspaceCacheKey, primeSocialWorkspaceCache } from "../services/socialWorkspaceProgressiveLoad.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const ENABLE_SOCIAL_FAST_CENTER = true;
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

const encodeConversationId = (value = "") => {
  const raw = clean(value);
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};

const CONVERSATION_CHANNEL_PREFIXES = new Map([
  ["facebook_messenger", "facebook_messenger"],
  ["facebook", "facebook_messenger"],
  ["messenger", "facebook_messenger"],
  ["instagram", "instagram"],
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
  if (detectedPrefix === "whatsapp" || /@(?:s\.whatsapp\.net|lid)$/i.test(raw) || /^\+?\d+$/.test(baseSessionId)) {
    const digits = clean(baseSessionId).replace(/^whatsapp:/i, "").replace(/@(?:s\.whatsapp\.net|lid)$/i, "").replace(/\D/g, "");
    if (digits) return `whatsapp:${digits.startsWith("20") && digits.length === 12 ? digits : digits.startsWith("0") && digits.length === 11 ? `20${digits.slice(1)}` : digits}`;
  }
  if (!detectedPrefix) return baseSessionId;
  return `${detectedPrefix}:${baseSessionId}`;
};

const buildClientRequestId = () => {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const buildMessageIdentityKey = ({ tenantId = "", sessionId = "", direction = "outbound", clientRequestId = "", providerMessageId = "", externalMessageId = "" } = {}) => {
  const canonicalSessionId = normalizeConversationSessionId(sessionId);
  const stableKey = clean(clientRequestId || providerMessageId || externalMessageId);
  return stableKey && canonicalSessionId ? `msg:${clean(tenantId)}|${canonicalSessionId}|${clean(direction || "outbound")}|${stableKey}` : "";
};

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

const aiInboxConversationEndpoint = (sessionId = "", suffix = "") =>
  `/ai-inbox/conversations/${encodeConversationId(sessionId)}${suffix}`;

const normalizeConversationChannel = (conversation = {}) => {
  const raw = clean(
    conversation.channel ||
      conversation.source ||
      conversation.provider ||
      conversation.platform ||
      ""
  ).toLowerCase();
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("instagram_comment")) return "instagram_comment";
  if (raw.includes("facebook_comment")) return "facebook_comment";
  if (raw.includes("instagram")) return "instagram";
  if (raw.includes("facebook") || raw.includes("messenger")) return "messenger";
  if (raw.includes("web")) return "web";
  return raw || "unknown";
};

const conversationKey = (conversation = {}) => conversationIdentifiers(conversation).conversationKey;

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

const messageDisplayText = (message = {}) =>
  clean(
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

const isFromMeMessage = (message = {}) =>
  message?.from_me === true ||
  message?.fromMe === true ||
  message?.is_from_me === true;

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
    text: clean(message.text || body),
    body: clean(message.body || body),
    content: clean(message.content || body),
    message_text: clean(message.message_text || body),
    from_me: resolvedFromMe,
    fromMe: resolvedFromMe,
    customer_message: clean(resolvedFromMe ? "" : message.customer_message || (direction === "inbound" ? body : "")),
    ai_answer: clean(message.ai_answer || ((!isStaffSender && resolvedFromMe) && normalizedMessageType !== "product_card" ? body : "")),
    staff_message: clean(message.staff_message || (normalizedSenderType === "staff" ? body : "")),
    product_cards: productCards,
    productCards,
  };
};

const isConversationAiEnabled = (conversation = {}) => conversation?.ai_enabled !== false;

const conversationWorkflowStatus = (conversation = {}) =>
  clean(conversation?.conversation_status || conversation?.status || "").toLowerCase();

const needsHumanAttention = (conversation = {}) =>
  conversation?.human_takeover === true ||
  conversation?.ai_paused === true ||
  conversation?.conversation_status === "human_takeover" ||
  conversation?.needs_human_support === true ||
  Boolean(clean(conversation?.escalation_reason || conversation?.ai_escalation_reason));

const aiAgentInboxEndpoint = (sessionId = "", suffix = "") =>
  `/ai-agent/inbox/${encodeConversationId(sessionId)}${suffix}`;
const aiReplyCorrectionEndpoint = (sessionId = "", messageId = "") =>
  aiAgentInboxEndpoint(sessionId, `/messages/${encodeConversationId(messageId)}/correction`);

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

const DEBUG_SOCIAL_COMMENTS =
  import.meta.env.DEV ||
  ["1", "true", "yes", "on"].includes(String(import.meta.env.VITE_AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || import.meta.env.VITE_AI_SUPPORT_DEBUG || "").toLowerCase());

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

const commentThreadCommenterName = (conversation = {}) =>
  firstNonEmpty(
    conversation?.commenter_name,
    conversation?.customer_name,
    conversation?.channel_metadata?.commenter_name,
    conversation?.metadata?.commenter_name,
    conversation?.sender_name,
    conversation?.customer_profile?.name,
    conversation?.customer?.name,
    conversation?.external_customer_id,
    "Commenter"
  );

const getConversationSourceLabel = (item = {}) => {
  const { channelMetadata, metadata } = getConversationThreadMetadata(item);
  const platform = clean(item?.platform || item?.source_platform || item?.channel || item?.source || channelMetadata.platform || metadata.platform || "").toLowerCase();
  if (isSocialCommentThread(item)) {
    if (platform.includes("instagram")) return "Instagram Comment";
    if (platform.includes("facebook")) return "Facebook Comment";
    return "Comment";
  }
  return channelMeta(item?.channel || item?.source || item?.provider || item?.platform || "").label;
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
    conversation?.channel_metadata?.post_full_picture,
    conversation?.channel_metadata?.full_picture,
    conversation?.metadata?.post_full_picture,
    conversation?.metadata?.full_picture,
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
  new: { label: "New", tone: "blue" },
  contacted: { label: "Contacted", tone: "amber" },
  interested: { label: "Interested", tone: "emerald" },
  won: { label: "Won", tone: "emerald" },
};

const LEAD_STATUS_ORDER = ["new", "contacted", "interested", "won"];

const normalizeLeadStatus = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "negotiation" || key === "follow_up" || key === "followup") return "interested";
  if (key === "lost" || key === "closed") return "new";
  return Object.prototype.hasOwnProperty.call(LEAD_STATUS_META, key) ? key : "new";
};

const leadStatusLabel = (value = "") => LEAD_STATUS_META[normalizeLeadStatus(value)]?.label || "New";
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

const relativeTime = (value) => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 1) return "Now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
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

function renderPwaCardTime(conversation) {
  const value = getPwaCardTimeValue(conversation);

  if (isSocialCommentThread(conversation) || getInboxItemKind(conversation) === "comment") {
    if (import.meta.env.DEV) {
      console.log("AI_POST_TIME_RENDER", {
        post_id: conversation?.post_id,
        comment_id: conversation?.comment_id,
        post_created_time: conversation?.post_created_time || conversation?.channel_metadata?.post_created_time || conversation?.metadata?.post_created_time || "",
        real_comment_created_time: conversation?.real_comment_created_time || "",
        comment_created_time: conversation?.comment_created_time || "",
        rendered_label: value ? relativeTime(value) : "Unknown",
      });
    }
    return value ? relativeTime(value) : "Unknown";
  }

  return relativeTime(value);
}

const relativeSeenLabel = (value) => {
  const label = relativeTime(value);
  return label ? `Last seen ${label}` : "No recent activity";
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

const isSocialPostSummary = (item = {}) =>
  Object.prototype.hasOwnProperty.call(item, "comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "new_comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "last_comment_text") ||
  Object.prototype.hasOwnProperty.call(item, "post_full_picture") ||
  Object.prototype.hasOwnProperty.call(item, "full_picture");

const socialPostMatchesFilter = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  if (!isSocialPostSummary(item)) return true;
  const platform = clean(item.platform).toLowerCase();
  if (filter === "facebook") return platform === "facebook" || platform === "facebook_comment";
  if (filter === "instagram") return platform === "instagram" || platform === "instagram_comment";
  if (filter === "needs_human" || filter === "needs_reply") return Number(item.new_comments_count || 0) > 0 || clean(item.reply_status || item.auto_reply_mode).toLowerCase() !== "sent";
  if (filter === "ai_replied" || filter === "replied") return clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent";
  if (filter === "unread") return Number(item.new_comments_count || 0) > 0;
  if (filter === "auto_reply_on") return Boolean(item.auto_reply_enabled || item.template_enabled || item.generic_enabled);
  return true;
};

const socialPostSortValue = (item = {}) => new Date(item.real_comment_created_time || item.last_activity_at || item.last_comment_at || item.updated_at || item.created_at || 0).getTime() || 0;

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
    customer_name: clean(item?.customer_name || "Customer"),
    customer_avatar_url: clean(item?.customer_avatar_url || ""),
    message_preview: messagePreview,
    comments_count: Number(item?.comments_count || 1) || 1,
    new_comments_count: Number(item?.new_comments_count ?? (unread ? 1 : 0)) || 0,
    last_comment_text: clean(item?.last_comment_text || messagePreview),
    last_comment_at: clean(item?.last_comment_at || activityAt),
    last_commenter_name: clean(item?.last_commenter_name || item?.customer_name || "Customer"),
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
    permalink_url: clean(item?.permalink_url || ""),
    platform: clean(item?.platform || "facebook").toLowerCase(),
  };
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

  return {
    ...currentConversation,
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
      last_message: nextConversation.channel_metadata?.last_message ?? currentConversation.channel_metadata?.last_message ?? nextPreview,
      unread_count: nextConversation.channel_metadata?.unread_count ?? currentConversation.channel_metadata?.unread_count ?? nextUnreadCount,
      pending_count: nextConversation.channel_metadata?.pending_count ?? currentConversation.channel_metadata?.pending_count ?? nextUnreadCount,
      unseen_count: nextConversation.channel_metadata?.unseen_count ?? currentConversation.channel_metadata?.unseen_count ?? nextUnreadCount,
    },
    messages: currentConversation.messages,
    older_messages_available: currentConversation.older_messages_available,
    next_messages_before: currentConversation.next_messages_before,
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
  if (key === "whatsapp") return { label: "WhatsApp", icon: MessageCircleMore, tone: "text-emerald-600" };
  if (key === "instagram" || key === "instagram_comment") return { label: "Instagram", icon: Camera, tone: "text-rose-500" };
  if (key === "messenger" || key === "facebook_comment") return { label: "Messenger", icon: MessageCircleMore, tone: "text-blue-600" };
  return { label: "Web", icon: Globe, tone: "text-slate-500" };
};

const isLikelyMessengerExternalId = (value = "") => {
  const candidate = clean(value).replace(/\s+/g, "");
  return Boolean(candidate) && /^\d{5,}$/.test(candidate);
};

const conversationName = (conversation = {}) =>
  (() => {
    const profile = conversation.customer_profile || {};
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
    ].filter(Boolean);
    if (!isMessengerConversation(conversation)) {
      candidates.push(conversation.external_customer_id, conversation.phone);
    }
    const resolved = candidates.find((candidate) => {
      const value = clean(candidate);
      if (!value) return false;
      if (isMessengerConversation(conversation) && isLikelyMessengerExternalId(value)) return false;
      return true;
    });
    return clean(resolved || (isMessengerConversation(conversation) ? "Customer" : conversation.external_customer_id || conversation.phone || "Customer"));
  })();

const productImage = (card = {}) =>
  clean(
    card.image_url ||
      card.product_image_url ||
      card.variant_image_url ||
      card.image ||
      card.thumbnail_url ||
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
  if (key === "confirmed") return { label: "تم التأكيد من العميل", tone: "emerald" };
  if (key === "edit_requested") return { label: "العميل طلب تعديل", tone: "amber" };
  if (key === "cancelled_by_customer") return { label: "ألغاه العميل", tone: "rose" };
  if (key === "pending_confirmation") return { label: "بانتظار التأكيد", tone: "cyan" };
  return { label: key || "Unknown", tone: "zinc" };
};

const buildProductCardPayload = (product = {}, variant = null, selectedColor = "") => ({
  product_id: product.product_id ?? product.id ?? null,
  variant_id: variant?.variant_id ?? variant?.id ?? null,
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
  color: clean(selectedColor || variant?.color || variant?.color_name || ""),
  size: clean(variant?.size || variant?.size_name || ""),
  product_url: buildProductCardUrl(product, variant, selectedColor),
  storefront_url: buildProductCardUrl(product, variant, selectedColor),
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

const productSizes = (product = {}, color = "") => {
  const normalizedColor = normalizeKey(color);
  return [
    ...new Set(
      getVariantRows(product)
        .filter((variant) => {
          if (!normalizedColor) return true;
          return normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color) === normalizedColor;
        })
        .flatMap((variant) => [
          clean(variant.size || variant.size_name || variant.variant_size || variant.selected_size),
          clean(variant.variant?.size || variant.variant?.size_name || ""),
          clean(product.size || product.size_name || product.variant_size || ""),
        ])
        .filter(Boolean)
    ),
  ];
};

const findVariant = (product = {}, color = "", size = "") => {
  const normalizedColor = normalizeKey(color);
  const normalizedSize = normalizeKey(size);
  const variants = getVariantRows(product);
  return (
    variants.find((variant) => {
      const variantColor = normalizeKey(variant.color || variant.color_name || variant.variant_color || variant.selected_color);
      const variantSize = normalizeKey(variant.size || variant.size_name || variant.variant_size || variant.selected_size);
      const colorMatch = !normalizedColor || variantColor === normalizedColor;
      const sizeMatch = !normalizedSize || variantSize === normalizedSize;
      return colorMatch && sizeMatch;
    }) || null
  );
};

const NAV_ITEMS = [
  { key: "conversations", label: "AI Inbox", icon: MessageCircleMore },
  { key: "social_comments", label: "Social Comments", icon: MessageSquareText },
  { key: "leads", label: "Leads", icon: Layers3 },
  { key: "more", label: "More", icon: MoreHorizontal },
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

function ConversationListItem({ conversation, active, onSelect }) {
  const isSocialComment = isSocialCommentThread(conversation);
  const inboxKind = getInboxItemKind(conversation);
  const sourceLabel = getConversationSourceLabel(conversation);
  const SourceIcon = getConversationSourceIcon(conversation);
  const unreadCount = conversationUnreadCount(conversation);
  const isCommentThread = isCommentConversation(conversation) || isSocialComment;
  const avatar = isCommentThread ? commentThreadPostImageUrl(conversation) : customerAvatarUrl(conversation);
  const title = isCommentThread ? commentThreadDisplayName(conversation) : conversationName(conversation);
  const commenterName = isCommentThread ? commentThreadCommenterName(conversation) : "";
  const preview = isCommentThread ? commentThreadLastComment(conversation) || "No comments yet" : conversationPreview(conversation) || "No messages yet";
  const commentCount = isCommentThread ? commentThreadCommentCount(conversation) : 0;
  const lastActivity = renderPwaCardTime(conversation);
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
  const unread = unreadCount > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation)}
      className={`flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left transition ${
        active
          ? "bg-slate-900 text-white"
          : unread
            ? "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            : "bg-transparent text-slate-900 hover:bg-white"
      }`}
    >
      {avatar ? (
        <div className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl ${unread && !active ? "ring-2 ring-emerald-200" : "ring-1 ring-slate-200"}`}>
          <img
            src={avatar}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {isCommentThread ? <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-transparent to-black/25" /> : null}
        </div>
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
                    {commentCount ? `${commentCount} تعليق` : "تعليق"}
                  </span>
                  {needsHumanAttention(conversation) ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                      Needs Human
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className={`line-clamp-2 text-[14px] leading-5 ${unread && !active ? "font-bold" : "font-semibold"}`}>{title}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                    <SourceIcon className={`h-3 w-3 ${active ? "text-white" : isSocialComment ? "text-blue-600" : channelMeta(conversation.channel || conversation.source).tone}`} />
                    {sourceLabel}
                  </span>
                  {needsHumanAttention(conversation) ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                      Needs Human
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
            {unreadCount > 0 ? (
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-slate-900" : "bg-emerald-500 text-white"}`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        {inboxKind === "comment" ? (
          <div className={`mt-1.5 rounded-2xl border p-2.5 text-[12.5px] leading-5 ${active ? "border-white/10 bg-white/5 text-slate-200" : unread ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{commentThreadDisplayName(conversation)}</div>
            <span className="line-clamp-2 font-medium">{preview}</span>
          </div>
        ) : (
          <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unread ? "text-slate-700" : "text-slate-500"}`}>
            <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unread && !active ? "text-emerald-600" : ""}`} />
            <span className={`line-clamp-2 text-left ${unread && !active ? "font-medium" : ""}`}>{preview}</span>
          </div>
        )}
      </div>
    </button>
  );
}

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

const OptimizedTranscript = memo(function OptimizedTranscript({
  conversation = null,
  rows = [],
  loadingOlder,
  onLoadOlder,
  olderMessagesAvailable = false,
  onReplyComment,
  onPrivateMessage,
}) {
  const isCommentThread = isCommentConversation(conversation || {});
  if (!rows.length && !isCommentThread) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No messages yet.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5 pb-3">
      {olderMessagesAvailable ? (
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
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-700">Post</div>
              <div className="mt-1 line-clamp-2 text-[16px] font-black leading-6 text-slate-900">{commentThreadDisplayName(conversation || {})}</div>
              {commentThreadPostTime(conversation || {}) ? (
                <div className="mt-1 text-[11px] font-medium text-slate-500">{commentThreadPostTime(conversation || {})}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {commentThreadPostUrl(conversation || {}) ? (
                  <a href={commentThreadPostUrl(conversation || {})} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-black text-emerald-700">
                    <ExternalLink className="h-3.5 w-3.5" />
                    فتح البوست
                  </a>
                ) : null}
                <button type="button" onClick={() => onPrivateMessage?.(conversation)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-[11px] font-black text-cyan-700">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
              </div>
              {commentThreadCommentCount(conversation || {}) ? (
                <div className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">
                  {commentThreadCommentCount(conversation || {})} تعليق
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {rows.map((row) => (
        <TranscriptMessage
          key={row.key}
          row={row}
          variant="pwa"
          onReplyComment={onReplyComment}
          onPrivateMessage={onPrivateMessage}
        />
      ))}
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
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [view, setView] = useState("list");

  useEffect(() => {
    if (!open) return;
    setSelectedProductId("");
    setSelectedColor("");
    setSelectedSize("");
    setView("list");
  }, [open, selectedConversation?.session_id]);

  const filteredProducts = useMemo(() => {
    const normalized = clean(query).toLowerCase();
    if (!normalized) return products;
    return products.filter((product) => {
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
  }, [products, query]);

  useEffect(() => {
    if (!open) return;
    setView("list");
    const firstId = String(filteredProducts[0]?.product_id || filteredProducts[0]?.id || "");
    if (!selectedProductId || !filteredProducts.some((product) => String(product.product_id || product.id || "") === selectedProductId)) {
      setSelectedProductId(firstId);
    }
  }, [filteredProducts, open, selectedProductId]);

  const selectedProduct = useMemo(
    () =>
      filteredProducts.find((product) => String(product.product_id || product.id || "") === String(selectedProductId)) ||
      filteredProducts[0] ||
      null,
    [filteredProducts, selectedProductId]
  );

  const colors = useMemo(() => productColors(selectedProduct || {}), [selectedProduct]);
  const sizes = useMemo(() => productSizes(selectedProduct || {}, selectedColor), [selectedColor, selectedProduct]);
  const needsColorSelection = colors.length > 0;
  const needsSizeSelection = sizes.length > 0;

  useEffect(() => {
    if (!selectedProduct) return;
    setSelectedColor("");
    setSelectedSize("");
  }, [selectedProductId, selectedProduct]);

  const variant = useMemo(() => {
    if (!selectedProduct) return null;
    if (needsColorSelection && needsSizeSelection) {
      if (!clean(selectedColor) || !clean(selectedSize)) return null;
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
    () => (selectedProduct ? buildProductCardPayload(selectedProduct, variant, selectedColor) : null),
    [selectedColor, selectedProduct, variant]
  );
  const canSend = Boolean(
    selectedConversation?.session_id &&
      selectedProduct &&
      (!needsColorSelection || clean(selectedColor)) &&
      (!needsSizeSelection || clean(selectedSize))
  );
  const previewImage = useMemo(
    () => productImage(selectedProduct || {}, variant || null) || productImage(selectedProduct || {}),
    [selectedProduct, variant]
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
          ? "fixed inset-0 z-[99999] isolate flex items-stretch justify-center overflow-hidden bg-white text-slate-900 [padding-top:max(0.75rem,env(safe-area-inset-top))] [padding-bottom:max(0.85rem,env(safe-area-inset-bottom))]"
          : "fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 px-2 pb-2 pt-14 sm:px-4 sm:pb-4 sm:pt-16"
      }
      onClick={onClose}
    >
      <div
        className={
          mobileFullscreenMode
            ? "flex h-[100dvh] w-screen min-w-0 max-w-[100vw] flex-col overflow-hidden bg-white"
            : "flex h-[82dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-16px_40px_rgba(15,23,42,0.18)] sm:h-[min(88dvh,52rem)]"
        }
        style={mobileFullscreenMode ? { width: "100vw", maxWidth: "100vw", height: "100dvh" } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {mobileFullscreenMode ? null : <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={mobileFullscreenMode ? "sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-3" : "sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur"}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-slate-900">Send Product</h3>
                <p className="text-xs text-slate-500">
                  {selectedConversation ? `Sending to ${conversationName(selectedConversation)}` : "Select a product card"}
                </p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
            <div className="space-y-3">
              {view === "list" ? (
                <>
                  <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search product"
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <div className="space-y-2 pb-4">
                {loading ? (
                  <div className="grid min-h-32 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : filteredProducts.length ? (
                  filteredProducts.slice(0, 80).map((product) => {
                    const active = String(product.product_id || product.id || "") === String(selectedProduct?.product_id || selectedProduct?.id || "");
                    const previewImage = productImage(product);
                    return (
                      <button
                        key={`${product.product_id || product.id}`}
                        type="button"
                        onClick={() => {
                          setSelectedProductId(String(product.product_id || product.id || ""));
                          setSelectedColor("");
                          setSelectedSize("");
                          setView("detail");
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
                        }`}
                      >
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || "Product"} className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
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
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No products match this search.
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
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Back to products
                    </button>
                    <a
                      href={selectedProduct?.storefront_url || selectedProduct?.product_url || selectedProduct?.url || productUrl(selectedProduct)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Open Product
                    </a>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                    {previewImage ? (
                      <img src={previewImage} alt={selectedProduct?.name || selectedProduct?.product_name || "Product"} className="h-[170px] w-full object-contain bg-slate-50 p-2" loading="lazy" />
                    ) : (
                      <div className="grid h-[170px] w-full place-items-center bg-slate-50">
                        <ShoppingBag className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                    <div className="space-y-1.5 p-3">
                      <div className="text-base font-semibold text-slate-900">{selectedProduct?.name || selectedProduct?.product_name || "Select a product"}</div>
                      {previewPrice > 0 ? <div className="text-sm font-medium text-emerald-700">{money(previewPrice)}</div> : null}
                      <div className="flex flex-wrap gap-2">
                        {selectedColor ? <PwaChip>{selectedColor}</PwaChip> : null}
                        {selectedSize ? <PwaChip>{selectedSize}</PwaChip> : null}
                        {variant?.available !== undefined ? (
                          <PwaChip tone={variant.available ? "emerald" : "rose"}>{variant.available ? `In stock ${previewStock}` : "Out of stock"}</PwaChip>
                        ) : previewStock > 0 ? (
                          <PwaChip tone="emerald">{`In stock ${previewStock}`}</PwaChip>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-700">Color</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {colors.length ? (
                        colors.map((color) => {
                          const active = normalizeKey(selectedColor) === normalizeKey(color);
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() => {
                                setSelectedColor(color);
                                setSelectedSize("");
                              }}
                              className={`rounded-full px-3 py-2 text-sm ${
                                active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {color}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">No color data available.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-700">Size</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sizes.length ? (
                        sizes.map((size) => {
                          const active = normalizeKey(selectedSize) === normalizeKey(size);
                          return (
                            <button
                              key={size}
                              type="button"
                              onClick={() => setSelectedSize(size)}
                              className={`rounded-full px-3 py-2 text-sm ${
                                active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {size}
                            </button>
                          );
                        })
                      ) : (
                        <div className="text-xs text-slate-500">No size data available.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={mobileFullscreenMode ? "sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white px-4 pt-3" : "sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"}>
            <button
              type="button"
              onClick={handleSendProduct}
              disabled={!canSend}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Product
            </button>
            {!selectedConversation ? (
              <div className="mt-2 text-xs text-slate-500">Open a conversation first to send a product card.</div>
            ) : (needsColorSelection && !clean(selectedColor)) || (needsSizeSelection && !clean(selectedSize)) ? (
              <div className="mt-2 text-xs text-slate-500">
                {needsColorSelection && needsSizeSelection
                  ? "Select color and size to enable Send Product."
                  : needsColorSelection
                    ? "Select a color to enable Send Product."
                    : "Select a size to enable Send Product."}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
  return mobileFullscreenMode ? createPortal(sheet, document.body) : sheet;
}

function LeadsView({ conversations, onOpenConversation, search, leadFilter, onLeadFilterChange }) {
  const filtered = useMemo(() => {
    const normalized = clean(search).toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !normalized || [
        conversationName(conversation),
        conversation.external_customer_id,
        conversation.phone,
        conversation.latest_message_preview,
        leadStatusLabel(conversationLeadStatus(conversation)),
      ]
        .map((item) => clean(item).toLowerCase())
        .some((item) => item.includes(normalized));
      if (!matchesSearch) return false;
      return conversationLeadBucket(conversation) === leadFilter;
    });
  }, [conversations, leadFilter, search]);

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
              {leadStatusLabel(status)}
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
                      <span>{getConversationSourceLabel(conversation)}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{renderPwaCardTime(conversation)}</span>
                    </div>
                  </div>
                  <PwaChip tone={leadStatusTone(status)}>{leadStatusLabel(status)}</PwaChip>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          No lead conversations in this filter.
        </div>
      )}
    </div>
  );
}

function MoreView({ installAvailable, onInstall }) {
  return (
    <div className="space-y-3 pb-28">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-slate-100 p-3">
            <SmartphoneIcon />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">Standalone PWA Shell</div>
            <div className="mt-1 text-sm text-slate-500">This route is isolated from the ERP chrome and optimized for mobile conversation work.</div>
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
          <div className="text-sm font-semibold text-slate-900">Install App</div>
          <div className="text-xs text-slate-500">Add AI Inbox to the home screen.</div>
        </div>
        <Download className="h-4 w-4 text-slate-500" />
      </button>
      <Link to="/admin/ai-inbox" className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm">
        <div>
          <div className="text-sm font-semibold text-slate-900">Open Admin Inbox</div>
          <div className="text-xs text-slate-500">Go back to the full ERP console when needed.</div>
        </div>
        <ChevronLeft className="h-4 w-4 rotate-180 text-slate-500" />
      </Link>
    </div>
  );
}

function SmartphoneIcon() {
  return <MessageCircleMore className="h-5 w-5 text-slate-700" />;
}

function HeaderOverflowMenu({ open, anchorRef, onClose, children }) {
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
        aria-label="Conversation actions"
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
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const tenantId = tenantIdFromAuth();
  const conversationParam = clean(params.conversationId);
  const pageVisible = usePageVisible();
  const realtimeStatus = useRealtimeStatus();
  const socketHealthy = realtimeStatus.connected && !realtimeStatus.connecting;
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [messagePlatformFilter, setMessagePlatformFilter] = useState("all");
  const [commentPlatformFilter, setCommentPlatformFilter] = useState("all");
  const [leadFilter, setLeadFilter] = useState("new");
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState("reply");
  const [isFullscreenConversation, setIsFullscreenConversation] = useState(false);
  const [editingAiDraft, setEditingAiDraft] = useState(false);
  const [dismissedAiSuggestionKey, setDismissedAiSuggestionKey] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiToggling, setAiToggling] = useState(false);
  const [leadActionLoading, setLeadActionLoading] = useState("");
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [productSending, setProductSending] = useState(false);
  const [availableBySizePickerConfig, setAvailableBySizePickerConfig] = useState({ open: false, sizeMode: false, allowMultiple: false });
  const [availableBySizeSending, setAvailableBySizeSending] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [conversationHeaderHeight, setConversationHeaderHeight] = useState(0);
  const [userIsNearBottom, setUserIsNearBottom] = useState(true);
  const [aiAssistantGlobalEnabled, setAiAssistantGlobalEnabled] = useState(true);
  const [aiAssistantGlobalSaving, setAiAssistantGlobalSaving] = useState(false);
  const [socialComments, setSocialComments] = useState({ items: [], loading: false, error: "", next_cursor: "" });
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
  const [socialCommentsFilter, setSocialCommentsFilter] = useState("all");
  const [socialCommentsDebug, setSocialCommentsDebug] = useState({ request_url: "", tenant_id: "", status: "", count: "", error: "" });
  const [socialActionLoading, setSocialActionLoading] = useState("");
  const [customerDrawer, setCustomerDrawer] = useState({ open: false, customer: null, customerId: "", context: {} });
  const mainScrollRef = useRef(null);
  const conversationHeaderRef = useRef(null);
  const menuButtonRef = useRef(null);
  const imageInputRef = useRef(null);
  const pollRef = useRef(null);
  const restoreScrollStateRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const isHydratingConversationRef = useRef(false);
  const isAppendingNewMessageRef = useRef(false);
  const previousConversationKeyRef = useRef("");
  const previousLatestMessageKeyRef = useRef("");
  const markReadSignatureRef = useRef("");
  const messengerProfileSyncAttemptedRef = useRef(new Set());
  const refreshInFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
  const socialWorkspaceLoadSeqRef = useRef(0);
  const socialWorkspaceLoadStartRef = useRef(0);
  const socialWorkspaceLoadKeyRef = useRef("");
  const refreshQueueRef = useRef(null);
  const requestRefreshRef = useRef(null);
  const markReadLocalUpdateRef = useRef(0);
  const refreshStateRef = useRef({
    pageVisible: false,
    socketHealthy: false,
  });

  const openCustomerDrawer = useCallback((customer = {}, context = {}) => {
    const customerProfile = customer?.customer_profile || customer?.profile || {};
    const customerId = clean(
      customer.customer_profile_id ||
        customer.customerProfileId ||
        customer.external_customer_id ||
        customerProfile.id ||
        customer.id ||
        customer.commenter_id ||
        customer.profile_id ||
        ""
    );
    setCustomerDrawer({
      open: true,
      customer: {
        ...customer,
        id: customerId,
        customer_name:
          clean(customer.customer_name || customer.commenter_name || customer.author_name || customer.from_name || customerProfile.name || customerProfile.display_name || "") ||
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

  const loadProducts = useCallback(async () => {
    if (productLoading || products.length) return;
    setProductLoading(true);
    try {
      const payload = await getPosSellableProducts();
      setProducts(asArray(payload));
    } catch (loadError) {
      toast.error(loadError?.message || "Failed to load products");
    } finally {
      setProductLoading(false);
    }
  }, [productLoading, products.length]);

  const loadSocialComments = useCallback(
    async ({ silent = false, seq = requestSeqRef.current, cursor = "", append = false } = {}) => {
      if (!silent) setSocialComments((current) => ({ ...current, loading: true, error: "" }));
      setSocialCommentsDebug((current) => ({ ...current, error: "" }));

      const fastRequestUrl = `/api/social-comments/fast-list?tenant_id=${encodeURIComponent(tenantId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const legacyRequestUrl = `/api/social-comments/posts?tenant_id=${encodeURIComponent(tenantId)}&limit=50`;
      const perfLabel = "AiInboxPwa.socialCommentsFastList";
      if (DEBUG_SOCIAL_PERF) console.time(perfLabel);
      const settingsPromise = api
        .get("/social-comments/auto-reply/settings", {
          params: { tenant_id: tenantId },
          headers,
          perfComponent: "AiInboxPwa.socialCommentsSettings",
        })
        .catch(() => ({ settings: null }));

      const readListPayload = async () => {
        if (ENABLE_SOCIAL_FAST_CENTER) {
          try {
            const payload = await api.get("/social-comments/fast-list", {
              params: { tenant_id: tenantId, limit: 20, cursor },
              headers,
              perfComponent: "AiInboxPwa.socialCommentsFastList",
            });
            return { payload, request_url: fastRequestUrl, fast: true };
          } catch (fastError) {
            console.warn("[AiInboxPwa][social-comments-fast-list-fallback]", {
              tenant_id: tenantId,
              message: fastError?.message || "",
            });
          }
        }

        const payload = await api.get("/social-comments/posts", {
          params: { tenant_id: tenantId, limit: 50 },
          headers,
          perfComponent: "AiInboxPwa.socialCommentsPosts",
        });
        return { payload, request_url: legacyRequestUrl, fast: false };
      };

      try {
        const { payload, request_url, fast } = await readListPayload();
        if (seq !== requestSeqRef.current) return;
        const settingsPayload = await settingsPromise;
        if (seq !== requestSeqRef.current) return;
        const rawItems = asArray(payload?.items || payload?.posts || payload?.data?.items || payload);
        const items = fast ? rawItems.map(normalizeFastSocialCommentItem) : rawItems;
        setSocialComments((current) => ({
          items: append ? [...asArray(current.items), ...items] : items,
          loading: false,
          error: "",
          next_cursor: clean(payload?.next_cursor || payload?.data?.next_cursor || ""),
        }));
        setSocialCommentsCursor(clean(payload?.next_cursor || payload?.data?.next_cursor || ""));
        setSocialReplySettings({
          generic_enabled: Boolean(settingsPayload?.settings?.generic_enabled),
          generic_like_enabled: settingsPayload?.settings?.generic_like_enabled !== false,
          generic_reply_enabled: settingsPayload?.settings?.generic_reply_enabled !== false,
          generic_template: clean(settingsPayload?.settings?.generic_template || ""),
          mode: clean(settingsPayload?.settings?.mode || "manual_approval") || "manual_approval",
        });
        setSocialCommentsDebug({
          request_url,
          tenant_id: tenantId,
          status: Number(payload?.__status || 200) || 200,
          count: items.length,
          error: "",
        });
      } catch (socialCommentsError) {
        if (seq !== requestSeqRef.current) return;
        const status = Number(socialCommentsError?.status || socialCommentsError?.responseBody?.status || 0) || "";
        const message = socialCommentsError?.responseBody?.message || socialCommentsError?.message || "تعذر تحميل منشورات التعليقات";
        setSocialComments((current) => ({
          items: silent && Array.isArray(current.items) ? current.items : [],
          loading: false,
          error: message,
          next_cursor: current?.next_cursor || "",
        }));
        setSocialCommentsDebug({
          request_url: ENABLE_SOCIAL_FAST_CENTER ? fastRequestUrl : legacyRequestUrl,
          tenant_id: tenantId,
          status,
          count: 0,
          error: message,
        });
      } finally {
        if (DEBUG_SOCIAL_PERF) console.timeEnd(perfLabel);
      }
    },
    [headers, tenantId]
  );

  const loadMoreSocialComments = useCallback(async () => {
    if (!socialCommentsCursor || socialCommentsLoadingMore) return;
    setSocialCommentsLoadingMore(true);
    try {
      const seq = requestSeqRef.current;
      await loadSocialComments({ silent: true, seq, cursor: socialCommentsCursor, append: true });
    } finally {
      setSocialCommentsLoadingMore(false);
    }
  }, [loadSocialComments, socialCommentsCursor, socialCommentsLoadingMore]);

  const loadConversations = useCallback(
    async ({ silent = false } = {}) => {
      refreshInFlightRef.current = true;
      isHydratingConversationRef.current = true;
      const seq = ++requestSeqRef.current;
      if (!silent) setLoading(true);
      setError("");
      try {
        const payload = await api.get("/ai-inbox/conversations", {
          params: {
            tenant_id: tenantId,
            search: debouncedSearch,
            limit: 100,
            message_limit: conversationParam ? 50 : 20,
          },
          headers,
          perfComponent: "AiInboxPwa.conversations",
        });
        const globalAiPayload = await api.get("/ai-agent/settings/ai-assistant-global", {
          params: { tenant_id: tenantId },
          headers,
          perfComponent: "AiInboxPwa.globalAi",
        }).catch(() => ({ ai_assistant_global_enabled: true }));

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
        setAiAssistantGlobalEnabled(globalAiPayload?.ai_assistant_global_enabled !== false);
        await loadSocialComments({ silent, seq });

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
        if (!silent) setLoading(false);
        refreshInFlightRef.current = false;
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
    },
    [conversationParam, debouncedSearch, headers, loadSocialComments, pageVisible, tab, tenantId, updateUrlState]
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
    navigator.serviceWorker.register("/inbox-sw.js?v=1", { scope: "/inbox" }).catch(() => null);
    return undefined;
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
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!pageVisible || socketHealthy) return undefined;
    pollRef.current = window.setInterval(() => {
      requestRefresh("polling", { silent: true });
    }, 24000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [pageVisible, requestRefresh, socketHealthy]);

  useEffect(() => {
    const previous = refreshStateRef.current;
    refreshStateRef.current = { pageVisible, socketHealthy };

    if (!pageVisible) return;

    if (!previous.pageVisible) {
      requestRefresh("visibility", { silent: true, force: true });
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
            const nextUnreadCount = isInbound ? (conversationMatchesRealtimeKeys(conversation, activeConversationKeys) ? 0 : Math.max(1, unreadCount + 1)) : unreadCount;
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

  const filteredConversations = useMemo(() => {
    const normalized = debouncedSearch.toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !normalized || [
        conversationName(conversation),
        conversation.external_customer_id,
        conversation.phone,
        conversation.latest_message_preview,
      ]
        .map((item) => clean(item).toLowerCase())
        .some((item) => item.includes(normalized));
      if (!matchesSearch) return false;
      const kind = getInboxItemKind(conversation);
      if (filter === "messages") return kind === "message" && matchesMessagePlatform(conversation, messagePlatformFilter);
      if (filter === "comments") return kind === "comment" && matchesCommentPlatform(conversation, commentPlatformFilter);
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
  }, [commentPlatformFilter, conversations, debouncedSearch, filter, messagePlatformFilter]);

  const selectedConversation = useMemo(() => {
    if (!conversationParam) return null;
    const normalizedConversationParam = normalizeConversationSessionId(conversationParam);
    const rawConversationParam = stripConversationPrefixes(normalizedConversationParam).value || clean(conversationParam);
    return (
      conversations.find(
        (conversation) => {
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
  const selectedConversationRouteId = useMemo(
    () => {
      const identifiers = conversationIdentifiers(selectedConversation || {});
      return clean(identifiers.sessionId || identifiers.conversationKey || identifiers.conversationId || "");
    },
    [selectedConversation]
  );
  const inboxFilterItems = useMemo(
    () => [
      { key: "all", label: "All" },
      { key: "messages", label: "Messages" },
      { key: "comments", label: "Comments" },
      { key: "needs_reply", label: "Needs Reply" },
    ],
    []
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
  const visibleSocialPosts = useMemo(() => {
    if (!isSocialMode) return [];
    return [...asArray(socialComments.items)]
      .filter((item) => socialPostMatchesFilter(item, socialCommentsFilter))
      .sort((a, b) => socialPostSortValue(b) - socialPostSortValue(a));
  }, [isSocialMode, socialComments.items, socialCommentsFilter]);
  const selectedSocialPost = useMemo(() => {
    if (!isSocialMode) return null;
    if (socialPostParam) {
      return visibleSocialPosts.find((item) => socialPostIdentity(item) === socialPostParam) || socialComments.items.find((item) => socialPostIdentity(item) === socialPostParam) || null;
    }
    return visibleSocialPosts[0] || socialComments.items[0] || null;
  }, [isSocialMode, socialComments.items, socialPostIdentity, socialPostParam, visibleSocialPosts]);
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
    if (["sent", "success", "successfully_sent", "done", "delivered", "replied", "auto_replied"].includes(status)) return "Auto replied";
    if (["private_reply_sent", "dm_sent", "private_reply"].includes(status)) return "Private reply sent";
    if (["failed", "error", "blocked"].includes(status)) return "Failed";
    if (["human_takeover", "human_review", "manual_review"].includes(status)) return "Human takeover";
    return "Waiting";
  }, [selectedSocialPost, selectedSocialThread?.post]);

  useEffect(() => {
    if (!isSocialMode) return;
    if (socialPostParam) return;
    const fallbackPost = visibleSocialPosts[0] || socialComments.items[0];
    const nextPostId = socialPostIdentity(fallbackPost || {});
    if (!nextPostId) return;
    updateUrlState({ nextTab: "social_comments", nextConversationId: "", nextPostId, replace: true });
  }, [isSocialMode, socialComments.items, socialPostIdentity, socialPostParam, updateUrlState, visibleSocialPosts]);

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
  const activeAiSuggestionKey = useMemo(() => {
    if (!selectedConversation?.session_id || !activeAiSuggestionText) return "";
    const stamp = selectedConversation?.last_ai_reply_draft_updated_at || activeAiReplyDraft?.updated_at || activeAiReplyDraft?.metadata?.updated_at || "";
    return `${selectedConversation.session_id}:${stamp || activeAiSuggestionText.length}`;
  }, [activeAiReplyDraft?.metadata?.updated_at, activeAiReplyDraft?.updated_at, activeAiSuggestionText, selectedConversation?.last_ai_reply_draft_updated_at, selectedConversation?.session_id]);
  const aiSuggestionVisible = Boolean(activeAiSuggestionText) && dismissedAiSuggestionKey !== activeAiSuggestionKey;
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

  useEffect(() => {
    setEditingAiDraft(false);
  }, [selectedConversation?.session_id]);
  const selectedTranscriptRows = useMemo(() => {
    const messages = uniqueMessages(selectedConversation?.messages || []).filter((message) => !isHiddenAiReplyDraftMessage(message));
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
        aiInboxConversationEndpoint(conversationIdentifiers(selectedConversation).conversationId || sessionId, "/read"),
        { tenant_id: tenantId, conversation_id: sessionId, channel: conversation.channel || conversation.source || "" },
        { headers, perfComponent: "AiInboxPwa.markRead" }
      ).catch((markError) => {
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
      if (!conversation?.session_id || !isMessengerConversation(conversation)) return false;
      const sessionId = normalizeConversationSessionId(conversation.session_id, conversation.channel || conversation.source || conversation.provider || conversation.platform || "");
      if (!sessionId) return false;
      const currentName = clean(conversation.customer_name || conversation.customer_profile?.name || conversationName(conversation));
      if (currentName && currentName.toLowerCase() !== "customer" && !isLikelyMessengerExternalId(currentName)) return false;
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
        if (!silent) toast.success("Messenger profile synced");
        return true;
      } catch (error) {
        console.warn("[AiInboxPwa][messenger-profile-sync-failed]", {
          conversation_id: sessionId,
          external_customer_id: externalCustomerId,
          message: error?.message || "",
        });
        if (!silent) toast.error("تعذر جلب اسم العميل من Messenger");
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
      updateUrlState({ nextConversationId: conversationIdentifiers(conversation).sessionId || conversationIdentifiers(conversation).conversationId, nextTab: "conversations" });
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
    if (!isMessengerConversation(selectedConversation)) return;
    const currentName = clean(selectedConversation.customer_name || selectedConversation.customer_profile?.name || conversationName(selectedConversation));
    if (currentName && currentName.toLowerCase() !== "customer" && !isLikelyMessengerExternalId(currentName)) return;
    void syncMessengerProfile(selectedConversation, { silent: true });
  }, [selectedConversation, syncMessengerProfile, tab]);

  useLayoutEffect(() => {
    if (!selectedConversation || tab !== "conversations") return undefined;
    const scroller = mainScrollRef.current;
    if (!scroller) return undefined;

    const restoreState = restoreScrollStateRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!scroller) return;
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

      if (conversationChanged || (latestMessageAppended && userIsNearBottom)) {
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

  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversation?.session_id || olderLoading || isLoadingOlderRef.current) return;
    const currentMessages = asArray(selectedConversation.messages);
    const shouldHydrateFullPage = currentMessages.length <= 1 && Number(selectedConversation.message_count || 0) > currentMessages.length;
    const before = shouldHydrateFullPage ? "" : selectedConversation.next_messages_before || currentMessages[0]?.created_at || "";
    const beforeId = shouldHydrateFullPage ? "" : currentMessages[0]?.id || "";
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
      patchConversation(selectedConversation.conversation_key || selectedConversation.session_id, (conversation) => {
        const mergedMessages = mergeMessagesByIdentity([...asArray(payload.messages), ...asArray(conversation.messages)]);
        return {
          ...conversation,
          messages: mergedMessages,
          older_messages_available: Boolean(payload.has_more),
          next_messages_before: payload.next_before || mergedMessages[0]?.created_at || "",
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
    if (selectedConversation.conversationHydrated !== false) return;
    void loadOlderMessages();
  }, [loadOlderMessages, selectedConversation?.conversationHydrated, selectedConversation?.session_id, tab]);

  const sendManualReply = useCallback(async (overrideText = "", options = {}) => {
    const message = clean(overrideText || composerText);
    if (!selectedConversation?.session_id || !message) return;
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
    const takeoverWarnings = selectedConversation?.conversation_status === "human_takeover" ? ["Conversation is in human takeover"] : [];
    const sendWarnings = [...new Set([...validationWarnings, ...confidenceWarnings, ...takeoverWarnings])].slice(0, 5);
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
      if (!confirmed) return;
    }
    const allowSameTextCorrection = options.allowSameTextCorrection === true || editingAiDraft;
    const correctionMetadata = options.correctionMetadata || {};
    const sendFlow = options.flow || (allowSameTextCorrection ? "edit" : "normal");
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
          messages: mergeMessagesByIdentity([...asArray(conversation.messages), returnedMessage]),
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
              toast.warn("تم الإرسال، لكن لم يتم حفظ التصحيح");
            }
            if (sendFlow === "approve") {
              toast.success("تم اعتماد رد الذكاء الاصطناعي وإرساله");
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
              toast.warn("تم الإرسال، لكن لم يتم حفظ التصحيح");
            }
            if (sendFlow === "approve") {
              toast.success("تم اعتماد رد الذكاء الاصطناعي وإرساله");
            } else if (allowSameTextCorrection) {
              toast[correctionSaved ? "success" : "warn"](
                correctionSaved ? "تم إرسال الرد المعدل وحفظ التصحيح للتعلم" : "تم الإرسال، لكن لم يتم حفظ التصحيح"
              );
            }
          }
        }
      }

      if (composerMode === "note") {
        toast.success("Internal note saved");
      } else if (payload?.delivery_status === "failed") {
        toast.error(payload?.delivery_error || payload?.message || "Failed to send");
      } else if (payload?.delivery_status === "stored_only") {
        toast.info("Saved only, not delivered");
      } else if (!editingAiDraft && !allowSameTextCorrection) {
        toast.success("Message sent");
      }
      setEditingAiDraft(false);
      setComposerText("");
      if (composerMode === "note") setComposerMode("reply");
    } catch (sendError) {
      toast.error(sendError?.responseBody?.delivery_error || sendError?.responseBody?.message || sendError?.message || "فشل الإرسال");
    } finally {
      setSending(false);
    }
  }, [composerMode, composerText, editingAiDraft, headers, patchConversation, selectedConversation, tenantId]);

  const handleEditAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionText) return;
    setComposerMode("reply");
    setEditingAiDraft(true);
    setDismissedAiSuggestionKey("");
    setComposerText(activeAiSuggestionText);
  }, [activeAiSuggestionText]);

  const handleApproveAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionText) return;
    setComposerMode("reply");
    setComposerText(activeAiSuggestionText);
    void sendManualReply(activeAiSuggestionText, {
      allowSameTextCorrection: true,
      correctionMetadata: {
        source: "ai_suggestion_approved",
        approved_ai_reply: true,
      },
    });
  }, [activeAiSuggestionText, sendManualReply]);

  const handleDismissAiSuggestion = useCallback(() => {
    if (!activeAiSuggestionKey) return;
    setEditingAiDraft(false);
    setDismissedAiSuggestionKey(activeAiSuggestionKey);
  }, [activeAiSuggestionKey]);

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
          toast.info("Saved only, not delivered");
        } else if (deliveryStatus === "failed") {
          toast.error(`Failed to send${payload?.delivery_error ? `: ${payload.delivery_error}` : ""}`);
        } else {
          toast.success("Product sent");
        }
      } catch (sendError) {
        toast.error(sendError?.message || "Failed to send product");
      } finally {
        setProductSending(false);
      }
    },
    [headers, patchConversation, selectedConversation, tenantId]
  );

  const openAvailableBySizePicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: true, sizeMode: true, allowMultiple: true });
  }, []);

  const closeAvailableBySizePicker = useCallback(() => {
    setAvailableBySizePickerConfig({ open: false, sizeMode: false, allowMultiple: false });
  }, []);

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

  const handleImageAttachmentChange = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    toast.error("إرسال الصور غير مدعوم حالياً");
  }, []);

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
      toast.success("تم إنشاء العميل");
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
      toast.success("تم إنشاء فرصة البيع");
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
      toast.success("تم إرسال الرسالة الخاصة");
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
      toast.error("تعذر تحديد التعليق المرتبط بهذه المحادثة");
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
      toast.success("تم رد الكومنت");
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
      toast.success("تم حفظ إعدادات الرد التلقائي العامة");
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
      toast.success("تم حفظ قالب الرد لهذا البوست");
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
      customer_name: clean(comment?.customer_name || selectedSocialPost?.customer_name || "Customer"),
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
        toast.success("تم تجاهل التعليق");
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
        toast.success("تم إرسال الرسالة الخاصة");
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
        toast.success("تم إرسال الرد على التعليق");
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
  const fullscreenConversation = Boolean(isFullscreenConversation && contentScreen);
  const showComposer = contentScreen;
  const selectedMetaLabel = getConversationSourceLabel(selectedConversation || {});
  const SelectedChannelIcon = getConversationSourceIcon(selectedConversation || {});
  const currentLeadStatus = conversationLeadStatus(selectedConversation || {});
  const selectedWorkflowStatus = conversationWorkflowStatus(selectedConversation || {});
  const selectedConversationAiEnabled = isConversationAiEnabled(selectedConversation || {});
  const selectedAvatar = isCommentConversation(selectedConversation || {}) ? commentThreadPostImageUrl(selectedConversation || {}) : customerAvatarUrl(selectedConversation || {});
  const selectedLastSeen = relativeSeenLabel(
    selectedConversation?.last_activity_at || selectedConversation?.updated_at
  );
  const lastOrder = asArray(selectedConversation?.customer_profile?.previous_orders)[0] || selectedConversation?.last_order || selectedConversation?.order || null;
  const confirmationMeta = confirmationStatusMeta(lastOrder?.status);
  const quickActionBusy = Boolean(leadActionLoading || aiToggling || productSending || availableBySizeSending || sending);
  const isRtlLayout =
    typeof document !== "undefined" &&
    ((document.documentElement.dir || document.body?.dir || "").toLowerCase() === "rtl");

  const renderSocialCommentsWorkspace = () => {
    const selectedPost = selectedSocialPost || null;
    const postImage = clean(selectedPost?.thumbnail_url || "");
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
    const commentCount = Number(selectedPost?.comments_count || 0);
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
        <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">AI Social Media Center PWA</div>
              <div className="mt-1 text-lg font-black text-slate-900">Social Comments</div>
            </div>
            <button
              type="button"
              onClick={() => void requestRefresh("manual", { silent: true })}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Facebook</div>
              <div className="mt-1 text-xl font-black text-slate-900">{socialComments.items.filter((item) => clean(item.platform).toLowerCase().includes("facebook")).length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Instagram</div>
              <div className="mt-1 text-xl font-black text-slate-900">{socialComments.items.filter((item) => clean(item.platform).toLowerCase().includes("instagram")).length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">New comments</div>
              <div className="mt-1 text-xl font-black text-slate-900">{newCommentCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Needs reply</div>
              <div className="mt-1 text-xl font-black text-slate-900">{socialComments.items.filter((item) => socialPostMatchesFilter(item, "needs_reply")).length}</div>
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Global Auto Reply System</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_enabled ? "bg-emerald-300 text-slate-950" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  {socialReplySettings.generic_enabled ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_like_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  Like {socialReplySettings.generic_like_enabled ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => setSocialReplySettings((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${socialReplySettings.generic_reply_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  Reply {socialReplySettings.generic_reply_enabled ? "ON" : "OFF"}
                </button>
                <select
                  value={socialReplySettings.mode}
                  onChange={(event) => setSocialReplySettings((current) => ({ ...current, mode: event.target.value }))}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                >
                  <option value="off">off</option>
                  <option value="draft">draft</option>
                  <option value="manual_approval">manual_approval</option>
                  <option value="full_auto">full_auto</option>
                </select>
                <button
                  type="button"
                  onClick={saveSocialReplySettings}
                  disabled={socialActionLoading === "global_settings"}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                >
                  {socialActionLoading === "global_settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Save
                </button>
              </div>
              <textarea
                value={socialReplySettings.generic_template}
                onChange={(event) => setSocialReplySettings((current) => ({ ...current, generic_template: event.target.value }))}
                rows={4}
                placeholder="Generic auto reply template"
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none"
              />
              <div className="mt-2 text-[11px] font-semibold text-slate-500">
                Mode: {socialReplySettings.mode} · Like: {socialReplySettings.generic_like_enabled ? "ON" : "OFF"} · Reply: {socialReplySettings.generic_reply_enabled ? "ON" : "OFF"}
              </div>
            </div>

            <div className="mt-2 min-h-0 overflow-hidden">
              <SocialCommentsPanel
                items={socialComments.items}
                loading={socialComments.loading}
                error={socialComments.error}
                filter={socialCommentsFilter}
                debugInfo={socialCommentsDebug}
                mode="posts"
                selectedItemId={socialPostIdentity(selectedPost || {})}
                onSelectItem={(item) => {
                  const nextUrl = buildSocialCommentsCenterUrl(item);
                  console.info("AI_INBOX_OPEN_SOCIAL_COMMENT", {
                    post_id: clean(item?.post_id || item?.conversation_id || item?.id || socialPostIdentity(item) || ""),
                    comment_id: clean(item?.comment_id || item?.external_comment_id || item?.provider_comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || ""),
                    platform: clean(item?.platform || item?.source_platform || item?.channel || item?.source || ""),
                    tenant: clean(tenantId),
                    page_id: clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || ""),
                    customer_name: clean(item?.customer_name || item?.commenter_name || item?.author_name || item?.from_name || item?.metadata?.customer_name || item?.metadata?.commenter_name || ""),
                    url: nextUrl,
                  });
                  navigate(nextUrl);
                }}
                onFilterChange={setSocialCommentsFilter}
                onRefresh={() => void requestRefresh("manual", { silent: true })}
                nextCursor={socialCommentsCursor}
                onLoadMore={loadMoreSocialComments}
                loadingMore={socialCommentsLoadingMore}
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

          <div className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            {selectedPost ? (
              <div className="flex min-h-0 h-full flex-col gap-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                      {postImage ? <img src={postImage} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Post Preview</div>
                      <h2 className="mt-1 line-clamp-3 text-lg font-black text-slate-900">{postCaption || "Post"}</h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{platformLabel}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">Comment</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{commentCount} comments</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{newCommentCount} new</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{selectedSocialThreadStatusLabel}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialPost?.platform || selectedSocialThread?.post?.platform || "Facebook")}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialThreadStatusLabel || "Waiting")}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialThread?.post?.dm_status || selectedPost?.dm_status || selectedPost?.private_reply_status || "Manual")}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">{clean(selectedSocialThread?.post?.product_name || selectedPost?.product_name || selectedSocialThread?.post?.product_id || selectedPost?.product_id || "Product")}</span>
                      </div>
                      <details className="mt-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                        <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Developer Info</summary>
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
                          Open post
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Linked Product</div>
                    <button type="button" className="inline-flex h-8 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-600" disabled>
                      <ShoppingBag className="h-4 w-4" />
                      Send Product
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
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Name</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_name || "—")}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Price</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_price || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Sale price</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_sale_price || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Sizes</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_sizes || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Colors</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_colors || "—") || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Stock</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{clean(selectedPost?.product_stock || selectedPost?.stock || "—") || "—"}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Post Auto Reply Template</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">Template mode: {templateMode}</div>
                    </div>
                    <button
                      type="button"
                      onClick={saveSelectedSocialTemplate}
                      disabled={socialActionLoading === "post_template"}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                    >
                      {socialActionLoading === "post_template" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Save
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
                          {templateEnabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), like_enabled: !(current.template?.like_enabled ?? true) } }))}
                          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${(selectedTemplate?.like_enabled ?? true) ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                        >
                          Like {selectedTemplate?.like_enabled === false ? "OFF" : "ON"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), reply_enabled: !(current.template?.reply_enabled ?? true) } }))}
                          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${(selectedTemplate?.reply_enabled ?? true) ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-slate-200 bg-white text-slate-700"}`}
                        >
                          Reply {selectedTemplate?.reply_enabled === false ? "OFF" : "ON"}
                        </button>
                        <select
                          value={templateMode}
                          onChange={(event) => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), mode: event.target.value } }))}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                        >
                          <option value="off">off</option>
                          <option value="draft">draft</option>
                          <option value="manual_approval">manual_approval</option>
                          <option value="full_auto">full_auto</option>
                        </select>
                      </div>
                      <textarea
                        value={templateText}
                        onChange={(event) => setSelectedSocialTemplate((current) => ({ ...current, template: { ...(current.template || {}), template: event.target.value } }))}
                        rows={4}
                        placeholder="Template for this post"
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none"
                      />
                      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Preview</div>
                        <div className="mt-2 whitespace-pre-wrap">{templateText || genericTemplateText || "No template text yet."}</div>
                      </div>
                    </>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Comments Timeline</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">{selectedSocialThread.comments.length} comments</div>
                    </div>
                    {selectedSocialThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
                  </div>
                  {selectedSocialThread.error ? (
                    <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{selectedSocialThread.error}</div>
                  ) : null}
                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
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
                        لا توجد تعليقات سوشيال حاليًا
                      </div>
                    ) : null}
                    {selectedSocialThread.comments.map((comment, index) => {
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
                          replyDraft={replyDraft}
                          previewReply={previewReply}
                          suggestedReply={suggestedReply}
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
                لا توجد تعليقات سوشيال حاليًا
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto flex h-full w-full max-w-[430px] flex-col bg-slate-50">
        {contentScreen && tab === "conversations" ? (
          <header
            ref={conversationHeaderRef}
            className="fixed inset-x-0 top-0 z-[60] mx-auto w-full max-w-[430px] border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur"
          >
            <div className="flex items-center justify-between gap-2" style={{ flexDirection: isRtlLayout ? "row-reverse" : "row" }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleBackNavigation}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {selectedAvatar ? (
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
                    aria-label="Open customer details"
                  >
                    <img
                      src={selectedAvatar}
                      alt={isCommentConversation(selectedConversation || {}) ? commentThreadDisplayName(selectedConversation || {}) : conversationName(selectedConversation)}
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                      loading="lazy"
                    />
                  </button>
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
                    aria-label="Open customer details"
                  >
                    <UserRound className="h-4.5 w-4.5" />
                  </button>
                )}
                <div className="min-w-0">
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
                    {isCommentConversation(selectedConversation || {}) ? commentThreadDisplayName(selectedConversation || {}) : conversationName(selectedConversation)}
                  </button>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                      <SelectedChannelIcon className={`h-3 w-3 ${isSocialCommentThread(selectedConversation || {}) ? "text-blue-600" : "text-cyan-600"}`} />
                      {selectedMetaLabel}
                    </span>
                    {selectedWorkflowStatus === "human_takeover" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                        <AlertCircle className="h-3 w-3" />
                        Needs Human
                      </span>
                    ) : null}
                    <span className="truncate">{selectedLastSeen}</span>
                  </div>
                  {lastOrder ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <PwaChip tone={confirmationMeta.tone}>{confirmationMeta.label}</PwaChip>
                      <span className="text-[10px] font-semibold text-slate-500">
                        {lastOrder.invoice_number || lastOrder.order_number || lastOrder.id}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsFullscreenConversation((current) => !current)}
                  className="mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                  aria-label={fullscreenConversation ? "Restore conversation layout" : "Expand conversation layout"}
                  title={fullscreenConversation ? "Restore conversation layout" : "Expand conversation layout"}
                >
                  {fullscreenConversation ? <Minimize2 className="h-4.5 w-4.5" /> : <Maximize2 className="h-4.5 w-4.5" />}
                </button>
                <button
                  type="button"
                  onClick={toggleConversationAi}
                  disabled={aiToggling}
                  className={`mr-2 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[11px] font-black shadow-sm ring-1 disabled:opacity-50 ${
                    selectedConversationAiEnabled
                      ? "bg-emerald-300 text-slate-950 ring-emerald-200"
                      : "bg-rose-50 text-rose-700 ring-rose-200"
                  }`}
                >
                  {aiToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  {selectedWorkflowStatus === "human_takeover" ? "Return to AI" : selectedConversationAiEnabled ? "AI ON" : "AI OFF"}
                </button>
                <button
                  type="button"
                  ref={menuButtonRef}
                  onClick={() => setMenuOpen((current) => !current)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <MoreHorizontal className="h-4.5 w-4.5" />
                </button>
                <HeaderOverflowMenu
                  open={menuOpen}
                  anchorRef={menuButtonRef}
                  onClose={() => setMenuOpen(false)}
                >
                  <button type="button" onClick={() => { toggleGlobalAiAssistant(); setMenuOpen(false); }} disabled={aiAssistantGlobalSaving} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">
                    {aiAssistantGlobalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    {aiAssistantGlobalEnabled ? "AI Assistant Global ON" : "AI Assistant Global OFF"}
                  </button>
                  <button type="button" onClick={toggleConversationAi} disabled={aiToggling} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50">
                    {aiToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    {selectedWorkflowStatus === "human_takeover" ? "Return to AI" : isConversationAiEnabled(selectedConversation) ? "AI ON" : "AI OFF"}
                  </button>
                  <button type="button" onClick={() => { setProductSheetOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                    <PackagePlus className="h-4 w-4" />
                    Send Product
                  </button>
                  <button type="button" onClick={() => { setComposerMode("note"); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                    <Sparkles className="h-4 w-4" />
                    Internal Note
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast("No existing block API is wired in this build.");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <ShieldBan className="h-4 w-4" />
                    Block Customer
                  </button>
                </HeaderOverflowMenu>
              </div>
            </div>
            {!fullscreenConversation ? (
              <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Global AI Assistant</div>
                  <div className="truncate text-[12px] font-semibold text-slate-700">
                    {aiAssistantGlobalEnabled ? "تشغيل مساعد الذكاء الاصطناعي لكل المحادثات" : "مساعد الذكاء الاصطناعي متوقف على كل المحادثات"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleGlobalAiAssistant}
                  disabled={aiAssistantGlobalSaving}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-black disabled:opacity-50 ${
                    aiAssistantGlobalEnabled ? "bg-emerald-300 text-slate-950" : "border border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {aiAssistantGlobalSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                  {aiAssistantGlobalEnabled ? "ON" : "OFF"}
                </button>
              </div>
              {!aiAssistantGlobalEnabled ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-100 px-3 py-2 text-[12px] font-semibold text-amber-800">
                  مساعد الذكاء الاصطناعي متوقف على كل المحادثات.
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Lead status</div>
                  <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    <span className={`h-2 w-2 rounded-full ${
                      leadStatusTone(currentLeadStatus) === "amber"
                        ? "bg-amber-400"
                        : leadStatusTone(currentLeadStatus) === "emerald"
                          ? "bg-emerald-400"
                          : "bg-blue-400"
                    }`} />
                    <span className="text-[11px] font-semibold text-slate-700">{leadStatusLabel(currentLeadStatus)}</span>
                  </div>
                </div>
                <label className="min-w-[9rem]">
                  <span className="sr-only">Change lead status</span>
                  <select
                    value={currentLeadStatus}
                    onChange={(event) => void updateLeadStatus(event.target.value)}
                    disabled={leadActionLoading === "lead_status"}
                    className="h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 outline-none disabled:opacity-50"
                  >
                    {LEAD_STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {leadStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setProductSheetOpen(true)}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                  إرسال منتج
                </button>
                <button
                  type="button"
                  onClick={() => void sendLeadPrivateMessage()}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
                <button
                  type="button"
                  onClick={() => openAvailableBySizePicker()}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] font-semibold text-cyan-700 disabled:opacity-50"
                >
                  <Ruler className="h-3.5 w-3.5" />
                  المتاح بالمقاس
                </button>
                <button
                  type="button"
                  onClick={() => void sendLeadCommentReply()}
                  disabled={quickActionBusy || !isCommentConversation(selectedConversation || {})}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                >
                  <MessageCircleMore className="h-3.5 w-3.5" />
                  رد على التعليق
                </button>
                <button
                  type="button"
                  onClick={() => void createLeadCustomer()}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                >
                  <UserRound className="h-3.5 w-3.5" />
                  إنشاء عميل
                </button>
                <button
                  type="button"
                  onClick={() => void createLeadOpportunity()}
                  disabled={quickActionBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                  إنشاء فرصة بيع
                </button>
              </div>
              </div>
            ) : null}
          </header>
        ) : (
          <header className="border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur">
            <div className="space-y-2.5">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">AI Social Media Center</h1>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  className="h-10 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 text-[16px] leading-normal outline-none transition focus:border-slate-400"
                />
              </label>
              {tab === "conversations" ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {inboxFilterItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFilter(item.key);
                        if (item.key !== "messages") setMessagePlatformFilter("all");
                        if (item.key !== "comments") setCommentPlatformFilter("all");
                      }}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {filter === "messages" ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {MESSAGE_PLATFORM_FILTERS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setMessagePlatformFilter(item.key)}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-black ${messagePlatformFilter === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
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
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-black ${commentPlatformFilter === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                    >
                      {item.label}
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
          className={`flex-1 min-h-0 overflow-y-auto px-2 ${contentScreen && tab === "conversations" ? "" : "pt-1.5"} ${showComposer ? "pb-[calc(5.9rem+env(safe-area-inset-bottom))]" : "pb-[calc(4.1rem+env(safe-area-inset-bottom))]"}`}
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
              <OptimizedTranscript
                conversation={selectedConversation}
                rows={selectedTranscriptRows}
                loadingOlder={olderLoading}
                onLoadOlder={loadOlderMessages}
                olderMessagesAvailable={Boolean(selectedConversation?.older_messages_available)}
                onReplyComment={sendLeadCommentReply}
                onPrivateMessage={sendLeadPrivateMessage}
              />
            ) : loading ? (
              <div className="grid min-h-60 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            ) : filteredConversations.length ? (
              <VirtualList
                items={filteredConversations}
                estimateSize={72}
                className="h-[calc(100vh-7.85rem-env(safe-area-inset-bottom))]"
                itemKey={(conversation) => conversation.conversation_key}
                renderItem={(conversation) => (
                  <div className="border-b border-slate-100 py-0.5">
                    <ConversationListItem
                      conversation={conversation}
                      active={false}
                      onSelect={openConversation}
                    />
                  </div>
                )}
              />
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No conversations match the current filters.
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
          <div className={`fixed inset-x-0 z-20 mx-auto w-full max-w-[430px] px-2 ${contentScreen ? "bottom-[max(0.4rem,env(safe-area-inset-bottom))]" : "bottom-[calc(4rem+env(safe-area-inset-bottom))]"}`}>
            <div className="rounded-[24px] border border-slate-200 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
              {composerMode === "note" ? (
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Internal note mode
                </div>
              ) : null}
              {Boolean(activeAiReplyValidation.violationsCount || activeAiReplyValidation.warningsCount || activeAiReplyValidation.details.length) ? (
                <div className={`mb-2 rounded-2xl border px-3 py-2 text-[11px] leading-5 ${activeAiReplyValidation.violationsCount > 0 ? "border-amber-300/40 bg-amber-50 text-amber-900" : activeAiReplyValidation.warningsCount > 0 ? "border-slate-200 bg-slate-50 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em]">AI draft validation</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyValidation.violationsCount > 0 ? "bg-amber-200 text-amber-950" : activeAiReplyValidation.warningsCount > 0 ? "bg-slate-200 text-slate-800" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyValidation.status}</span>
                    <span className="font-black">{activeAiReplyValidation.confidencePercent.toFixed(0)}%</span>
                    <span className="font-bold">violations {activeAiReplyValidation.violationsCount}</span>
                    <span className="font-bold">warnings {activeAiReplyValidation.warningsCount}</span>
                  </div>
                  {activeAiReplyValidation.details.length ? <div className="mt-1.5 space-y-1">{activeAiReplyValidation.details.slice(0, 3).map((item) => <div key={item} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/80" /><span>{item}</span></div>)}</div> : null}
                </div>
              ) : null}
              <div className="mb-2 flex items-center gap-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${autoReplyShadowTone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : autoReplyShadowTone === "amber" ? "border-amber-300/40 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{autoReplyShadowLabel}</span>
                {activeAiReplyShadow?.reason ? <span className="text-[10px] font-bold text-slate-500">{activeAiReplyShadow.reason}</span> : null}
              </div>
              {Boolean(activeAiReplyConfidence.reasonsCount || activeAiReplyConfidence.riskFlagsCount || activeAiReplyConfidence.score) ? (
                <div className={`mb-2 rounded-2xl border px-3 py-2 text-[11px] leading-5 ${activeAiReplyConfidence.tone === "rose" ? "border-rose-300/40 bg-rose-50 text-rose-900" : activeAiReplyConfidence.tone === "amber" ? "border-amber-300/40 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em]">Confidence engine</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyConfidence.tone === "rose" ? "bg-rose-200 text-rose-950" : activeAiReplyConfidence.tone === "amber" ? "bg-amber-200 text-amber-950" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyConfidence.levelLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${activeAiReplyConfidence.tone === "rose" ? "bg-rose-200 text-rose-950" : activeAiReplyConfidence.tone === "amber" ? "bg-amber-200 text-amber-950" : "bg-emerald-200 text-emerald-950"}`}>{activeAiReplyConfidence.decisionLabel}</span>
                    <span className="font-black">{activeAiReplyConfidence.score.toFixed(0)}%</span>
                    <span className="font-bold">reasons {activeAiReplyConfidence.reasonsCount}</span>
                  </div>
                  {activeAiReplyConfidence.reasonsPreview.length ? <div className="mt-1.5 space-y-1">{activeAiReplyConfidence.reasonsPreview.slice(0, 3).map((item) => <div key={item} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-current/80" /><span>{item}</span></div>)}</div> : null}
                  {activeAiReplyConfidence.decision === "high_risk" ? <div className="mt-1.5 font-black uppercase tracking-[0.12em]">High risk: manual review recommended before sending.</div> : null}
                </div>
              ) : null}
              {aiSuggestionVisible ? (
                <div className={`mb-2 rounded-2xl border p-3 ${editingAiDraft ? "border-violet-300/30 bg-violet-400/10" : "border-cyan-300/15 bg-cyan-300/8"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">اقتراح الذكاء الاصطناعي</div>
                      <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/10 bg-slate-950/75 p-3 text-sm leading-7 text-slate-100">
                        {activeAiSuggestionText}
                      </div>
                    </div>
                    {editingAiDraft ? <span className="shrink-0 rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-100">Editing</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={handleEditAiSuggestion} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100 transition hover:bg-violet-400/15">✏️ تعديل الرد</button>
                    <button type="button" onClick={handleApproveAiSuggestion} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-[11px] font-black text-emerald-100 transition hover:bg-emerald-400/15">✅ اعتماد وإرسال</button>
                    <button type="button" onClick={handleDismissAiSuggestion} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-200 transition hover:bg-white/[0.08]">❌ تجاهل</button>
                  </div>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setProductSheetOpen(true)}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-100"
                  aria-label="Send product"
                >
                  <PackagePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={openImagePicker}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                  aria-label="Attach image"
                  title="Attach image"
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
                <textarea
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  rows={1}
                  placeholder={composerMode === "note" ? "Write an internal note" : "Type a reply"}
                  dir="auto"
                  className="max-h-28 min-h-12 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] leading-normal outline-none transition focus:border-slate-400 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={sendManualReply}
                  disabled={!clean(composerText) || sending}
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white disabled:opacity-50 ${composerMode !== "note" && (activeAiReplyConfidence.decision === "high_risk" || activeAiReplyValidation.violationsCount > 0) ? "bg-amber-500" : "bg-sky-600"}`}
                  aria-label={composerMode === "note" ? "Save note" : "Send reply"}
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!contentScreen ? (
        <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-slate-200 bg-white/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
          <div className="grid grid-cols-3 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => updateUrlState({ nextConversationId: item.key === "conversations" ? conversationParam : "", nextTab: item.key })}
                  className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[10px] font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
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
        <ProductCardPicker
          open={availableBySizePickerConfig.open}
          onClose={closeAvailableBySizePicker}
          onSubmitLink={sendAvailableBySizeCards}
          sizeMode={availableBySizePickerConfig.sizeMode}
          allowMultiple={availableBySizePickerConfig.allowMultiple}
          mode="inlineFullscreen"
        />
        <Customer360Drawer
          open={customerDrawer.open}
          onClose={() => setCustomerDrawer((current) => ({ ...current, open: false }))}
          customer={customerDrawer.customer}
          customerId={customerDrawer.customerId}
          context={customerDrawer.context}
          title="Customer 360"
        />
      </div>
    </div>
  );
}
