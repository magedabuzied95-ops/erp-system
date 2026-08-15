import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Users,
  PauseCircle,
  Send,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser, isMetaReviewerUser } from "../../../shared/auth/authStorage";
import AIStatusBadge from "../../../components/ai/AIStatusBadge";
import TikTokConnectionCard from "../components/TikTokConnectionCard";
import { useTenant } from "../../saas/context/TenantContext";

const CHANNELS = [
  { key: "web_chat", apiKey: "web_chat", icon: MessageCircle, tone: "cyan" },
  { key: "whatsapp", apiKey: "whatsapp", icon: Bot, tone: "emerald" },
  { key: "instagram", apiKey: "instagram", icon: Share2, tone: "pink" },
  { key: "facebook", apiKey: "facebook_messenger", icon: Share2, tone: "blue" },
];

const INTERNAL_CHANNELS = new Set(["admin_console", "debug", "test", "internal"]);
const META_CHANNEL_KEYS = new Set(["facebook", "instagram"]);

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value, fallback = "") => String(value ?? fallback).trim();
const todayKey = () => new Date().toISOString().slice(0, 10);
const isToday = (value) => (value ? new Date(value).toISOString().slice(0, 10) === todayKey() : false);

const seconds = (value) => {
  const sec = Math.round(number(value));
  if (!sec) return "0s";
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
};

const percent = (value) => `${Math.round(number(value) * 100)}%`;

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const devWarn = (label, error) => {
  if (import.meta.env.DEV) {
    console.warn("[ai-channels]", label, { message: error?.message || String(error || "") });
  }
};

const safeDate = (value, fallback = "—") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(date);
};

const latestMessageFrom = (conversation = {}) => {
  const messages = asArray(conversation.messages);
  const latest = messages[messages.length - 1] || {};
  return text(latest.customer_message || latest.message_text || conversation.customer_message || conversation.last_message);
};

const sourceFromConversation = (conversation = {}) =>
  text(conversation.channel || conversation.source_channel || conversation.source || conversation.metadata?.channel || "web_chat").toLowerCase();

const isInternalSource = (source = "") => {
  const normalized = text(source).toLowerCase();
  return INTERNAL_CHANNELS.has(normalized) || normalized.includes("debug") || normalized.includes("internal") || normalized.includes("test");
};

const readableKey = (value = "", fallback = "general") => {
  const normalized = text(value || fallback, fallback).toLowerCase();
  if (normalized.includes("image_search")) return "imageSearch";
  if (normalized.includes("product") || normalized.includes("catalog") || normalized.includes("discovery")) return "productDiscovery";
  return normalized.replace(/^\[|\]$/g, "").replace(/[_-]+/g, " ").trim() || fallback;
};

const messageLabelKey = (value = "") => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return "";
  if (normalized === "[image_search]" || normalized.includes("image_search")) return "imageSearch";
  if (normalized.includes("product_search") || normalized.includes("product_discovery") || normalized.includes("catalog")) return "productDiscovery";
  if (/^\[[a-z0-9_-]+\]$/i.test(normalized)) return "general";
  return "";
};

const normalizeConversations = (payload = {}) =>
  asArray(payload.conversations || payload.items || payload.data).map((conversation) => {
    const source = sourceFromConversation(conversation);
    const rawMessage = latestMessageFrom(conversation);
    const rawIntent = text(conversation.detected_intent || conversation.intent || conversation.messages?.at?.(-1)?.detected_intent);
    return {
      ...conversation,
      source_channel: source,
      internal: isInternalSource(source),
      customer_name: text(conversation.customer_name || conversation.customer_profile?.name || conversation.first_name),
      last_message: rawMessage,
      message_label_key: messageLabelKey(rawMessage),
      detected_intent: rawIntent,
      intent_label_key: readableKey(rawIntent),
      ai_status:
        conversation.conversation_status === "human_takeover" || conversation.needs_human_support === true
          ? "needs_human"
          : text(conversation.ai_answer || conversation.messages?.at?.(-1)?.ai_answer)
            ? "replied"
            : "pending",
      time: conversation.last_activity_at || conversation.updated_at || conversation.created_at,
    };
  });

const normalizeAnalytics = (payload = {}) => {
  const analytics = payload.analytics && typeof payload.analytics === "object" ? payload.analytics : {};
  return {
    totalConversations: number(analytics.total_conversations),
    humanTakeovers: number(analytics.human_takeover_count),
    closedConversations: number(analytics.closed_conversations),
    waitingCustomers: number(analytics.waiting_customers),
    averageResponseSeconds: number(analytics.average_response_seconds),
    aiReplies: number(analytics.ai_replies_count),
    topIntents: asArray(analytics.top_intents || analytics.top_objections).map((item) => ({
      label: text(item.intent || item.objection || item.name || item.detected_intent, "Unknown"),
      count: number(item.count),
    })),
  };
};

const channelHasRequiredConfig = (channelKey, status = {}) => {
  if (channelKey === "web_chat") return false;
  if (channelKey === "whatsapp") return status.env_enabled === true && status.access_token_configured === true && status.phone_number_id_configured === true;
  if (channelKey === "instagram") {
    return status.env_enabled === true && status.page_access_token_configured === true && status.page_id_configured === true && status.instagram_business_account_id_configured === true;
  }
  return status.env_enabled === true && status.page_access_token_configured === true && status.page_id_configured === true;
};

const metaConnected = (metaChannel = {}, keys = []) => keys.some((key) => metaChannel?.[key] === true);

const metaSetupHealthy = (metaStatus = {}) => {
  const setup = metaStatus?.setup_completion || {};
  const config = metaStatus?.config || {};
  return Boolean(
    setup.webhook_verified &&
      setup.webhook_enabled &&
      setup.subscribed_apps_verified &&
      config.page_access_token_configured
  );
};

const metaTokenValid = (config = {}) => {
  const status = text(config.token_health_status || config.token_status || config.status).toLowerCase();
  const expires = config.token_expires_at ? new Date(config.token_expires_at).getTime() : null;
  return Boolean(config.page_access_token_configured && !["token_expired", "expired", "invalid", "revoked", "error"].includes(status) && (!expires || expires > Date.now()));
};

const tokenStatusKey = (value = "") => {
  const normalized = text(value || "missing").toLowerCase();
  if (["active", "connected", "valid"].includes(normalized)) return "connected";
  if (["expired", "invalid", "error", "failed"].includes(normalized)) return "danger";
  if (["expiring_soon", "saved", "legacy"].includes(normalized)) return "setup";
  return "disconnected";
};

function StatusPill({ status, children }) {
  const classes = {
    connected: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    local: "border-primary/25 bg-primary/10 text-primary",
    setup: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    disconnected: "border-white/10 bg-white/5 text-slate-300",
    danger: "border-rose-300/25 bg-rose-400/10 text-rose-100",
    replied: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    pending: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    needs_human: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  }[status] || "border-white/10 bg-white/5 text-slate-300";

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${classes}`}>{children}</span>;
}

function KpiCard({ icon: Icon, label, value, tone = "cyan" }) {
  const toneClass = {
    cyan: "text-primary bg-primary/10 border-primary/20",
    emerald: "text-emerald-200 bg-emerald-400/10 border-emerald-300/20",
    amber: "text-amber-200 bg-amber-400/10 border-amber-300/20",
    rose: "text-rose-200 bg-rose-400/10 border-rose-300/20",
    violet: "text-violet-200 bg-violet-400/10 border-violet-300/20",
  }[tone] || "text-slate-200 bg-white/5 border-white/10";

  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4 shadow-xl shadow-black/10">
      <div className={`inline-flex rounded-xl border p-2 ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</div>
    </div>
  );
}

function EmptyPanel({ icon: Icon = Inbox, title, text: body }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-6 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-3 text-sm font-black text-white">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

function BarList({ rows, empty }) {
  const items = asArray(rows).filter((item) => item.label && item.count > 0);
  const max = Math.max(1, ...items.map((item) => item.count));
  if (!items.length) return <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">{empty}</div>;
  return (
    <div className="space-y-3">
      {items.slice(0, 5).map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-bold text-slate-200">{item.label}</span>
            <span className="font-black text-white">{item.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonBlock() {
  return <div className="h-28 animate-pulse rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04]" />;
}

export default function AiChannels() {
  // Keep this guard close to the settings page as a second UI boundary in case a
  // reviewer follows a saved settings URL directly.
  if (isMetaReviewerUser()) return <Navigate to="/admin/ai-inbox" replace />;
  return <AiChannelsWorkspace />;
}

function AiChannelsWorkspace() {
  const { t, i18n } = useTranslation();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const dir = i18n.dir();

  const [channelStatus, setChannelStatus] = useState({});
  const [metaStatus, setMetaStatus] = useState(null);
  const [automationRules, setAutomationRules] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [settingsSaving, setSettingsSaving] = useState("");
  const [whatsappGateway, setWhatsappGateway] = useState(null);
  const [whatsappTest, setWhatsappTest] = useState({ phone: "", message: "اختبار من بوابة واتساب ERP." });
  const whatsappGatewayRef = useRef(null);

  const tr = useCallback((key, fallback, options) => t(`common.aiChannels.${key}`, { defaultValue: fallback, ...(options || {}) }), [t]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setAnalyticsLoading(true);
    const [statusResult, metaResult, inboxResult, analyticsResult, rulesResult, whatsappGatewayResult] = await Promise.allSettled([
      api.get("/ai-agent/channels/status", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/integrations/meta/status", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/ai-agent/inbox", { params: { limit: 12 }, headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/ai-agent/analytics", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/marketing/comment-dm/rules", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/whatsapp/status", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
    ]);

    if (statusResult.status === "fulfilled") {
      setChannelStatus(statusResult.value?.channels || {});
    } else {
      setChannelStatus({});
      devWarn("channel status unavailable", statusResult.reason);
    }

    if (metaResult.status === "fulfilled") {
      setMetaStatus(metaResult.value || null);
    } else {
      setMetaStatus(null);
      devWarn("meta integration status unavailable", metaResult.reason);
    }

    if (inboxResult.status === "fulfilled") {
      setConversations(normalizeConversations(inboxResult.value));
    } else {
      setConversations([]);
      devWarn("inbox unavailable", inboxResult.reason);
    }

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(normalizeAnalytics(analyticsResult.value));
    } else {
      setAnalytics(normalizeAnalytics({}));
      devWarn("analytics unavailable", analyticsResult.reason);
    }

    if (rulesResult.status === "fulfilled") {
      setAutomationRules(asArray(rulesResult.value?.data || rulesResult.value?.rules || rulesResult.value));
    } else {
      setAutomationRules([]);
      devWarn("automation rules unavailable", rulesResult.reason);
    }

    if (whatsappGatewayResult.status === "fulfilled") {
      setWhatsappGateway(whatsappGatewayResult.value?.status || null);
    } else {
      setWhatsappGateway(null);
      devWarn("whatsapp gateway unavailable", whatsappGatewayResult.reason);
    }

    setAnalyticsLoading(false);
    setLoading(false);
  }, [headers]);

  useEffect(() => {
    Promise.resolve().then(loadPage);
  }, [loadPage]);

  const pauseAutomation = useCallback(async (apiKey) => {
    setBusyAction(`pause:${apiKey}`);
    setActionMessage("");
    try {
      await api.patch(`/ai-agent/channels/${encodeURIComponent(apiKey)}/settings`, {
        tenant_id: tenantId,
        auto_reply_mode: "off",
        ai_replies_enabled: false,
      }, { headers });
      setActionMessage(tr("actions.paused", "Automation paused for this channel."));
      await loadPage();
    } catch (error) {
      setActionMessage(error?.message || tr("actions.pauseFailed", "Unable to pause automation."));
    } finally {
      setBusyAction("");
    }
  }, [headers, loadPage, tenantId, tr]);

  const sendTestMessage = useCallback(async (channelKey) => {
    const recipientId = window.prompt(tr("actions.testRecipientPrompt", "Enter the Meta recipient ID to send a test message"));
    if (!text(recipientId)) return;
    setBusyAction(`test:${channelKey}`);
    setActionMessage("");
    try {
      await api.post("/integrations/meta/test-message", {
        tenant_id: tenantId,
        channel: channelKey === "instagram" ? "instagram" : "facebook",
        recipient_id: recipientId,
        message: tr("actions.testMessageBody", "Test message from AI Inbox channel health check."),
      }, { headers });
      setActionMessage(tr("actions.testSent", "Test message sent."));
      await loadPage();
    } catch (error) {
      setActionMessage(error?.message || tr("actions.testFailed", "Test message failed."));
    } finally {
      setBusyAction("");
    }
  }, [headers, loadPage, tenantId, tr]);

  const saveChannelAISetting = useCallback(async (channel, patch) => {
    const channelId = channel.apiKey;
    setSettingsSaving(`${channelId}:${Object.keys(patch).join(",")}`);
    setActionMessage("");
    try {
      await api.put(`/ai-agent/channels/${encodeURIComponent(channelId)}/settings`, {
        tenant_id: tenantId,
        platform: channel.key === "facebook" ? "facebook" : channel.apiKey,
        ...patch,
      }, { headers });
      setActionMessage(tr("actions.channelAiSettingsSaved", "Channel AI settings saved."));
      await loadPage();
    } catch (error) {
      setActionMessage(error?.message || tr("actions.channelAiSettingsFailed", "Unable to save channel AI settings."));
    } finally {
      setSettingsSaving("");
    }
  }, [headers, loadPage, tenantId, tr]);

  const sendWhatsappGatewayTest = useCallback(async () => {
    setBusyAction("whatsapp-gateway:test");
    setActionMessage("");
    try {
      await api.post("/whatsapp/send-test", whatsappTest, { headers });
      setActionMessage("WhatsApp Gateway test message sent.");
      await loadPage();
    } catch (error) {
      setActionMessage(error?.message || "Unable to send WhatsApp Gateway test message.");
    } finally {
      setBusyAction("");
    }
  }, [headers, loadPage, whatsappTest]);

  const openWhatsappGatewaySettings = useCallback(() => {
    whatsappGatewayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const customerConversations = useMemo(() => conversations.filter((conversation) => !conversation.internal), [conversations]);
  const internalConversations = useMemo(() => conversations.filter((conversation) => conversation.internal), [conversations]);

  const formatMessagePreview = useCallback((conversation = {}) => {
    if (conversation.message_label_key) return tr(`messageLabels.${conversation.message_label_key}`, conversation.message_label_key);
    return conversation.last_message || tr("empty.noPreview", "No message preview");
  }, [tr]);

  const formatIntent = useCallback((conversation = {}) => {
    if (!conversation.detected_intent) return tr("empty.unknownIntent", "Unknown");
    const labelKey = conversation.intent_label_key || readableKey(conversation.detected_intent);
    return tr(`intentLabels.${labelKey}`, labelKey);
  }, [tr]);

  const formatSentiment = useCallback((value = "") => {
    const key = text(value || "neutral", "neutral").toLowerCase().replace(/[_-]+/g, " ");
    return tr(`sentimentLabels.${key}`, key);
  }, [tr]);

  const activeAutomationRulesCount = useMemo(() => automationRules.filter((rule) => rule?.is_active !== false).length, [automationRules]);

  const channelCards = useMemo(() => CHANNELS.map((channel) => {
    const status = channelStatus[channel.apiKey] || {};
    const metaChannel = channel.key === "facebook" ? metaStatus?.channels?.facebook : channel.key === "instagram" ? metaStatus?.channels?.instagram : null;
    const metaConfig = metaStatus?.config || {};
    const sourceAliases = channel.key === "facebook" ? ["facebook", "facebook_messenger"] : [channel.key, channel.apiKey];
    const channelConversations = customerConversations.filter((conversation) => sourceAliases.includes(conversation.source_channel));
    const events = asArray(status.events);
    const inboundEvents = events.filter((event) => event.direction === "inbound");
    const outboundSentEvents = events.filter((event) => event.direction === "outbound" && ["sent", "test_sent"].includes(text(event.status).toLowerCase()));
    const messagesToday = events.filter((event) => isToday(event.created_at)).length || channelConversations.filter((item) => isToday(item.time)).length;
    const pendingConversations = channelConversations.filter((item) => ["pending", "needs_human"].includes(item.ai_status)).length;
    const aiRepliesSent = outboundSentEvents.length || channelConversations.filter((item) => item.ai_status === "replied").length;
    const lastInbound = inboundEvents[0]?.created_at || channelConversations.find((item) => item.last_message)?.time || null;
    const localAvailable = channel.key === "web_chat";
    const hasConfig = channel.key === "whatsapp" ? whatsappGateway?.configured === true : localAvailable ? true : channelHasRequiredConfig(channel.key, status);
    const metaConfigHealthy = META_CHANNEL_KEYS.has(channel.key) && metaSetupHealthy(metaStatus);
    const tokenValid = META_CHANNEL_KEYS.has(channel.key) ? metaTokenValid(metaConfig) || metaChannel?.token_valid === true : false;
    const liveReceiptHealthy = META_CHANNEL_KEYS.has(channel.key) && Boolean(lastInbound || channelConversations.length);
    const operationalConnected = META_CHANNEL_KEYS.has(channel.key) && tokenValid && metaConfigHealthy && (
      channel.key === "facebook"
        ? Boolean(metaConfig.facebook_page_id || metaChannel?.page_id)
        : Boolean(metaConfig.instagram_business_account_id || metaChannel?.business_account_id)
    );
    const connected = META_CHANNEL_KEYS.has(channel.key)
      ? Boolean(operationalConnected || liveReceiptHealthy || metaConnected(metaChannel, channel.key === "facebook" ? ["messenger_connected", "publishing_connected", "connected"] : ["dm_connected", "publishing_connected", "connected"]))
      : channel.key === "whatsapp" ? whatsappGateway?.connected === true : localAvailable ? false : status.effective_enabled === true && hasConfig;
    const setupRequired = META_CHANNEL_KEYS.has(channel.key)
      ? !connected && (metaConfig.page_access_token_configured === true || Boolean(metaConfig.facebook_page_id || metaConfig.instagram_business_account_id))
      : !connected && (hasConfig || status.env_enabled === true || status.ai_replies_enabled === true);
    return {
      ...channel,
      status,
      connected,
      localAvailable,
      setupRequired,
      statusKey: connected ? "connected" : localAvailable ? "local" : setupRequired ? "setup" : "disconnected",
      aiStatus: connected && status.ai_replies_enabled === true
        ? { status: "LIVE", label: tr("status.aiLive", "AI LIVE"), color: "green" }
        : status.aiStatus || {
          status: connected ? "OFF" : "OFF",
          label: tr("status.aiOff", "AI OFF"),
        },
      autoReply: localAvailable ? true : status.ai_replies_enabled === true,
      messagesToday,
      pendingConversations,
      lastSync: META_CHANNEL_KEYS.has(channel.key) ? metaConfig.last_sync_at || status.last_webhook_received_at || events[0]?.created_at || channelConversations[0]?.time || null : status.last_webhook_received_at || events[0]?.created_at || channelConversations[0]?.time || null,
      lastError: text(status.last_send_error),
      metaChannel,
      metaConfig,
      operationalConnected,
      webhookHealthy: META_CHANNEL_KEYS.has(channel.key) ? Boolean(metaChannel?.webhook_healthy || metaConfigHealthy || liveReceiptHealthy) : Boolean(status.last_webhook_received_at),
      tokenValid,
      messagingActive: META_CHANNEL_KEYS.has(channel.key) ? Boolean(connected && (liveReceiptHealthy || metaChannel?.messaging_active)) : status.effective_enabled === true,
      aiAutomationActive: localAvailable ? true : status.ai_replies_enabled === true,
      liveConversations: channelConversations.length,
      unread: pendingConversations,
      aiRepliesSent,
      lastInbound,
      activeAutomationRulesCount,
      aiChannelSettings: status.aiChannelSettings || {},
      effectiveAiMode: status.effective_ai_mode || "suggest_only",
      effectiveTone: status.effective_tone || "casual",
    };
  }), [activeAutomationRulesCount, channelStatus, customerConversations, metaStatus, whatsappGateway]);

  const activeConversations = customerConversations.filter((conversation) => conversation.conversation_status !== "closed").length || number(analytics?.totalConversations);
  const waitingHuman = customerConversations.filter((conversation) => conversation.ai_status === "needs_human").length || number(analytics?.humanTakeovers);
  const resolvedToday = customerConversations.filter((conversation) => conversation.conversation_status === "closed" && isToday(conversation.closed_at || conversation.updated_at)).length;
  const online = channelCards.some((channel) => channel.connected || channel.localAvailable) || activeConversations > 0;
  const latestConversations = customerConversations.slice(0, 6);
  const latestInternalConversations = internalConversations.slice(0, 4);
  const total = Math.max(number(analytics?.totalConversations), customerConversations.length);
  const sentimentRows = useMemo(() => {
    const counts = customerConversations.reduce((acc, item) => {
      const key = text(item.customer_sentiment || item.sentiment || "neutral", "neutral").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    if (!Object.keys(counts).length && (customerConversations.length || total > 0)) counts.neutral = customerConversations.length || total;
    return Object.entries(counts).map(([label, count]) => ({ label: formatSentiment(label), count }));
    // tr is a dependency: the AI status labels above are RESOLVED strings.
  }, [customerConversations, formatSentiment, total, tr]);

  const topIntentRows = useMemo(() => {
    const apiRows = asArray(analytics?.topIntents).filter((item) => item.label && item.count > 0);
    if (apiRows.length) return apiRows.map((item) => ({ ...item, label: tr(`intentLabels.${readableKey(item.label)}`, item.label) }));
    const counts = customerConversations.reduce((acc, conversation) => {
      if (!conversation.detected_intent) return acc;
      const key = conversation.intent_label_key || readableKey(conversation.detected_intent);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([key, count]) => ({ label: tr(`intentLabels.${key}`, key), count }));
  }, [analytics?.topIntents, customerConversations, tr]);

  return (
    <div dir={dir} className="min-h-full bg-[linear-gradient(180deg,#020617,#0f172a)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                {tr("eyebrow", "AI support command center")}
              </div>
              <h1 className="m1-display mt-3">{tr("title", "مركز التحكم في القنوات الذكية")}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {tr("subtitle", "Monitor every AI customer channel, handoff queue, inbox signal, and response metric from one operational view.")}
              </p>
              <p className="mt-3 inline-flex rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-bold text-slate-300">
                {tr("note.externalChannels", "القنوات الخارجية تحتاج إلى اتصال API، بينما يمكن تشغيل دردشة الموقع محليًا أولًا.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadPage}
                disabled={loading}
                className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {tr("refresh", "Refresh")}
              </button>
              <Link to="/admin/ai-agent-settings" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-slate-950 transition hover:bg-primary">
                <Settings className="h-4 w-4" />
                {tr("settings", "Settings")}
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard icon={Activity} label={tr("health.status", "AI support status")} value={online ? tr("status.online", "Online") : tr("status.offline", "Offline")} tone={online ? "emerald" : "amber"} />
            <KpiCard icon={Users} label={tr("health.active", "Active conversations")} value={activeConversations} />
            <KpiCard icon={AlertTriangle} label={tr("health.waiting", "Waiting for human takeover")} value={waitingHuman} tone="amber" />
            <KpiCard icon={Clock3} label={tr("health.avgResponse", "متوسط زمن الاستجابة")} value={seconds(analytics?.averageResponseSeconds)} tone="violet" />
            <KpiCard icon={CheckCircle2} label={tr("health.resolvedToday", "Resolved by AI today")} value={resolvedToday || number(analytics?.closedConversations)} tone="emerald" />
          </div>
          {actionMessage ? <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-sm font-bold text-primary">{actionMessage}</div> : null}
        </section>

        <section id="whatsapp-gateway-settings" ref={whatsappGatewayRef} className="scroll-mt-6 rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.055] p-5 shadow-xl shadow-emerald-950/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-100">
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp Gateway
              </div>
              <h2 className="m1-section-title mt-3 text-white">{tr("gateway.title", "WhatsApp Gateway / Evolution API")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Manual WhatsApp gateway foundation for order confirmations and tests. This is separate from the existing Meta WhatsApp AI Inbox integration.
              </p>
            </div>
            <button
              type="button"
              onClick={loadPage}
              disabled={loading}
              className="inline-flex h-[var(--control-height-md)] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/20 bg-emerald-400/10 px-4 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/15 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {tr("gateway.refresh", "Refresh status")}
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 text-sm font-black text-white">{tr("gateway.connectionSettings", "Gateway connection settings")}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.provider", "Provider")}</span>
                  <input
                    value="Evolution API"
                    readOnly
                    className="mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.connectionStatus", "Connection status")}</span>
                  <input
                    value={whatsappGateway?.connected ? tr("gateway.connected", "Connected / {{state}}", { state: whatsappGateway?.state || "open" }) : whatsappGateway?.configured === false ? tr("gateway.notConfigured", "Not configured") : whatsappGateway?.state || tr("gateway.unknown", "Unknown")}
                    readOnly
                    className={whatsappGateway?.connected ? "mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-black text-emerald-100 outline-none" : "mt-1 h-[var(--control-height-lg)] w-full  border border-amber-300/20 bg-amber-400/10 px-3 text-sm font-black text-amber-100 outline-none"}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.apiUrl", "API URL")}</span>
                  <input
                    value={whatsappGateway?.apiUrl || ""}
                    readOnly
                    placeholder={tr("gateway.apiUrlMissing", "EVOLUTION_API_URL is not configured")}
                    className="mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.apiKey", "API Key")}</span>
                  <input
                    value={whatsappGateway?.apiKeyConfigured ? tr("gateway.apiKeyConfigured", "Configured") : ""}
                    readOnly
                    placeholder={tr("gateway.apiKeyMissing", "EVOLUTION_API_KEY is missing")}
                    className="mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.instanceName", "Instance Name")}</span>
                  <input
                    value={whatsappGateway?.instanceName || ""}
                    readOnly
                    placeholder={tr("gateway.instanceMissing", "EVOLUTION_INSTANCE_NAME is not configured")}
                    className="mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 text-sm font-black text-white">{tr("gateway.sendTest", "Send manual test message")}</div>
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.egyptianPhone", "Egyptian phone")}</span>
                  <input
                    value={whatsappTest.phone}
                    onChange={(event) => setWhatsappTest((current) => ({ ...current, phone: event.target.value }))}
                    inputMode="tel"
                    placeholder="01000000000"
                    className="mt-1 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{tr("gateway.message", "Message")}</span>
                  <textarea
                    value={whatsappTest.message}
                    onChange={(event) => setWhatsappTest((current) => ({ ...current, message: event.target.value }))}
                    rows={3}
                    className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm font-bold leading-6 text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40"
                    dir="auto"
                  />
                </label>
                <button
                  type="button"
                  onClick={sendWhatsappGatewayTest}
                  disabled={busyAction === "whatsapp-gateway:test" || !text(whatsappTest.phone) || !text(whatsappTest.message)}
                  className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-emerald-300 px-4 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50"
                >
                  {busyAction === "whatsapp-gateway:test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      إرسال اختبار
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Publishing channel, not a conversation channel — rendered outside the
            grid below so it is not read as another inbox source. */}
        <TikTokConnectionCard />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {channelCards.map((channel) => {
            const Icon = channel.icon;
            return (
              <article key={channel.key} className={`rounded-[var(--radius-card)] border p-5 shadow-xl transition ${ channel.connected ? "border-emerald-300/25 bg-emerald-400/[0.055] shadow-emerald-950/20" : "border-white/10 bg-white/[0.045] shadow-black/10" }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className={`rounded-2xl border p-3 ${ channel.tone === "emerald" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : channel.tone === "pink" ? "border-pink-300/20 bg-pink-400/10 text-pink-100" : channel.tone === "blue" ? "border-primary/20 bg-primary/10 text-primary" : "border-primary/20 bg-primary/10 text-primary" }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <AIStatusBadge status={channel.aiStatus} />
                </div>

                <h2 className="m1-section-title mt-5 text-white">{tr(`channels.${channel.key}`, channel.key)}</h2>
                <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.06] p-3">
                  <div className="grid gap-2">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">{tr("card.aiMode", "AI Mode")}</span>
                      <select
                        value={channel.aiChannelSettings?.aiMode || "suggest_only"}
                        onChange={(event) => saveChannelAISetting(channel, { aiMode: event.target.value })}
                        disabled={Boolean(settingsSaving)}
                        className="mt-1 h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-2 text-xs font-black text-white outline-none focus:border-primary/40 disabled:opacity-60"
                      >
                        <option value="off">{tr("card.modeOff", "Off")}</option>
                        <option value="suggest_only">{tr("card.modeSuggestOnly", "Suggest only")}</option>
                        <option value="fully_automatic">{tr("card.modeFullyAutomatic", "Fully automatic")}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">{tr("card.tone", "Tone")}</span>
                      <select
                        value={channel.aiChannelSettings?.tone || ""}
                        onChange={(event) => saveChannelAISetting(channel, { tone: event.target.value || null })}
                        disabled={Boolean(settingsSaving)}
                        className="mt-1 h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-2 text-xs font-black text-white outline-none focus:border-primary/40 disabled:opacity-60"
                      >
                        <option value="">{tr("card.toneInherit", "Inherit global")}</option>
                        <option value="casual">{tr("card.toneCasual", "Casual Egyptian")}</option>
                        <option value="professional">{tr("card.toneProfessional", "Professional")}</option>
                        <option value="luxury">{tr("card.toneLuxury", "Luxury seller")}</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2">
                      <div className="text-slate-500">{tr("card.effectiveMode", "Effective mode")}</div>
                      <div className="mt-1 truncate font-black text-white">{channel.effectiveAiMode}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2">
                      <div className="text-slate-500">{tr("card.effectiveTone", "Effective tone")}</div>
                      <div className="mt-1 truncate font-black text-white">{channel.effectiveTone}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm">
                  {META_CHANNEL_KEYS.has(channel.key) ? (
                    <>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                        <div className="flex items-center gap-3">
                          {channel.metaChannel?.profile_picture_url || channel.metaConfig?.profile_picture_url ? (
                            <img src={channel.metaChannel?.profile_picture_url || channel.metaConfig?.profile_picture_url} alt="" className="h-10 w-10 rounded-2xl object-cover" />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] text-sm font-black text-slate-200">
                              {(channel.key === "facebook" ? "f" : "ig").toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                              {channel.key === "facebook" ? tr("card.connectedPage", "Connected page") : tr("card.connectedAccount", "Connected account")}
                            </div>
                            <div className="mt-1 truncate font-black text-white">
                              {channel.key === "facebook"
                                ? channel.metaChannel?.page_name || channel.metaConfig?.facebook_page_name || channel.metaConfig?.page_name || channel.metaConfig?.facebook_page_id || tr("empty.notConnected", "غير متصل")
                                : channel.metaChannel?.username || channel.metaConfig?.instagram_username || channel.metaConfig?.instagram_business_account_id || tr("empty.notConnected", "غير متصل")}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-xs">
                        <div>
                          <div className="text-slate-500">{tr("health.webhook", "Webhook")}</div>
                          <div className={channel.webhookHealthy ? "mt-1 font-black text-emerald-100" : "mt-1 font-black text-rose-100"}>{channel.webhookHealthy ? tr("status.healthy", "Healthy") : tr("status.failed", "Failed")}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">{tr("health.token", "Token")}</div>
                          <div className={channel.tokenValid ? "mt-1 font-black text-emerald-100" : "mt-1 font-black text-rose-100"}>{channel.tokenValid ? tr("status.valid", "Valid") : tr("status.expired", "Expired")}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">{tr("health.messaging", "Messaging")}</div>
                          <div className={channel.messagingActive ? "mt-1 font-black text-emerald-100" : "mt-1 font-black text-slate-300"}>{channel.messagingActive ? tr("status.active", "Active") : tr("status.inactive", "Inactive")}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-2"><div className="text-slate-500">{tr("card.liveConversations", "Live conversations")}</div><div className="mt-1 font-black text-white">{channel.liveConversations}</div></div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-2"><div className="text-slate-500">{tr("card.unread", "Unread")}</div><div className="mt-1 font-black text-white">{channel.unread}</div></div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-2"><div className="text-slate-500">{tr("card.aiRepliesSent", "الردود المرسلة بالذكاء الاصطناعي")}</div><div className="mt-1 font-black text-white">{channel.aiRepliesSent}</div></div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/30 p-2"><div className="text-slate-500">{tr("card.lastInbound", "Last inbound")}</div><div className="mt-1 font-black text-white">{safeDate(channel.lastInbound, tr("empty.never", "Never"))}</div></div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{tr("card.activeRules", "Active automation rules")}</span>
                        <span className="font-black text-white">{channel.activeAutomationRulesCount}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{tr("card.autoReply", "Auto-reply")}</span>
                        <StatusPill status={channel.autoReply ? "connected" : "disconnected"}>{channel.autoReply ? tr("status.enabled", "Enabled") : tr("status.disabled", "Disabled")}</StatusPill>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{tr("card.messagesToday", "Messages today")}</span>
                        <span className="font-black text-white">{channel.messagesToday}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">{tr("card.pending", "Pending conversations")}</span>
                        <span className="font-black text-white">{channel.pendingConversations}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400">{tr("card.lastSync", "Last sync")}</span>
                    <span className="font-bold text-slate-200">{safeDate(channel.lastSync, tr("empty.never", "Never"))}</span>
                  </div>
                </div>

                {channel.lastError ? (
                  <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">
                    {channel.lastError}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-2">
                  {META_CHANNEL_KEYS.has(channel.key) ? (
                    <Link
                      to={`/marketing/settings?section=${channel.key}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-slate-950 transition hover:bg-primary"
                    >
                      <Settings className="h-4 w-4" />
                      {tr("actions.manageMeta", "إدارة اتصال ميتا")}
                    </Link>
                  ) : channel.key === "whatsapp" ? (
                    <button
                      type="button"
                      onClick={openWhatsappGatewaySettings}
                      className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-white px-3 text-sm font-black text-slate-950 transition hover:bg-primary"
                    >
                      <Settings className="h-4 w-4" />
                      {tr("actions.configure", "إعداد")}
                    </button>
                  ) : (
                    <Link
                      to={channel.connected || channel.localAvailable ? "/admin/ai-inbox" : "/admin/ai-agent-settings"}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-slate-950 transition hover:bg-primary"
                    >
                      {channel.connected || channel.localAvailable ? <Inbox className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
                      {channel.connected || channel.localAvailable ? tr("actions.manage", "إدارة") : tr("actions.configure", "إعداد")}
                    </Link>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Link to="/admin/ai-inbox" className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {tr("actions.viewInbox", "عرض الصندوق")}
                    </Link>
                    {META_CHANNEL_KEYS.has(channel.key) ? (
                    <button type="button" onClick={() => sendTestMessage(channel.key)} disabled={busyAction === `test:${channel.key}`} className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10 disabled:opacity-50">
                      {busyAction === `test:${channel.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {tr("actions.sendTest", "إرسال اختبار")}
                    </button>
                    ) : channel.key === "whatsapp" ? (
                    <button type="button" onClick={openWhatsappGatewaySettings} className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10">
                      <TestTube2 className="h-3.5 w-3.5" />
                      {tr("actions.test", "Test channel")}
                    </button>
                    ) : (
                    <Link to="/admin/ai-agent-settings" className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10">
                      <TestTube2 className="h-3.5 w-3.5" />
                      {tr("actions.test", "Test channel")}
                    </Link>
                    )}
                  </div>
                  {META_CHANNEL_KEYS.has(channel.key) ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => loadPage()} disabled={loading} className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 text-xs font-black text-primary transition hover:bg-primary/15 disabled:opacity-50">
                        <RefreshCw className="h-3.5 w-3.5" />
                        {tr("actions.resync", "إعادة المزامنة")}
                      </button>
                      <button type="button" onClick={() => pauseAutomation(channel.apiKey)} disabled={busyAction === `pause:${channel.apiKey}` || !channel.aiAutomationActive} className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-amber-300/20 bg-amber-400/10 px-3 text-xs font-black text-amber-100 transition hover:bg-amber-400/15 disabled:opacity-50">
                        {busyAction === `pause:${channel.apiKey}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                        {tr("actions.pauseAutomation", "إيقاف الذكاء الاصطناعي مؤقتًا")}
                      </button>
                      <Link to="/marketing/settings?section=automation" className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/15">
                        <Bot className="h-3.5 w-3.5" />
                        {tr("actions.automationRules", "قواعد الأتمتة")}
                      </Link>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-xl shadow-black/10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-primary">
                  <Inbox className="h-4 w-4" />
                  {tr("inbox.title", "معاينة الصندوق المباشر")}
                </div>
                <p className="mt-1 text-sm text-slate-400">{tr("inbox.subtitle", "Latest AI conversations across connected and local channels.")}</p>
              </div>
              <Link to="/admin/ai-inbox" className="shrink-0 text-sm font-black text-primary hover:text-primary">{tr("actions.openInbox", "فتح الصندوق")}</Link>
            </div>

            {loading ? (
              <div className="space-y-3"><SkeletonBlock /><SkeletonBlock /></div>
            ) : latestConversations.length ? (
              <div className="m1-table-container overflow-x-auto">
                <table className="m1-table m1-table--compact w-full min-w-[48rem] text-start text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.customer", "العميل")}</th>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.channel", "القناة")}</th>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.message", "آخر رسالة")}</th>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.intent", "النية المكتشفة")}</th>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.aiStatus", "حالة الذكاء الاصطناعي")}</th>
                      <th className="px-3 py-2 text-start font-black">{tr("inbox.time", "الوقت")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestConversations.map((conversation, index) => (
                      <tr key={conversation.session_id || index}>
                        <td className="px-3 py-3 font-black text-white">{conversation.customer_name || tr("empty.guest", "عميل ضيف")}</td>
                        <td className="px-3 py-3 text-slate-200">{tr(`channels.${conversation.source_channel}`, conversation.source_channel)}</td>
                        <td className="max-w-[16rem] truncate px-3 py-3 text-slate-300">{formatMessagePreview(conversation)}</td>
                        <td className="px-3 py-3 text-slate-300">{formatIntent(conversation)}</td>
                        <td className="px-3 py-3"><StatusPill status={conversation.ai_status}>{tr(`aiStatus.${conversation.ai_status}`, conversation.ai_status)}</StatusPill></td>
                        <td className="px-3 py-3 text-slate-400">{safeDate(conversation.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel
                icon={MessageCircle}
                title={tr("empty.noConversationsTitle", "لا توجد محادثات ذكاء اصطناعي بعد")}
                text={tr("empty.noConversations", "لا توجد محادثات ذكاء اصطناعي بعد. اربط قناة أو فعّل دردشة الموقع لبدء استقبال الرسائل.")}
              />
            )}

            {import.meta.env.DEV && latestInternalConversations.length ? (
              <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-400/5 p-4">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-amber-100">{tr("internal.title", "Internal tests")}</div>
                <div className="space-y-2">
                  {latestInternalConversations.map((conversation, index) => (
                    <div key={conversation.session_id || index} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-slate-950/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-black text-white">{tr("internal.customer", "Internal test")}</div>
                        <div className="text-slate-400">{formatMessagePreview(conversation)}</div>
                      </div>
                      <StatusPill status="setup">{tr(`channels.${conversation.source_channel}`, conversation.source_channel)}</StatusPill>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-xl shadow-black/10">
            <div className="mb-4 inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-primary">
              <BarChart3 className="h-4 w-4" />
              {tr("analytics.title", "ملخص تحليلات الذكاء الاصطناعي")}
            </div>

            {analyticsLoading ? (
              <div className="space-y-3"><SkeletonBlock /><SkeletonBlock /></div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard icon={AlertTriangle} label={tr("analytics.takeoverRate", "معدل التدخل البشري")} value={total ? percent(number(analytics?.humanTakeovers) / total) : "0%"} tone="amber" />
                  <KpiCard icon={Sparkles} label={tr("analytics.resolutionRate", "معدل حل الذكاء الاصطناعي")} value={total ? percent(number(analytics?.closedConversations) / total) : "0%"} tone="emerald" />
                  <KpiCard icon={Clock3} label={tr("analytics.avgResponse", "متوسط زمن الاستجابة")} value={seconds(analytics?.averageResponseSeconds)} tone="violet" />
                  <KpiCard icon={Bot} label={tr("analytics.aiReplies", "ردود الذكاء الاصطناعي")} value={number(analytics?.aiReplies)} />
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                  <div className="mb-3 text-sm font-black text-white">{tr("analytics.topIntents", "أكثر النيات اكتشافًا")}</div>
                  <BarList rows={topIntentRows} empty={tr("empty.noAnalytics", "لا توجد بيانات تحليلات بعد.")} />
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/25 p-4">
                  <div className="mb-3 text-sm font-black text-white">{tr("analytics.sentiment", "توزيع المشاعر")}</div>
                  <BarList rows={sentimentRows} empty={tr("empty.noSentiment", "لا توجد إشارات مشاعر بعد.")} />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

    </div>
  );
}
