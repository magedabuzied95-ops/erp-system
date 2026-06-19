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
  Globe,
  Image,
  Layers3,
  Loader2,
  MessageCircleMore,
  MoreHorizontal,
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
import { getPosSellableProducts } from "../../pos/services/posProductsApi";
import TranscriptMessage from "../components/TranscriptMessage";
import ProductCardPicker from "../components/ProductCardPicker";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
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
    conversation.session_id || conversation.external_conversation_id || conversation.conversation_id || conversation.id,
    channel
  );
  const fallbackId = clean(conversation.session_id || conversation.external_conversation_id || conversation.conversation_id || conversation.id);
  const conversationId = normalizeConversationSessionId(conversation.conversation_id || conversation.id || sessionId, channel);
  const conversationKey = normalizeConversationSessionId(conversation.conversation_key || sessionId || fallbackId, channel);
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
    from_me: fromMe,
    fromMe,
    customer_message: clean(message.customer_message || (!fromMe && direction === "inbound" ? body : "")),
    ai_answer: clean(message.ai_answer || ((fromMe || direction === "outbound") && normalizedMessageType !== "product_card" ? body : "")),
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

const buildLeadPrivateMessageText = (conversation = {}) => {
  const name = clean(conversationName(conversation));
  return `مرحباً${name ? ` ${name}` : ""}، أرسلت لك التفاصيل في الخاص.`;
};

const buildLeadCommentReplyText = (conversation = {}) => {
  const name = clean(conversationName(conversation));
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

const conversationName = (conversation = {}) =>
  clean(
    conversation.customer_name ||
      conversation.customer?.name ||
      conversation.customer_profile?.name ||
      conversation.customer_profile?.full_name ||
      [conversation.first_name, conversation.last_name].filter(Boolean).join(" ") ||
      conversation.external_customer_id ||
      conversation.phone ||
      "Customer"
  );

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
  { key: "conversations", label: "Conversations", icon: MessageCircleMore },
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
  const meta = channelMeta(conversation.channel || conversation.source);
  const Icon = meta.icon;
  const unreadCount = conversationUnreadCount(conversation);
  const avatar = customerAvatarUrl(conversation);
  const preview = conversationPreview(conversation) || "No messages yet";
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
        <img
          src={avatar}
          alt={conversationName(conversation)}
          className={`h-11 w-11 shrink-0 rounded-full object-cover ${unread && !active ? "ring-2 ring-emerald-200" : "ring-1 ring-slate-200"}`}
          loading="lazy"
        />
      ) : (
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-white/12 text-white" : unread ? "bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : "bg-slate-200 text-slate-600"}`}>
          <UserRound className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`truncate text-[14px] leading-5 ${unread && !active ? "font-bold" : "font-semibold"}`}>{conversationName(conversation)}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600"}`}>
                <Icon className={`h-3 w-3 ${active ? "text-white" : meta.tone}`} />
                {meta.label}
              </span>
              {needsHumanAttention(conversation) ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-amber-300/20 text-amber-100" : "bg-amber-50 text-amber-700"}`}>
                  Needs Human
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className={`text-[11px] font-medium ${active ? "text-slate-300" : "text-slate-500"}`}>
              {relativeTime(conversation.last_activity_at || conversation.updated_at)}
            </div>
            {unreadCount > 0 ? (
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-slate-900" : "bg-emerald-500 text-white"}`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        <div className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-4.5 ${active ? "text-slate-300" : unread ? "text-slate-700" : "text-slate-500"}`}>
          <CheckCheck className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unread && !active ? "text-emerald-600" : ""}`} />
          <span className={`line-clamp-2 text-left ${unread && !active ? "font-medium" : ""}`}>{preview}</span>
        </div>
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
        const isAi = Boolean(clean(message.ai_answer)) || message.sender_type === "assistant" || message.sender_type === "ai" || message.direction === "outbound" || isFromMe;
        const isStaff = Boolean(clean(message.staff_message)) && !hasProductCards;
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
  rows = [],
  loadingOlder,
  onLoadOlder,
  olderMessagesAvailable = false,
}) {
  if (!rows.length) {
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
      {rows.map((row) => (
        <TranscriptMessage key={row.key} row={row} variant="pwa" />
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 px-2 pb-2 pt-14 sm:px-4 sm:pb-4 sm:pt-16" onClick={onClose}>
      <div
        className="flex h-[82dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-16px_40px_rgba(15,23,42,0.18)] sm:h-[min(88dvh,52rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur">
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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

          <div className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
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
            const meta = channelMeta(conversation.channel || conversation.source);
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
                      <span>{meta.label}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{relativeTime(conversation.last_activity_at || conversation.updated_at)}</span>
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
  const [leadFilter, setLeadFilter] = useState("new");
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState("reply");
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
  const mainScrollRef = useRef(null);
  const conversationHeaderRef = useRef(null);
  const imageInputRef = useRef(null);
  const pollRef = useRef(null);
  const restoreScrollStateRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const isHydratingConversationRef = useRef(false);
  const isAppendingNewMessageRef = useRef(false);
  const previousConversationKeyRef = useRef("");
  const previousLatestMessageKeyRef = useRef("");
  const markReadSignatureRef = useRef("");
  const refreshInFlightRef = useRef(false);
  const previousSocketHealthyRef = useRef(socketHealthy);
  const refreshTimerRef = useRef(null);
  const refreshQueuedRef = useRef(false);
  const refreshMetricsRef = useRef({
    socket_refresh_count: 0,
    polling_refresh_count: 0,
    skipped_duplicate_refresh_count: 0,
    mark_read_local_update: 0,
  });
  const scheduleRefreshRef = useRef(null);

  const tab = useMemo(() => {
    const value = new URLSearchParams(location.search).get("tab");
    return NAV_ITEMS.some((item) => item.key === value) ? value : "conversations";
  }, [location.search]);

  const updateUrlState = useCallback(
    ({ nextConversationId = conversationParam, nextTab = tab, replace = false } = {}) => {
      const searchParams = new URLSearchParams(location.search);
      if (nextTab && nextTab !== "conversations") searchParams.set("tab", nextTab);
      else searchParams.delete("tab");
      const searchText = searchParams.toString();
      const nextPath = nextConversationId ? `/inbox/${encodeConversationId(nextConversationId)}` : "/inbox";
      navigate(`${nextPath}${searchText ? `?${searchText}` : ""}`, { replace });
    },
    [conversationParam, location.search, navigate, tab]
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

  const loadConversations = useCallback(
    async ({ silent = false } = {}) => {
      if (refreshInFlightRef.current) {
        refreshQueuedRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
      isHydratingConversationRef.current = true;
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
          if (!exists && nextConversations[0]?.session_id && tab === "conversations") {
            updateUrlState({ nextConversationId: nextConversations[0].session_id, replace: true });
          }
        }
      } catch (loadError) {
        setError(loadError?.message || "Failed to load AI Inbox");
      } finally {
        if (!silent) setLoading(false);
        refreshInFlightRef.current = false;
        window.requestAnimationFrame(() => {
          isHydratingConversationRef.current = false;
        });
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          scheduleRefreshRef.current?.("queued", { silent: true, delay: 650 });
        }
      }
    },
    [conversationParam, debouncedSearch, headers, tab, tenantId, updateUrlState]
  );

  const scheduleRefresh = useCallback(
    (source = "unknown", { silent = true, delay = 750 } = {}) => {
      const counters = refreshMetricsRef.current;
      if (source === "socket") counters.socket_refresh_count += 1;
      if (source === "polling") counters.polling_refresh_count += 1;
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
        counters.skipped_duplicate_refresh_count += 1;
      }
      console.debug("[AiInboxPwa][refresh-metrics]", {
        source,
        silent,
        delay,
        page_visible: pageVisible,
        socket_healthy: socketHealthy,
        ...counters,
      });
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (refreshInFlightRef.current) {
          counters.skipped_duplicate_refresh_count += 1;
          refreshQueuedRef.current = true;
          console.debug("[AiInboxPwa][refresh-metrics]", {
            source,
            silent,
            delay,
            status: "deferred",
            reason: "refresh_in_flight",
            page_visible: pageVisible,
            socket_healthy: socketHealthy,
            ...counters,
          });
          return;
        }
        void loadConversations({ silent });
      }, delay);
    },
    [loadConversations, pageVisible, socketHealthy]
  );

  useEffect(() => {
    scheduleRefreshRef.current = scheduleRefresh;
    return () => {
      scheduleRefreshRef.current = null;
    };
  }, [scheduleRefresh]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "AI Inbox";
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
    if (pageVisible && socketHealthy) return undefined;
    pollRef.current = window.setInterval(() => {
      scheduleRefresh("polling", { silent: true, delay: 750 });
    }, 15000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [pageVisible, scheduleRefresh, socketHealthy]);

  useEffect(() => {
    const wasSocketHealthy = previousSocketHealthyRef.current;
    previousSocketHealthyRef.current = socketHealthy;
    if (!pageVisible || !socketHealthy || wasSocketHealthy) return;
    scheduleRefresh("socket", { silent: true, delay: 650 });
  }, [pageVisible, scheduleRefresh, socketHealthy]);

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
        scheduleRefresh("socket", { silent: true, delay: 650 });
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
  }, [conversationParam, pageVisible, scheduleRefresh, tenantId]);

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
      if (filter === "unread") return conversationUnreadCount(conversation) > 0;
      if (filter === "needs_reply") return needsHumanAttention(conversation) || conversationUnreadCount(conversation) > 0;
      return true;
    });
  }, [conversations, debouncedSearch, filter]);

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

  const activeAiReplyDraft = useMemo(
    () => selectedConversation?.ai_reply_draft || selectedConversation?.last_ai_reply_draft || null,
    [selectedConversation?.ai_reply_draft, selectedConversation?.last_ai_reply_draft]
  );
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
  const selectedTranscriptRows = useMemo(() => {
    const messages = uniqueMessages(selectedConversation?.messages || []).filter((message) => !isHiddenAiReplyDraftMessage(message));
    return messages
      .map((message) => {
        const normalizedMessage = normalizeInboxMessage(message);
        const cards = normalizeMessageProductCards(normalizedMessage);
        const hasProductCards = cards.length > 0;
        const isFromMe = isFromMeMessage(normalizedMessage);
        const isCustomer = Boolean(clean(normalizedMessage.customer_message)) && !isFromMe;
        const isAi = Boolean(clean(normalizedMessage.ai_answer)) || normalizedMessage.sender_type === "assistant" || normalizedMessage.sender_type === "ai" || normalizedMessage.direction === "outbound" || isFromMe;
        const isStaff = Boolean(clean(normalizedMessage.staff_message)) && !hasProductCards;
        if (!isCustomer && !isAi && !isStaff && !hasProductCards) return null;
        return {
          key: messageKey(normalizedMessage),
          message: normalizedMessage,
          cards,
          kind: hasProductCards || normalizedMessage.message_type === "product_card" ? "product_card" : isCustomer ? "customer" : isAi ? "ai" : "staff",
          visible: true,
          createdAt: absoluteTime(normalizedMessage.created_at),
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
      refreshMetricsRef.current.mark_read_local_update += 1;
      console.debug("[AiInboxPwa][mark-read-local-update]", {
        mark_read_local_update: refreshMetricsRef.current.mark_read_local_update,
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
        aiInboxConversationEndpoint(sessionId, "/read"),
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

  const openConversation = useCallback(
    (conversation) => {
      setComposerMode("reply");
      setMenuOpen(false);
      updateUrlState({ nextConversationId: conversationIdentifiers(conversation).sessionId, nextTab: "conversations" });
    },
    [updateUrlState]
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
    const before = selectedConversation.next_messages_before || selectedConversation.messages?.[0]?.created_at || "";
    const beforeId = selectedConversation.messages?.[0]?.id || "";
    if (!before) return;
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
      const payload = await api.get(aiInboxConversationEndpoint(normalizeConversationSessionId(selectedConversation.session_id, selectedConversation.channel || selectedConversation.source || selectedConversation.provider || selectedConversation.platform || ""), "/messages"), {
        params: { tenant_id: tenantId, before, before_id: beforeId, limit: 30 },
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
  }, [headers, olderLoading, patchConversation, selectedConversation, tenantId]);

  useEffect(() => {
    if (!selectedConversation?.session_id || tab !== "conversations") return;
    if (isHydratingConversationRef.current || isLoadingOlderRef.current || isAppendingNewMessageRef.current) return;
    if (selectedConversation.conversationHydrated !== false) return;
    void loadOlderMessages();
  }, [loadOlderMessages, selectedConversation?.conversationHydrated, selectedConversation?.session_id, tab]);

  const sendManualReply = useCallback(async () => {
    const message = clean(composerText);
    if (!selectedConversation?.session_id || !message) return;
    const clientRequestId = buildClientRequestId();
    const canonicalSessionId = normalizeConversationSessionId(selectedConversation.session_id, selectedConversation.channel || selectedConversation.source || selectedConversation.provider || selectedConversation.platform || "");
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
    if (composerMode !== "note" && (confidenceState.decision === "high_risk" || validationState.violationsCount > 0)) {
      const confirmed = window.confirm("الرد عليه تحذيرات، هل تريد الإرسال؟");
      if (!confirmed) return;
    }
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
              },
              { headers, perfComponent: "AiInboxPwa.aiReplyCorrection" }
            ).catch((error) => {
              console.warn("[ai-inbox-pwa][ai-reply-correction] skipped", {
                session_id: selectedConversation.session_id,
                message_id: returnedMessage.id || payload?.message?.id || "",
                error: error?.message || String(error),
              });
            });
          }
        }
      }

      if (composerMode === "note") {
        toast.success("Internal note saved");
      } else if (payload?.delivery_status === "failed") {
        toast.error(payload?.delivery_error || payload?.message || "Failed to send");
      } else if (payload?.delivery_status === "stored_only") {
        toast.info("Saved only, not delivered");
      } else {
        toast.success("Message sent");
      }
      setComposerText("");
      if (composerMode === "note") setComposerMode("reply");
    } catch (sendError) {
      toast.error(sendError?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }, [composerMode, composerText, headers, patchConversation, selectedConversation, tenantId]);

  const sendProductCards = useCallback(
    async (cards = []) => {
      if (!selectedConversation?.session_id || !cards.length) return;
      const clientRequestId = buildClientRequestId();
      const canonicalSessionId = normalizeConversationSessionId(selectedConversation.session_id, selectedConversation.channel || selectedConversation.source || selectedConversation.provider || selectedConversation.platform || "");
      const messageIdentityKey = buildMessageIdentityKey({
        tenantId,
        sessionId: canonicalSessionId,
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
        console.debug("[AiInboxPwa][product-card-send]", {
          conversation_id: selectedConversation.session_id || "",
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
          aiInboxConversationEndpoint(canonicalSessionId, "/product-card/send"),
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
    async (cards = []) => {
      setAvailableBySizeSending(true);
      try {
        await sendProductCards(cards);
      } finally {
        setAvailableBySizeSending(false);
        closeAvailableBySizePicker();
      }
    },
    [closeAvailableBySizePicker, sendProductCards]
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
            aiInboxConversationEndpoint(sessionId, "/return-to-ai"),
            { tenant_id: tenantId, channel: selectedConversation.channel || selectedConversation.source || "" },
            { headers, perfComponent: "AiInboxPwa.returnToAi" }
          )
        : await api.patch(
            aiInboxConversationEndpoint(sessionId, "/ai-enabled"),
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
      await loadConversations({ silent: true });
      setMenuOpen(false);
    } catch (toggleError) {
      toast.error(toggleError?.message || "Failed to update AI state");
    } finally {
      setAiToggling(false);
    }
  }, [headers, loadConversations, patchConversation, selectedConversation, tenantId]);

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
        await loadConversations({ silent: true });
      } catch (err) {
        toast.error(err?.message || "تعذر تحديث حالة العميل المحتمل");
      } finally {
        setLeadActionLoading("");
      }
    },
    [headers, loadConversations, patchConversation, selectedConversation, tenantId]
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
      await loadConversations({ silent: true });
      toast.success("تم إنشاء العميل");
    } catch (err) {
      toast.error(err?.message || "تعذر إنشاء العميل");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, loadConversations, patchConversation, selectedConversation, tenantId]);

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
      await loadConversations({ silent: true });
      toast.success("تم إنشاء فرصة البيع");
    } catch (err) {
      toast.error(err?.message || "تعذر إنشاء فرصة البيع");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, loadConversations, patchConversation, selectedConversation, tenantId]);

  const sendLeadPrivateMessage = useCallback(async () => {
    if (!selectedConversation?.session_id) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    const message = buildLeadPrivateMessageText(selectedConversation);
    setLeadActionLoading("private_message");
    try {
      const payload = await api.post(
        aiAgentInboxEndpoint(sessionId, "/private-message"),
        {
          tenant_id: tenantId,
          message,
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
      await loadConversations({ silent: true });
      toast.success("تم إرسال الرسالة الخاصة");
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال الرسالة الخاصة");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, loadConversations, patchConversation, selectedConversation, tenantId]);

  const sendLeadCommentReply = useCallback(async () => {
    if (!selectedConversation?.session_id || !isCommentConversation(selectedConversation)) return;
    const identifiers = conversationIdentifiers(selectedConversation);
    const sessionId = identifiers.sessionId;
    const conversationIdentifier = identifiers.conversationKey || sessionId;
    const commentId = clean(
      selectedConversation?.channel_metadata?.comment_id ||
        selectedConversation?.channel_metadata?.lead?.comment_id ||
        selectedConversation?.external_comment_id ||
        selectedConversation?.comment_id ||
        ""
    );
    if (!commentId) {
      toast.error("تعذر تحديد الكومنت المرتبط بهذه المحادثة");
      return;
    }
    const message = buildLeadCommentReplyText(selectedConversation);
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
      await loadConversations({ silent: true });
      toast.success("تم رد الكومنت");
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال رد الكومنت");
    } finally {
      setLeadActionLoading("");
    }
  }, [headers, loadConversations, patchConversation, selectedConversation, tenantId]);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }, [installPrompt]);

  const contentScreen = Boolean(selectedConversation);
  const showComposer = contentScreen && tab === "conversations";
  const selectedMeta = channelMeta(selectedConversation?.channel || selectedConversation?.source || "");
  const SelectedChannelIcon = selectedMeta.icon;
  const currentLeadStatus = conversationLeadStatus(selectedConversation || {});
  const selectedWorkflowStatus = conversationWorkflowStatus(selectedConversation || {});
  const selectedAvatar = customerAvatarUrl(selectedConversation || {});
  const selectedLastSeen = relativeSeenLabel(
    selectedConversation?.last_activity_at || selectedConversation?.updated_at
  );
  const quickActionBusy = Boolean(leadActionLoading || aiToggling || productSending || availableBySizeSending || sending);
  const isRtlLayout =
    typeof document !== "undefined" &&
    ((document.documentElement.dir || document.body?.dir || "").toLowerCase() === "rtl");

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
                  <img
                    src={selectedAvatar}
                    alt={conversationName(selectedConversation)}
                    className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                    loading="lazy"
                  />
                ) : (
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                    <UserRound className="h-4.5 w-4.5" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold leading-5 text-slate-900">{conversationName(selectedConversation)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                      <SelectedChannelIcon className={`h-3 w-3 ${selectedMeta.tone}`} />
                      {selectedMeta.label}
                    </span>
                    {selectedWorkflowStatus === "human_takeover" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                        <AlertCircle className="h-3 w-3" />
                        Needs Human
                      </span>
                    ) : null}
                    <span className="truncate">{selectedLastSeen}</span>
                  </div>
                </div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((current) => !current)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <MoreHorizontal className="h-4.5 w-4.5" />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-12 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <button type="button" onClick={toggleConversationAi} disabled={aiToggling} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 disabled:opacity-50">
                      {aiToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      {selectedWorkflowStatus === "human_takeover" ? "Return to AI" : isConversationAiEnabled(selectedConversation) ? "Pause AI" : "Enable AI"}
                    </button>
                    <button type="button" onClick={() => { setProductSheetOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                      <PackagePlus className="h-4 w-4" />
                      Send Product
                    </button>
                    <button type="button" onClick={() => { setComposerMode("note"); setMenuOpen(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                      <Sparkles className="h-4 w-4" />
                      Internal Note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        toast("No existing block API is wired in this build.");
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-rose-600 hover:bg-rose-50"
                    >
                      <ShieldBan className="h-4 w-4" />
                      Block Customer
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 space-y-2">
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
                  رد على الكومنت
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
          </header>
        ) : (
          <header className="border-b border-slate-200 bg-slate-50/95 px-2.5 pb-2 pt-[max(0.65rem,env(safe-area-inset-top))] backdrop-blur">
            <div className="space-y-2.5">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">AI Inbox</h1>
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
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFilter("all")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>All</button>
                  <button type="button" onClick={() => setFilter("unread")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "unread" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Unread</button>
                  <button type="button" onClick={() => setFilter("needs_reply")} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${filter === "needs_reply" ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>Needs Reply</button>
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

          {tab === "conversations" ? (
            contentScreen ? (
              <OptimizedTranscript
                rows={selectedTranscriptRows}
                loadingOlder={olderLoading}
                onLoadOlder={loadOlderMessages}
                olderMessagesAvailable={Boolean(selectedConversation?.older_messages_available)}
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
          onSubmit={sendAvailableBySizeCards}
          sizeMode={availableBySizePickerConfig.sizeMode}
          allowMultiple={availableBySizePickerConfig.allowMultiple}
          mode="inlineFullscreen"
        />
      </div>
    </div>
  );
}
