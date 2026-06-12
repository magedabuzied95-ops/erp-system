import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowUpDown,
  Bot,
  BadgePercent,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Brain,
  CheckCircle2,
  Clock3,
  CreditCard,
  Flame,
  Globe,
  Handshake,
  EyeOff,
  Info as InfoIcon,
  Loader2,
  LockKeyhole,
  Image as ImageIcon,
  MessageSquareText,
  MoreVertical,
  PackageCheck,
  PauseCircle,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PlayCircle,
  RefreshCw,
  Radio,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  Snowflake,
  Sparkles,
  Timer,
  User,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { subscribeRealtime } from "../../../shared/realtime/socketStore";
import AIStatusBadge from "../../../components/ai/AIStatusBadge";
import AILiveLogs from "../../../components/ai/AILiveLogs";
import { useTenant } from "../../saas/context/TenantContext";
import { VirtualList } from "../../../shared/components/VirtualList";
import { formatCurrency } from "../../../shared/lib/currency";

const asArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => formatCurrency(value);
const clean = (value = "") => String(value || "").trim();
const encodeConversationId = (value = "") => {
  const raw = clean(value);
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};
const aiInboxConversationEndpoint = (sessionId = "", suffix = "") =>
  `/ai-inbox/conversations/${encodeConversationId(sessionId)}${suffix}`;
const aiAgentInboxEndpoint = (sessionId = "", suffix = "") =>
  `/ai-agent/inbox/${encodeConversationId(sessionId)}${suffix}`;

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const filters = [
  { key: "all", label: "الكل" },
  { key: "facebook", label: "فيسبوك" },
  { key: "instagram", label: "إنستجرام" },
  { key: "needs_human", label: "يحتاج تدخلًا بشريًا" },
  { key: "ai_replied", label: "رد الذكاء الاصطناعي" },
  { key: "unread", label: "غير مقروء" },
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
const channelLabel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "facebook_messenger") return "ماسنجر فيسبوك";
  if (key === "instagram") return "رسائل إنستجرام";
  if (key === "whatsapp") return "واتساب";
  if (key === "web_chat") return "دردشة الويب";
  return key || "قناة غير معروفة";
};
const channelBadgeLabel = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key.includes("whatsapp")) return "واتساب";
  if (key.includes("instagram")) return "إنستجرام";
  if (key.includes("facebook") && key.includes("messenger")) return "ماسنجر";
  if (key.includes("facebook")) return "فيسبوك";
  if (key.includes("messenger")) return "ماسنجر";
  if (key.includes("web")) return "ويب";
  return "الكل";
};
const isConversationAiEnabled = (conversation = {}) => conversation?.ai_enabled !== false;
const fixedChannelOrder = ["whatsapp", "messenger", "instagram", "web"];
const normalizeConversationChannel = (conversation = {}) => {
  const raw = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform || "");
  const key = raw.toLowerCase();
  if (key.includes("whatsapp")) return "whatsapp";
  if (key.includes("instagram")) return "instagram";
  if (key.includes("facebook") && key.includes("messenger")) return "messenger";
  if (key.includes("messenger")) return "messenger";
  if (key.includes("facebook")) return "facebook";
  if (key.includes("web")) return "web";
  return key || "unknown";
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
const customerDisplayName = (item = {}) => {
  const source = item || {};
  const profile = source.customer_profile || {};
  const fullName = [source.first_name || profile.first_name, source.last_name || profile.last_name].map(clean).filter(Boolean).join(" ");
  return clean(
    source.customer_name ||
    fullName ||
    profile.name ||
    profile.full_name ||
    source.external_customer_id ||
    source.phone
  );
};
const isRtlText = (value = "") => /[\u0600-\u06ff]/.test(String(value || ""));
const needsHumanAttention = (conversation = {}) =>
  conversation?.human_takeover === true ||
  conversation?.ai_paused === true ||
  conversation?.conversation_status === "human_takeover" ||
  Boolean(clean(conversation?.escalation_reason || conversation?.ai_escalation_reason)) ||
  conversation?.needs_human_support === true;
const messageKey = (message = {}) =>
  String(message.dedupe_key || message.external_message_id || message.id || `${message.sender_type || ""}:${message.created_at || ""}:${message.customer_message || message.ai_answer || message.staff_message || ""}`);
const uniqueMessages = (messages = []) => {
  const seen = new Set();
  return asArray(messages).filter((message) => {
    const key = messageKey(message);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
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
                <a key={`${item.id || item.product_id || itemIndex}`} href={item.product_url || (item.product_id ? `/shop/product/${item.product_id}` : "#")} className="min-w-[7.5rem] max-w-[7.5rem] rounded-xl border border-white/10 bg-slate-950 p-2 transition hover:border-cyan-300/30">
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
          <a key={product.id || index} href={product.product_url || (product.id ? `/shop/product/${product.id}` : "#")} className="flex min-w-0 gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2 transition hover:border-cyan-300/30">
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

const ConversationListItem = memo(function ConversationListItem({ item, active, unseen, onSelect }) {
  const channel = item.channel || item.source || "web_chat";
  const liveMeta = item.is_live_meta === true || isMetaChannel(channel);
  const customerName = customerDisplayName(item) || "Customer";
  const avatarUrl = customerAvatarUrl(item);
  const lastMessage = item.latest_message_preview || item.last_message || item.customer_message || item.ai_answer || "لا توجد رسائل بعد.";
  const unreadCount = Number(item.unread_count || item.unread || 0);
  const aiState = item.conversation_status === "closed" || item.conversation_status === "human_takeover" || item.needs_human_support ? "Paused" : "Active";
  const containerTone =
    active
      ? "border-cyan-300/50 bg-cyan-300/12 shadow-[0_10px_30px_rgba(34,211,238,0.12)]"
      : unreadCount || unseen || liveMeta
        ? "border-white/10 bg-slate-950/80 hover:border-cyan-300/25 hover:bg-white/[0.045]"
        : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-white/[0.045]";
  return (
    <button
      type="button"
      onClick={() => onSelect(item.session_id)}
      className={`w-full rounded-2xl border p-3 text-left transition ${containerTone}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
          ) : (
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${liveMeta ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[0.07] text-slate-200"}`}><User className="h-5 w-5" /></span>
          )}
          {unreadCount ? <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-rose-500" aria-hidden="true" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black leading-5 text-white">{customerName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Pill tone={isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>{channelBadgeLabel(channel)}</Pill>
                <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-black uppercase tracking-[0.14em] ${aiState === "Active" ? "bg-emerald-300/12 text-emerald-100" : "bg-amber-300/12 text-amber-100"}`}>AI {aiState}</span>
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-slate-500">{relativeTime(item.last_message_at || item.last_activity_at || item.updated_at)}</span>
          </div>
          <p dir={isRtlText(lastMessage) ? "rtl" : "auto"} className="mt-2 line-clamp-2 text-[13px] leading-6 text-slate-300">{lastMessage}</p>
          {unreadCount ? <div className="mt-2 flex justify-end"><span className="inline-flex h-5 items-center rounded-full bg-rose-400/12 px-2 text-[10px] font-black text-rose-100">غير مقروء {unreadCount}</span></div> : null}
        </div>
      </div>
    </button>
  );
});

function InboxChannelSidebar({ channels = [], allUnread = 0, activeChannel = "all", onSelectChannel }) {
  const channelIcon = (key, active = false) => {
    const baseIconClass = "h-4.5 w-4.5";
    if (key === "all") {
      return <MessageSquareText className={baseIconClass} />;
    }
    if (key === "whatsapp") {
      return (
        <span className={`grid h-8 w-8 place-items-center rounded-full ${active ? "bg-emerald-400 text-emerald-950" : "bg-emerald-500/20 text-emerald-200"}`}>
          <svg viewBox="0 0 24 24" className={baseIconClass} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8.5 18.5 6 19l.5-2.4A8 8 0 1 1 8.5 18.5Z" />
            <path d="M9.7 9.1c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .6.5l.4 1c.1.3.1.5 0 .7l-.5.8c.6 1.2 1.6 2.1 2.9 2.8l.8-.4c.2-.1.4-.1.7 0l1 .4c.5.2.5.4.5.6v.5c0 .2 0 .4-.4.6-.4.2-1 .4-1.5.3-2.8-.7-5.4-3.2-6.1-6-.1-.5.1-1.1.3-1.4Z" />
          </svg>
        </span>
      );
    }
    if (key === "messenger") {
      return (
        <span className={`grid h-8 w-8 place-items-center rounded-full ${active ? "bg-sky-400 text-sky-950" : "bg-sky-500/20 text-sky-200"}`}>
          <svg viewBox="0 0 24 24" className={baseIconClass} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4.5c-4.4 0-8 3.2-8 7.2 0 2.3 1.2 4.3 3.1 5.6V20l2.7-1.5c.7.2 1.4.3 2.2.3 4.4 0 8-3.2 8-7.1 0-4-3.6-7.2-8-7.2Z" />
            <path d="m8.8 13.2 2.3-2.5 2 1.8 2.2-2.5-2.3 4-2-1.8-2.2 1Z" />
          </svg>
        </span>
      );
    }
    if (key === "instagram") {
      return (
        <span className={`grid h-8 w-8 place-items-center rounded-[0.95rem] ${active ? "bg-[linear-gradient(135deg,#f9a8d4,#c084fc,#818cf8)] text-slate-950" : "bg-[linear-gradient(135deg,rgba(244,114,182,0.22),rgba(192,132,252,0.2),rgba(129,140,248,0.2))] text-pink-100"}`}>
          <svg viewBox="0 0 24 24" className={baseIconClass} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="4" />
            <circle cx="12" cy="12" r="3.25" />
            <circle cx="16.6" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
          </svg>
        </span>
      );
    }
    return (
      <span className={`grid h-8 w-8 place-items-center rounded-full ${active ? "bg-slate-200 text-slate-950" : "bg-white/10 text-slate-200"}`}>
        <Globe className={baseIconClass} />
      </span>
    );
  };

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center rounded-3xl border border-white/10 bg-white/[0.04] px-2 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={() => onSelectChannel("all")}
        className={`relative mb-2 flex h-[58px] w-12 flex-col items-center justify-center rounded-2xl border text-center transition ${
          activeChannel === "all" ? "border-cyan-300/45 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-slate-950/60 text-white hover:border-white/20"
        }`}
      >
        {Number(allUnread || 0) > 0 ? (
          <span dir="ltr" className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow-[0_8px_18px_rgba(244,63,94,0.35)]">
            {allUnread}
          </span>
        ) : null}
        {channelIcon("all", activeChannel === "all")}
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {channels.map((channel) => (
          <button
            key={channel.key}
            type="button"
            onClick={() => onSelectChannel(channel.key)}
            title={channelBadgeLabel(channel.key)}
            className={`relative flex h-[58px] w-12 flex-col items-center justify-center rounded-2xl border px-1 text-center transition ${
              activeChannel === channel.key ? "border-cyan-300/45 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-slate-950/60 text-white hover:border-white/20"
            }`}
          >
            {Number(channel.unread || 0) > 0 ? (
              <span dir="ltr" className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow-[0_8px_18px_rgba(244,63,94,0.35)]">
                {channel.unread}
              </span>
            ) : null}
            {channelIcon(channel.key, activeChannel === channel.key)}
          </button>
        ))}
      </div>
    </aside>
  );
}

const InboxConversationCard = memo(function InboxConversationCard({ item, active, unseen, onSelect }) {
  const channel = item.channel || item.source || "web_chat";
  const liveMeta = item.is_live_meta === true || isMetaChannel(channel);
  const customerName = customerDisplayName(item) || "Customer";
  const avatarUrl = customerAvatarUrl(item);
  const lastMessage = item.latest_message_preview || item.last_message || item.customer_message || item.ai_answer || "لا توجد رسائل بعد.";
  const unreadCount = Number(item.unread_count || item.unread || 0);
  const containerTone = active
    ? "border-cyan-300/50 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_18px_45px_rgba(8,145,178,0.16)]"
    : unreadCount || unseen || liveMeta
      ? "border-white/10 bg-slate-950/80 hover:border-cyan-300/25 hover:bg-white/[0.045]"
      : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-white/[0.045]";
  return (
    <button
      type="button"
      onClick={() => onSelect(item.session_id)}
      className={`w-full rounded-2xl border p-3 text-left transition duration-200 ${containerTone}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
          ) : (
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${liveMeta ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[0.07] text-slate-200"}`}>
              <User className="h-5 w-5" />
            </span>
          )}
          {unreadCount ? <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-slate-950 bg-rose-500" aria-hidden="true" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-black leading-5 text-white">{customerName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Pill tone={isWhatsappChannel(channel) ? "emerald" : liveMeta ? "cyan" : "zinc"}>{channelBadgeLabel(channel)}</Pill>
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-slate-500">{relativeTime(item.last_message_at || item.last_activity_at || item.updated_at)}</span>
          </div>
          <p dir={isRtlText(lastMessage) ? "rtl" : "auto"} className="mt-2 line-clamp-1 text-[13px] leading-5 text-slate-300">{lastMessage}</p>
          {unreadCount ? <div className="mt-2 flex justify-end"><span className="inline-flex h-5 items-center rounded-full bg-rose-400/12 px-2 text-[10px] font-black text-rose-100">Unread {unreadCount}</span></div> : null}
        </div>
      </div>
    </button>
  );
});

function InboxChatHeader({
  conversation,
  channelStatus = {},
  loading = false,
  onBack,
  onToggleAi,
  onAssign,
  onTakeover,
  onReturnToAi,
  onClose,
  onOpenTools,
  showBack = false,
}) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const avatarUrl = customerAvatarUrl(conversation);
  const name = customerDisplayName(conversation) || "عميل";
  const phone = clean(conversation.phone || conversation.customer_phone || conversation.external_customer_id || conversation.customer_profile?.phone);
  const channel = conversation.channel || conversation.source || "web_chat";
  const aiEnabled = isConversationAiEnabled(conversation) && status !== "closed";
  const aiLabel = aiEnabled && status !== "human_takeover" ? "AI Active" : "AI Paused";
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-2.5 shadow-[0_16px_50px_rgba(0,0,0,0.18)] backdrop-blur">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {showBack ? (
            <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-100 md:hidden">
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-slate-200"><User className="h-5 w-5" /></span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-lg font-black text-white">{name}</div>
              <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-black uppercase tracking-[0.14em] ${aiEnabled ? "bg-emerald-300/12 text-emerald-100" : "bg-amber-300/12 text-amber-100"}`}>{aiLabel}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <Pill tone={isWhatsappChannel(channel) ? "emerald" : "cyan"}>{channelBadgeLabel(channel)}</Pill>
              <span className="text-slate-700">/</span>
              <span dir="ltr" className="truncate">{phone || conversation.external_customer_id || conversation.session_id}</span>
              <span className="text-slate-700">/</span>
              <span>{channelLabel(channel)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onToggleAi?.()}
            disabled={loading}
            className={`inline-flex h-9 items-center gap-2 rounded-2xl px-3 text-[11px] font-black transition disabled:opacity-50 ${
              aiEnabled ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[0.06] text-slate-100"
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            AI {aiEnabled ? "ON" : "OFF"}
          </button>
          <button type="button" onClick={onOpenTools} className="inline-flex h-9 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-[11px] font-black text-slate-100">
            <MoreVertical className="h-3.5 w-3.5" />
            Tools
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone={status === "closed" ? "rose" : status === "human_takeover" ? "amber" : "emerald"}>
          {status === "closed" ? <LockKeyhole className="h-3 w-3" /> : status === "human_takeover" ? <PauseCircle className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          {status === "closed" ? "Closed" : status === "human_takeover" ? "Human takeover" : "AI active"}
        </Pill>
        <Pill tone={(channelStatus.live_operational || channelStatus.effective_enabled || channelStatus.messaging_active) ? "emerald" : "amber"}>
          <Radio className="h-3 w-3" />
          {(channelStatus.live_operational || channelStatus.effective_enabled || channelStatus.messaging_active) ? "Live channel" : "Channel standby"}
        </Pill>
        {conversation.unread_count ? <Pill tone="rose">غير مقروء {conversation.unread_count}</Pill> : null}
        {conversation.assigned_user_name || conversation.assigned_user?.name ? <Pill tone="zinc"><UserCheck className="h-3.5 w-3.5" />{conversation.assigned_user_name || conversation.assigned_user?.name}</Pill> : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {status === "closed" ? (
            <button type="button" onClick={onReturnToAi} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50">
              <PlayCircle className="h-4 w-4" />
              Reopen
            </button>
          ) : (
            <>
              <button type="button" onClick={onTakeover} disabled={loading || status === "human_takeover"} className="inline-flex h-9 items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50">
                <Handshake className="h-4 w-4" />
                Take over
              </button>
              <button type="button" onClick={onReturnToAi} disabled={loading || status !== "human_takeover"} className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50">
                <PlayCircle className="h-4 w-4" />
                Return to AI
              </button>
              <button type="button" onClick={onClose} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50">
                <LockKeyhole className="h-4 w-4" />
                Close
              </button>
            </>
          )}
          <button type="button" onClick={onAssign} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-slate-100">
            <UserPlus className="h-4 w-4" />
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

const Transcript = memo(function Transcript({ conversation, loadingOlder, onLoadOlder }) {
  const messages = uniqueMessages(conversation?.messages);
  const events = asArray(conversation?.system_events);
  if (!messages.length && !events.length) {
    return <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">No transcript yet.</div>;
  }

  const renderMedia = (message) => {
    const imageUrls = [
      message.image_url,
      message.media_url,
      message.attachment_url,
      message.file_url,
      message.preview_url,
      message.thumbnail_url,
    ].map(clean).filter(Boolean);
    if (!imageUrls.length) return null;
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {imageUrls.slice(0, 4).map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
            <img src={url} alt="Attachment" className="aspect-video w-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {conversation?.older_messages_available ? (
        <div className="flex justify-center">
          <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[10px] font-black text-slate-300 disabled:opacity-50">
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
            تحميل الرسائل الأقدم
          </button>
        </div>
      ) : null}
      {messages.map((message) => (
        <div key={messageKey(message)} className="space-y-2">
          {message.customer_message ? (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-3xl rounded-tl-sm border border-white/10 bg-white/[0.06] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                  <span>العميل</span>
                  <span>/</span>
                  <span>{channelLabel(message.channel || conversation.channel)}</span>
                  <span>/</span>
                  <span>{absoluteTime(message.created_at)}</span>
                </div>
                <LinkifiedText text={message.customer_message} className="mt-3 text-[16px] leading-8" />
                {renderMedia(message)}
              </div>
            </div>
          ) : null}
          {message.ai_answer ? (
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-3xl rounded-tr-sm border border-cyan-300/15 bg-cyan-300/10 p-5 shadow-[0_10px_30px_rgba(8,145,178,0.14)]">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">
                  <Bot className="h-3.5 w-3.5" />
                  <span>AI</span>
                  <span className="text-slate-500">{absoluteTime(message.created_at)}</span>
                  <span className="text-slate-500">conf {Number(message.confidence || 0).toFixed(2)}</span>
                </div>
                <LinkifiedText text={message.ai_answer} className="mt-3 text-[16px] leading-8" />
                <ProductCards products={message.suggested_products} />
                <VisualAttachmentsPreview attachments={message.visual_attachments} />
                {renderMedia(message)}
              </div>
            </div>
          ) : null}
          {message.staff_message ? (
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-3xl rounded-tr-sm border border-emerald-300/15 bg-emerald-400/10 p-5 shadow-[0_10px_30px_rgba(16,185,129,0.12)]">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-100">
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>Staff</span>
                  {message.staff_user_name ? <span className="text-slate-400">{message.staff_user_name}</span> : null}
                  <span className="text-slate-500">{absoluteTime(message.created_at)}</span>
                  {message.delivery_status ? <span className={message.delivery_status === "failed" ? "text-rose-200" : message.delivery_status === "sending" ? "text-amber-200" : "text-emerald-200"}>{message.delivery_status}</span> : null}
                </div>
                <LinkifiedText text={message.staff_message} className="mt-3 text-[16px] leading-8" />
                {renderMedia(message)}
                {message.delivery_error ? <p className="mt-2 text-xs font-bold text-rose-200">{message.delivery_error}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
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
            {status === "human_takeover" ? "AI paused" : status === "closed" ? "Closed" : "AI active"}
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

const quickReplies = [
  "المقاسات المتاحة؟",
  "فيه ألوان تانية؟",
  "ابعت لينك الطلب",
  "متاح دفع عند الاستلام؟",
];

function ManualReplyComposer({ conversation, value, onChange, onSend, onSaveDraft, loading }) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const canSendLive = conversation.live_sending_available === true;
  if (status === "closed") {
    return <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">المحادثة مغلقة. تم تعطيل الرد اليدوي.</div>;
  }
  const submit = () => {
    if (clean(value)) onSend();
  };
  return (
    <div className="sticky bottom-0 w-full rounded-2xl border border-white/10 bg-slate-950/95 p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur md:p-3">
      <SectionTitle
        icon={Send}
        title={canSendLive ? "Reply composer" : "Draft / internal note"}
        action={canSendLive ? <Pill tone="emerald"><Radio className="h-3.5 w-3.5" />Live send ready</Pill> : <Pill tone="amber">Live channel unavailable</Pill>}
      />
      {status !== "human_takeover" && canSendLive ? <div className="mb-2 rounded-xl border border-cyan-300/15 bg-cyan-300/8 p-1.5 text-[11px] font-bold text-cyan-100">Sending a staff reply will take over this conversation and pause AI automation.</div> : null}
      <div className="mb-1.5 flex max-h-14 flex-wrap gap-1.5 overflow-hidden">
        {quickReplies.slice(0, 3).map((reply) => (
          <button key={reply} type="button" onClick={() => onChange(reply)} className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-0.5 text-[10px] font-bold leading-5 text-slate-200 hover:border-cyan-300/30">{reply}</button>
        ))}
        <details className="group">
          <summary className="list-none cursor-pointer rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold leading-5 text-slate-400 hover:border-cyan-300/30">
            More
          </summary>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {quickReplies.slice(3).map((reply) => (
              <button key={reply} type="button" onClick={() => onChange(reply)} className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-0.5 text-[10px] font-bold leading-5 text-slate-200 hover:border-cyan-300/30">{reply}</button>
            ))}
          </div>
        </details>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-2 focus-within:border-cyan-300/40 sm:flex-row sm:items-end">
          <button type="button" title="Emoji picker coming soon" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.055] text-sm font-black text-slate-300">⋯</button>
          <textarea
            dir={isRtlText(value) ? "rtl" : "auto"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={canSendLive ? "اكتب رد للعميل..." : "Write an internal note. It will not be sent to Meta yet."}
            className="min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.25 text-[15px] font-bold leading-6 text-white outline-none placeholder:text-slate-600"
          />
          <button type="button" onClick={submit} disabled={loading || !clean(value) || !canSendLive} title="Send now through Meta" className="inline-flex h-8 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send now</button>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onSaveDraft} disabled={loading || !clean(value)} className="inline-flex h-7 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] px-2.5 text-[10px] font-black text-slate-100 disabled:opacity-50">Save draft</button>
          <button type="button" onClick={submit} disabled={loading || !clean(value) || !canSendLive} className="inline-flex h-7 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2.5 text-[10px] font-black text-cyan-100 disabled:opacity-50">Approve AI reply</button>
        </div>
      </div>
    </div>
  );
}

function AiSuggestedRepliesPanel({ conversation, suggestions, intent, confidence, loading, error, onGenerate, onUse, onSendSuggestion, onCopySuggestion, channelStatus = {} }) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const disabled = loading || status === "closed";
  const hasChannelSetup = Object.keys(channelStatus || {}).length > 0;
  const autoReplyEnabled = resolveChannelAutoReplyMode(channelStatus) !== "off";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <SectionTitle
            icon={Sparkles}
            title="AI Suggested Replies"
            action={intent ? <Pill tone="violet">{intent} / {Number(confidence || 0).toFixed(2)}</Pill> : null}
          />
          <p className="max-w-2xl text-sm leading-6 text-slate-400">2-3 short Egyptian Arabic options that you can copy, edit, or send live.</p>
        </div>
        <button type="button" onClick={onGenerate} disabled={disabled} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Regenerate
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Pill tone={autoReplyEnabled ? "emerald" : "amber"}>Auto reply {autoReplyEnabled ? "enabled" : "disabled"}</Pill>
        {!hasChannelSetup ? <Pill tone="amber">Channel setup needed</Pill> : null}
        {intent ? <Pill tone="zinc">Confidence {Number(confidence || 0).toFixed(2)}</Pill> : null}
      </div>
      {status === "closed" ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">Closed conversations cannot generate suggestions.</div> : null}
      {!hasChannelSetup ? <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">No channel settings row was found for this channel. Open AI Channels to finish setup before enabling live sends.</div> : null}
      {error ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
      {!suggestions.length && status !== "closed" && !error ? <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-slate-500">Generate a staff-only suggested reply. It stays separate from sent replies until you approve or edit it.</div> : null}
      {suggestions.length ? (
        <div className="grid gap-3 xl:grid-cols-3">
          {suggestions.map((suggestion, index) => (
            <div key={`${suggestion}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm leading-6 text-slate-100 transition hover:border-violet-300/30 hover:bg-violet-400/10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-violet-200">Suggestion {index + 1}</span>
                <Pill tone="zinc">Short reply</Pill>
              </div>
              <p dir={isRtlText(suggestion) ? "rtl" : "auto"} className="mt-3 text-[14px] leading-7 text-slate-50">{suggestion}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onCopySuggestion?.(suggestion)} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] text-[11px] font-black text-slate-100">
                  <Copy className="h-3.5 w-3.5" />Copy
                </button>
                <button type="button" onClick={() => onUse(suggestion)} className="h-9 rounded-xl border border-white/10 bg-white/[0.055] text-[11px] font-black text-slate-100">Edit before send</button>
                <button type="button" onClick={() => onSendSuggestion(suggestion)} disabled={disabled} className="h-9 rounded-xl border border-emerald-300/20 bg-emerald-400/10 text-[11px] font-black text-emerald-100 disabled:opacity-50">Send now</button>
                <button type="button" onClick={onGenerate} disabled={disabled} className="h-9 rounded-xl border border-violet-300/20 bg-violet-400/10 text-[11px] font-black text-violet-100 disabled:opacity-50">Regenerate</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
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
  const mode = text(channelStatus.auto_reply_mode || channelStatus.ai_mode || "").toLowerCase();
  if (["off", "suggest_only", "auto_reply_after_approval", "fully_automatic"].includes(mode)) return mode;
  return channelStatus.ai_replies_enabled === true ? "suggest_only" : "off";
};

const lastEnabledAutoReplyModeKey = (tenantId, channelKey) => `aiInbox:lastEnabledAutoReplyMode:${tenantId}:${channelKey}`;

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
                  <a href={product.product_url || (product.id ? `/shop/product/${product.id}` : "#")} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] px-2 text-[11px] font-black text-white">Open product</a>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No matched products yet. Refresh after the customer sends a model, color, size, or category.</div>}
    </div>
  );
}

function SalesCloserPanel({ plan = {}, products = [], conversation = {}, loading, onRefresh, onTakeover, onUseText, onCreateDraft, onPaymentAction }) {
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
    { key: "ask_size", label: "Ask for size", enabled: !intent.size, action: () => onUseText(intent.product_model ? `طھظ…ط§ظ…طŒ ط§ظ„ظ…طھظˆظپط± ط¹ظ„ظ‰ ${intent.product_model}طŒ طھظ‚ظˆظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ„ظٹ ظ…ط­طھط§ط¬ظ‡طں` : "طھظ…ط§ظ…طŒ طھظ‚ظˆظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ„ظٹ ظ…ط­طھط§ط¬ظ‡طں") },
    { key: "ask_product", label: "Ask for product clarification", enabled: !primary, action: () => onUseText("ظ…ظ…ظƒظ† طھط¨ط¹طھظ„ظٹ ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط£ظˆ طµظˆط±ط© ط£ظˆط¶ط­ ط¹ط´ط§ظ† ط£ط¬ظٹط¨ ظ„ظƒ ط§ظ„ط£ظ†ط³ط¨طں") },
    { key: "recommend_alternative", label: "Recommend alternative", enabled: Boolean(primary || products.length), action: () => onUseText(followup.alternative_message || "ظ„ظˆ ط§ظ„ظ…ظ‚ط§ط³ ط£ظˆ ط§ظ„ظ„ظˆظ† ط¯ظ‡ ط؛ظٹط± ظ…طھظˆظپط±طŒ ط£ظ‚ط¯ط± ط£ط±ط´ط­ ظ„ظƒ ط¨ط¯ظٹظ„ ظ‚ط±ظٹط¨ ط¬ط¯ظ‹ط§.") },
    { key: "escalate_human", label: "Escalate to human", enabled: true, action: onTakeover },
    { key: "draft_order", label: "Draft order", enabled: Boolean(primary), action: () => primary && onCreateDraft?.(primary, { reserve: false }) },
    { key: "reserve_stock", label: "Reserve stock", enabled: Boolean(primary), action: () => primary && onCreateDraft?.(primary, { reserve: true }) },
    { key: "payment_link", label: "Send payment link", enabled: true, action: () => onPaymentAction?.("payment_link") },
    { key: "follow_up", label: "Follow up", enabled: Boolean(followup.low_stock_message || followup.ten_minute_message), action: () => onUseText(followup.low_stock_message || followup.ten_minute_message || "ظ‡طھط§ط¨ط¹ ظ…ط¹ط§ظƒ ط£ظˆظ„ ظ…ط§ ظٹطھظˆظپط± ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ…ظ†ط§ط³ط¨.") },
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
              const Icon = action.key === "follow_up" ? Flame : action.key === "escalate_human" ? Handshake : action.key === "payment_link" ? CreditCard : action.key === "reserve_stock" ? PackageCheck : action.key === "draft_order" ? ShoppingCart : MessageSquareText;
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
                  <button type="button" onClick={() => onUseText(`${primary.name || primary.title}\n${money(primary.final_price || primary.price)}\n${primary.product_url || ""}`.trim())} className="mt-2 inline-flex h-8 items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100">Quick send card</button>
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

function CustomerContextCard({ conversation = {} }) {
  const messages = uniqueMessages(conversation?.messages);
  const latest = [...messages].reverse().find((message) => message.detected_intent || message.customer_message || message.ai_answer) || {};
  const profile = conversation?.customer_profile || {};
  const identityName = customerDisplayName(conversation) || "عميل غير معروف";
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
        {lastOrder ? <Pill tone="emerald">Last order {lastOrder.invoice_number || lastOrder.order_number || lastOrder.id}</Pill> : null}
      </div>
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
  const identityName = customerDisplayName(conversation);
  const avatarUrl = customerAvatarUrl(conversation);
  const hasMessengerProfile = Boolean(identityName || avatarUrl || clean(conversation?.external_customer_id));
  const crmLabel = profile.id ? `الملف المرتبط #${profile.id}` : hasMessengerProfile ? "ملف ماسنجر فقط" : "لا يوجد عميل CRM مطابق";
  const channel = conversation?.channel || conversation?.source || "web_chat";
  const channelName = channelLabel(channel);
  const phone = clean(profile.phone || conversation?.phone || conversation?.customer_phone || conversation?.external_customer_id);
  const cityArea = clean(profile.city_area || [profile.city, profile.area].filter(Boolean).join(" / "));
  const crmStateTone = profile.id ? "emerald" : hasMessengerProfile ? "cyan" : "amber";
  return (
    <aside className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
        <div className="flex flex-row-reverse items-start gap-3">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-slate-200">
              <User className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-black leading-5 text-white">{identityName || "عميل غير معروف"}</div>
                <div className="mt-1 text-[12px] font-bold leading-5 text-slate-400">
                  <span dir="ltr" className="block break-words">{phone || "لا يوجد رقم بعد"}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Pill tone={isWhatsappChannel(channel) ? "emerald" : "cyan"}>{channelName}</Pill>
                </div>
              </div>
              {canSyncMessenger ? (
                <button
                  type="button"
                  onClick={onSyncMessengerProfile}
                  disabled={syncing}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 text-[10px] font-black text-cyan-100 disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  مزامنة
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2.5">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2.5">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">CRM</div>
            <div className={`min-w-0 text-right text-[12px] font-black leading-5 ${crmStateTone === "emerald" ? "text-emerald-100" : crmStateTone === "cyan" ? "text-cyan-100" : "text-amber-100"}`}>{crmLabel}</div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2.5">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Channel</div>
            <div className="min-w-0 text-right text-[12px] font-black leading-5 text-white">{channelName}</div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2.5">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Phone</div>
            <div dir="ltr" className="min-w-0 text-right text-[12px] font-black leading-5 text-white">{phone || "No phone yet"}</div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2.5">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">المدينة</div>
            <div className="min-w-0 text-right text-[12px] font-black leading-5 text-white">{cityArea || "عميل غير معروف"}</div>
          </div>
        </div>
      </div>
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
        {state.state_reason ? <Pill tone="zinc">{state.state_reason}</Pill> : null}
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
                    <div className="font-black text-white">{customerDisplayName(conversation) || "Customer"}</div>
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
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const pageVisible = usePageVisible();
  const [filter, setFilter] = useState("all");
  const [leadFilter, setLeadFilter] = useState("all");
  const [leadSort, setLeadSort] = useState("recent");
  const [channelFilter, setChannelFilter] = useState("all");
  const [mobileView, setMobileView] = useState("list");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [inbox, setInbox] = useState({ conversations: [], followups: [] });
  const [drafts, setDrafts] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [channelStatus, setChannelStatus] = useState({});
  const [recommendations, setRecommendations] = useState({ sessionId: "", products: [], intelligence: null, loading: false });
  const [salesCloser, setSalesCloser] = useState({ sessionId: "", plan: {}, loading: false });
  const [aiReply, setAiReply] = useState({ sessionId: "", text: "", loading: false, error: "" });
  const [modeSaving, setModeSaving] = useState(false);
  const [unseenSessions, setUnseenSessions] = useState([]);
  const [toolsTab, setToolsTab] = useState("customer");
  const [profileOpen, setProfileOpen] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [assignNameDraft, setAssignNameDraft] = useState({ sessionId: "", value: "" });
  const [suggestedReplies, setSuggestedReplies] = useState({ sessionId: "", items: [], intent: "", confidence: 0, error: "" });
  const [aiDebug, setAiDebug] = useState({ sessionId: "", open: false, loading: false, data: null, error: "" });
  const [aiTrace, setAiTrace] = useState({ sessionId: "", open: false, loading: false, data: null, error: "" });
  const [suggesting, setSuggesting] = useState(false);
  const [profileSyncing, setProfileSyncing] = useState(false);
  const [profileDebugging, setProfileDebugging] = useState(false);
  const [resettingAiState, setResettingAiState] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ tone: "", text: "" });
  const pollIntervalRef = useRef(null);
  const requestSeqRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const selectedSessionIdRef = useRef("");
  const selectedConversationCacheRef = useRef(null);
  const lastEnabledAutoReplyModeRef = useRef({});

  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    const seq = ++requestSeqRef.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const [inboxPayload, draftsPayload, analyticsPayload, channelPayload] = await Promise.all([
        api.get("/ai-inbox/conversations", { params: { tenant_id: tenantId, filter, search: debouncedSearch, limit: 50, message_limit: 30 }, headers, perfComponent: "AiInbox.conversations" }),
        api.get("/ai-agent/orders/drafts", { params: { tenant_id: tenantId, limit: 50 }, headers, perfComponent: "AiInbox.drafts" }),
        api.get("/ai-agent/analytics", { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.analytics" }),
        api.get("/ai-agent/channels/status", { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.channels" }).catch(() => ({ channels: {} })),
      ]);
      if (seq !== requestSeqRef.current) return;
      const conversations = asArray(inboxPayload.conversations);
      const activeSelectedId = selectedSessionIdRef.current;
      const cachedSelected = selectedConversationCacheRef.current;
      const selectedStillPresent = activeSelectedId && conversations.some((item) => item.session_id === activeSelectedId);
      const nextConversations = !selectedStillPresent && activeSelectedId && cachedSelected?.session_id === activeSelectedId
        ? [cachedSelected, ...conversations.filter((item) => item.session_id !== activeSelectedId)]
        : conversations;
      setInbox({ conversations: nextConversations, followups: asArray(inboxPayload.followups) });
      setDrafts(asArray(draftsPayload.drafts));
      setAnalytics(analyticsPayload.analytics || {});
      setChannelStatus(channelPayload.channels || {});
      if (!activeSelectedId && nextConversations[0]?.session_id) {
        setSelectedSessionId(nextConversations[0].session_id);
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err?.message || "تعذر تحميل صندوق محادثات الذكاء الاصطناعي");
    } finally {
      if (seq === requestSeqRef.current && !silent) setLoading(false);
      if (seq === requestSeqRef.current) isRefreshingRef.current = false;
    }
  }, [debouncedSearch, filter, headers, tenantId]);

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
    if (!pageVisible) return undefined;
    pollIntervalRef.current = window.setInterval(() => {
      void loadAll({ silent: true });
    }, 15000);
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [loadAll, pageVisible]);

  useEffect(() => {
    const refresh = () => {
      if (pageVisible) void loadAll({ silent: true });
    };
    const onMessage = (payload = {}) => {
      const sessionId = payload.session_id || payload.message?.session_id || "";
      const incoming = payload.message || null;
      if (incoming?.sender_type === "customer" || incoming?.customer_message) {
        setToast({ tone: "cyan", text: "ردّ العميل" });
      }
      if (incoming?.id || incoming?.dedupe_key || incoming?.external_message_id) {
        let skipped = false;
        setInbox((current) => ({
          ...current,
          conversations: asArray(current.conversations).map((conversation) => {
            if (conversation.session_id !== sessionId) return conversation;
            const key = messageKey(incoming);
            if (asArray(conversation.messages).some((message) => messageKey(message) === key)) {
              skipped = true;
              return conversation;
            }
            return {
              ...conversation,
              messages: uniqueMessages([...asArray(conversation.messages), incoming]),
              message_count: Number(conversation.message_count || asArray(conversation.messages).length) + 1,
              latest_message_preview: incoming.customer_message || incoming.message_text || incoming.ai_answer || incoming.staff_message || conversation.latest_message_preview,
              last_activity_at: incoming.created_at || new Date().toISOString(),
            };
          }),
        }));
        if (skipped) console.debug("[meta-inbox] meta_socket_duplicate_skipped", { session_id: sessionId, message_key: messageKey(incoming) });
      }
      if (sessionId && sessionId !== selectedSessionId) {
        setUnseenSessions((current) => [...new Set([sessionId, ...current])].slice(0, 20));
      }
    };
    const offMessage = subscribeRealtime("ai_inbox:message", onMessage);
    const offRefresh = subscribeRealtime("ai_inbox:refresh", refresh);
    return () => {
      offMessage();
      offRefresh();
    };
  }, [loadAll, pageVisible, selectedSessionId]);

  useEffect(() => {
    if (!toast.text) return undefined;
    const timer = window.setTimeout(() => setToast({ tone: "", text: "" }), 3200);
    return () => window.clearTimeout(timer);
  }, [toast.text]);

  const conversations = asArray(inbox.conversations);
  const filteredConversations = useMemo(() => {
    const items = [...conversations];
    const matchesLeadFilter = (conversation = {}) => {
      const temperature = conversationLeadTemperature(conversation);
      if (leadFilter === "all") return true;
      if (leadFilter === "needs_human") return needsHumanAttention(conversation);
      return temperature === leadFilter;
    };
    const sortValue = (conversation = {}) => {
      const score = conversationLeadScore(conversation);
      const updatedAt = new Date(conversation.last_message_at || conversation.last_activity_at || conversation.updated_at || conversation.created_at || 0).getTime();
      return leadSort === "lead_score_desc"
        ? { primary: score, secondary: updatedAt }
        : { primary: updatedAt, secondary: score };
    };
    const matchesChannelFilter = (conversation = {}) => {
      if (channelFilter === "all") return true;
      return normalizeConversationChannel(conversation) === channelFilter;
    };
    const sorted = items.filter(matchesLeadFilter).filter(matchesChannelFilter).sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (right.primary !== left.primary) return right.primary - left.primary;
      if (right.secondary !== left.secondary) return right.secondary - left.secondary;
      return clean(b.session_id).localeCompare(clean(a.session_id));
    });
    return sorted;
  }, [channelFilter, conversations, leadFilter, leadSort]);
  const channelSummaries = useMemo(() => {
    const buckets = new Map();
    const totalUnread = conversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || conversation.unread || 0), 0);
    for (const conversation of conversations) {
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
      all: { key: "all", label: "All", count: conversations.length, unread: totalUnread, tone: "zinc" },
      channels: [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
  }, [conversations]);
  const fixedChannelSummaries = useMemo(() => {
    const byKey = new Map(channelSummaries.channels.map((item) => [item.key, item]));

    return fixedChannelOrder.map((key) => ({
      key,
      label: channelBadgeLabel(key),
      count: Number(byKey.get(key)?.count || 0),
      unread: Number(byKey.get(key)?.unread || 0),
      tone: byKey.get(key)?.tone || "zinc",
    }));
  }, [channelSummaries.channels]);
  const realMetaCount = conversations.filter((item) => item.is_live_meta || isMetaChannel(item.channel || item.source)).length;
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.session_id === selectedSessionId) ||
      (selectedConversationCacheRef.current?.session_id === selectedSessionId ? selectedConversationCacheRef.current : null) ||
      conversations[0] ||
      null,
    [conversations, selectedSessionId]
  );
  const handleSelectConversation = useCallback((sessionId) => {
    setSelectedSessionId(sessionId);
    setMobileView("chat");
    setReplyText("");
    setUnseenSessions((current) => current.filter((id) => id !== sessionId));
  }, []);
  useEffect(() => {
    if (selectedConversation?.session_id) {
      selectedConversationCacheRef.current = selectedConversation;
    }
  }, [selectedConversation]);
  const safeConversation = selectedConversation || {};
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
  const canViewAiDebug = useMemo(() => canViewAiDebugPanel(getCurrentUser?.() || {}), []);

  useEffect(() => {
    const channelKey = text(selectedConversation?.channel || selectedConversation?.source);
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
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/ai-debug"), {
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
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/ai-trace"), {
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

  const patchConversation = useCallback((sessionId, updater) => {
    setInbox((current) => ({
      ...current,
      conversations: asArray(current.conversations).map((conversation) => {
        if (conversation.session_id !== sessionId) return conversation;
        const next = updater(conversation);
        return { ...next, messages: uniqueMessages(next.messages) };
      }),
    }));
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversation?.session_id || olderMessagesLoading) return;
    const sessionId = selectedConversation.session_id;
    const before = selectedConversation.next_messages_before || selectedConversation.messages?.[0]?.created_at || "";
    if (!before) return;
    setOlderMessagesLoading(true);
    try {
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/messages"), {
        params: { tenant_id: tenantId, before, limit: 30 },
        headers,
        perfComponent: "AiInbox.messages.loadOlder",
      });
      patchConversation(sessionId, (conversation) => {
        const mergedMessages = uniqueMessages([...asArray(payload.messages), ...asArray(conversation.messages)]);
        return {
          ...conversation,
          messages: mergedMessages,
          message_count: payload.total ?? conversation.message_count,
          older_messages_available: Boolean(payload.has_more),
          next_messages_before: payload.next_before || mergedMessages[0]?.created_at || "",
        };
      });
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "تعذر تحميل الرسائل الأقدم" });
    } finally {
      setOlderMessagesLoading(false);
    }
  }, [headers, olderMessagesLoading, patchConversation, selectedConversation, tenantId]);

  const currentAssignName = assignNameDraft.sessionId === selectedConversation?.session_id
    ? assignNameDraft.value
    : selectedConversation?.assigned_user?.name || selectedConversation?.assigned_user_name || "";

  const updateAssignName = (value) => {
    setAssignNameDraft({ sessionId: selectedConversation?.session_id || "", value });
  };

  const currentSuggestions = suggestedReplies.sessionId === selectedConversation?.session_id
    ? suggestedReplies
    : { sessionId: selectedConversation?.session_id || "", items: [], intent: "", confidence: 0, error: "" };

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
    setLoading(true);
    setError("");
    try {
      if (action === "takeover") {
        await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/takeover"), { tenant_id: tenantId }, { headers });
      } else if (action === "return") {
        const payload = await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/return-to-ai"), { tenant_id: tenantId }, { headers });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.session_id, (conversation) => ({
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
        const payload = await api.post(aiAgentInboxEndpoint(selectedConversation?.session_id, "/reopen"), { tenant_id: tenantId }, { headers });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.session_id, (conversation) => ({
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
        const payload = await api.patch(aiAgentInboxEndpoint(selectedConversation?.session_id, "/assign"), { tenant_id: tenantId, assigned_user_name: currentAssignName }, { headers, perfComponent: "AiInbox.assign" });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          assigned_user_name: currentAssignName,
          assigned_user: currentAssignName ? { ...(conversation.assigned_user || {}), name: currentAssignName } : conversation.assigned_user,
        }));
      } else if (action === "close") {
        const payload = await api.patch(aiAgentInboxEndpoint(selectedConversation?.session_id, "/close"), { tenant_id: tenantId }, { headers, perfComponent: "AiInbox.close" });
        const returned = payload.conversation || {};
        patchConversation(selectedConversation?.session_id, (conversation) => ({
          ...conversation,
          ...returned,
          conversation_status: "closed",
          status: "closed",
          closed_at: returned.closed_at || new Date().toISOString(),
        }));
      }
      if (action === "takeover") await loadAll({ silent: true });
    } catch (err) {
      setError(err?.message || "تعذر تحديث المحادثة");
    } finally {
      setLoading(false);
    }
  };

  const syncMessengerProfile = async () => {
    if (!selectedConversation?.session_id || !canSyncMessengerProfile(selectedConversation)) return;
    const sessionId = selectedConversation.session_id;
    setProfileSyncing(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(sessionId, "/sync-messenger-profile"), {
        tenant_id: tenantId,
        external_customer_id: selectedConversation.external_customer_id || "",
      }, { headers, perfComponent: "AiInbox.syncMessengerProfile" });
      if (payload.conversation) {
        patchConversation(sessionId, (conversation) => ({
          ...conversation,
          ...payload.conversation,
          messages: asArray(payload.conversation.messages).length ? payload.conversation.messages : conversation.messages,
        }));
      } else {
        patchConversation(sessionId, (conversation) => ({
          ...conversation,
          customer_name: payload.customer_name || conversation.customer_name,
          customer_avatar_url: payload.customer_avatar_url || conversation.customer_avatar_url,
          customer_profile: {
            ...(conversation.customer_profile || {}),
            name: payload.customer_name || conversation.customer_profile?.name || "",
            avatar_url: payload.customer_avatar_url || conversation.customer_profile?.avatar_url || "",
            profile_pic_url: payload.customer_avatar_url || conversation.customer_profile?.profile_pic_url || "",
          },
        }));
      }
      setToast({ tone: "emerald", text: "Profile synced" });
      await loadAll({ silent: true });
    } catch (err) {
      setToast({ tone: "rose", text: "تعذر جلب ملف ماسنجر" });
      setError(err?.message || "تعذر جلب ملف ماسنجر");
    } finally {
      setProfileSyncing(false);
    }
  };

  const debugMessengerProfile = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation.session_id;
    setProfileDebugging(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(sessionId, "/debug-messenger-profile"), {
        tenant_id: tenantId,
        external_customer_id: selectedConversation.external_customer_id || "",
      }, { headers, perfComponent: "AiInbox.debugMessengerProfile" });
      console.log("[messenger-profile-debug]", payload);
      window.alert(JSON.stringify(payload, null, 2));
      patchConversation(sessionId, (conversation) => ({
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
      console.error("[messenger-profile-debug] failed", err);
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

  const persistDraftReply = async (message) => {
    const sessionId = selectedConversation?.session_id;
    if (!sessionId || !clean(message)) return;
    return api.post(aiInboxConversationEndpoint(sessionId, "/reply"), { tenant_id: tenantId, message }, { headers, perfComponent: "AiInbox.saveDraftReply" });
  };

  const sendManualReply = async (overrideText = "") => {
    const message = clean(overrideText || replyText);
    if (!selectedConversation?.session_id || !message) return;
    const sessionId = selectedConversation?.session_id;
    const now = new Date().toISOString();
    const optimistic = {
      id: `sending-${Date.now()}`,
      session_id: sessionId,
      customer_message: "",
      ai_answer: "",
      staff_message: message,
      sender_type: "staff",
      manual_message: true,
      staff_user_name: "Staff",
      delivery_status: "sending",
      created_at: now,
    };
    patchConversation(sessionId, (conversation) => ({
      ...conversation,
      messages: [...asArray(conversation.messages), optimistic],
      conversation_status: "human_takeover",
      status: "human_takeover",
      ai_paused: true,
      latest_message_preview: message,
      last_activity_at: now,
      updated_at: now,
    }));
    setReplyText("");
    setLoading(true);
    setError("");
    try {
      const payload = await api.post(aiInboxConversationEndpoint(sessionId, "/send"), { tenant_id: tenantId, message }, { headers, perfComponent: "AiInbox.sendManualReply" });
      setToast({ tone: "emerald", text: "Message sent" });
      if (payload.message) {
        patchConversation(sessionId, (conversation) => ({
          ...conversation,
          messages: uniqueMessages([...asArray(conversation.messages).filter((item) => item.id !== optimistic.id), payload.message]),
          latest_message_preview: message,
          last_activity_at: payload.message.created_at || now,
          updated_at: payload.message.created_at || now,
        }));
      }
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "فشل الإرسال" });
      setError(err?.message || "تعذر إرسال الرد اليدوي");
      patchConversation(sessionId, (conversation) => ({
        ...conversation,
      messages: asArray(conversation.messages).map((item) => item.id === optimistic.id ? { ...item, delivery_status: "failed", delivery_error: err?.message || "فشل الإرسال" } : item),
      }));
    } finally {
      setLoading(false);
    }
  };

  const saveDraftReply = async () => {
    const message = clean(replyText);
    if (!selectedConversation?.session_id || !message) return;
    setLoading(true);
    setError("");
    try {
      const payload = await persistDraftReply(message);
      setReplyText("");
      setToast({ tone: "emerald", text: "Draft saved" });
      if (payload?.message) {
        patchConversation(selectedConversation.session_id, (conversation) => ({
          ...conversation,
          messages: uniqueMessages([...asArray(conversation.messages), payload.message]),
          latest_message_preview: message,
          last_activity_at: payload.message.created_at || new Date().toISOString(),
        }));
      }
    } catch (err) {
      setToast({ tone: "rose", text: err?.message || "Save failed" });
      setError(err?.message || "تعذر حفظ المسودة");
    } finally {
      setLoading(false);
    }
  };

  const generateSuggestedReplies = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    setSuggesting(true);
    setSuggestedReplies({ sessionId, items: [], intent: "", confidence: 0, error: "" });
    try {
      const payload = await api.post(aiAgentInboxEndpoint(sessionId, "/suggest-reply"), { tenant_id: tenantId }, { headers, perfComponent: "AiInbox.suggestReply" });
      setSuggestedReplies({
        sessionId,
        items: asArray(payload.suggestions).filter(Boolean),
        intent: payload.suggested_intent || "",
        confidence: Number(payload.confidence || 0),
        error: "",
      });
    } catch (err) {
      setSuggestedReplies({
        sessionId,
        items: [],
        intent: "",
        confidence: 0,
        error: err?.message || "تعذر إنشاء الاقتراحات",
      });
    } finally {
      setSuggesting(false);
    }
  };

  const loadRecommendations = async () => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    setRecommendations((current) => ({ ...current, sessionId, loading: true }));
    try {
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/recommendations"), { params: { tenant_id: tenantId, limit: 8 }, headers, perfComponent: "AiInbox.recommendations" });
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
      const payload = await api.get(aiInboxConversationEndpoint(sessionId, "/sales-closer"), { params: { tenant_id: tenantId }, headers, perfComponent: "AiInbox.salesCloser" });
      setSalesCloser({ sessionId, plan: payload || {}, loading: false });
      if (payload?.products?.length) {
        setRecommendations({ sessionId, products: asArray(payload.products), loading: false });
      }
    } catch {
      setSalesCloser({ sessionId, plan: {}, loading: false });
    }
  };

  useEffect(() => {
    if (!selectedConversation?.session_id) return;
    void loadRecommendations();
    void loadSalesCloser();
  }, [selectedConversation?.session_id]);

  const generateAiReply = async ({ persist = false } = {}) => {
    if (!selectedConversation?.session_id) return;
    const sessionId = selectedConversation?.session_id;
    setAiReply({ sessionId, text: "", loading: true, error: "" });
    try {
      const payload = await api.post(aiInboxConversationEndpoint(sessionId, "/ai-reply"), { tenant_id: tenantId, persist }, { headers, perfComponent: "AiInbox.generateAiReply" });
      const textValue = payload.reply?.answer || "";
      window.setTimeout(() => {
        setAiReply({ sessionId, text: textValue, loading: false, error: "" });
        if (!persist) setReplyText(textValue);
      }, 450);
      if (persist && payload.message) {
        patchConversation(sessionId, (conversation) => ({
          ...conversation,
          messages: uniqueMessages([...asArray(conversation.messages), payload.message]),
          latest_message_preview: textValue || conversation.latest_message_preview,
          last_activity_at: payload.message.created_at || new Date().toISOString(),
        }));
      }
    } catch (err) {
      setAiReply({ sessionId, text: "", loading: false, error: err?.message || "تعذر إنشاء رد الذكاء الاصطناعي" });
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

  const toggleAiEnabled = useCallback(() => {
    if (!selectedConversation?.session_id) return;
    const nextEnabled = !isConversationAiEnabled(selectedConversation);
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await api.patch(aiInboxConversationEndpoint(selectedConversation.session_id, "/ai-enabled"), {
          tenant_id: tenantId,
          conversation_id: selectedConversation.session_id,
          external_id: selectedConversation.external_conversation_id || "",
          ai_enabled: nextEnabled,
          enabled: nextEnabled,
        }, { headers, perfComponent: "AiInbox.toggleConversationAi" });
        const returnedConversation = payload.conversation || {};
        patchConversation(selectedConversation.session_id, (conversation) => ({
          ...conversation,
          ...returnedConversation,
          ai_enabled: returnedConversation.ai_enabled !== undefined ? returnedConversation.ai_enabled : nextEnabled,
        }));
        setToast({ tone: "emerald", text: nextEnabled ? "تم تشغيل AI لهذه المحادثة" : "تم إيقاف AI لهذه المحادثة" });
      } catch (err) {
        setError(err?.message || "تعذر تحديث حالة الذكاء الاصطناعي للمحادثة");
      } finally {
        setLoading(false);
      }
    })();
  }, [headers, patchConversation, selectedConversation?.ai_enabled, selectedConversation?.external_conversation_id, selectedConversation?.session_id, tenantId]);

  const quickSendProduct = (product) => {
    const textValue = `${product.name || product.title}\n${money(product.final_price || product.price)}\n${product.product_url || ""}`.trim();
    setReplyText(textValue);
  };

  const createDraftFromProduct = async (product, options = {}) => {
    if (!selectedConversation?.session_id || !product) return;
    setError("");
    setLoading(true);
    try {
      const payload = await api.post(aiInboxConversationEndpoint(selectedConversation?.session_id, "/create-draft-order"), {
        tenant_id: tenantId,
        product_id: product.product_id || product.id,
        product,
        reserve: options.reserve !== false,
        reserve_minutes: options.reserve_minutes || 20,
      }, { headers });
      const paymentAction = asArray(payload.payment_actions).find((item) => item.key === "cash_on_delivery") || null;
      if (paymentAction?.message) setReplyText(paymentAction.message);
      setToast({ tone: "emerald", text: `Draft order ${payload.order?.invoice_number || payload.order?.id || ""} created` });
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
      setReplyText(`طھظ…ط§ظ…طŒ ط¯ظ‡ ظ„ظٹظ†ظƒ ط§ظ„ط¯ظپط¹ ظ„ظ„ط·ظ„ط¨ ${orderNumber}: ${draft.id ? `/orders/${draft.id}` : ""}`.trim());
      return;
    }
    setReplyText(`طھظ…ط§ظ…طŒ ظ…ظ…ظƒظ† ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…${total ? ` ط¨ط¥ط¬ظ…ط§ظ„ظٹ ${money(total)}` : ""}. ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظ„طھط£ظƒظٹط¯ ط§ظ„ط·ظ„ط¨.`);
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
      <AiTraceModal
        open={aiTrace.open}
        loading={aiTrace.loading}
        error={aiTrace.error}
        data={aiTrace.sessionId === selectedConversation?.session_id ? aiTrace.data : null}
        onRefresh={loadAiTrace}
        onClose={() => setAiTrace((current) => ({ ...current, open: false }))}
      />
      <div className="mx-auto flex h-[100dvh] max-w-[96rem] flex-col gap-2 overflow-hidden p-2 md:p-3">
        <section className="shrink-0 rounded-3xl border border-white/10 bg-white/[0.055] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">
                <Bot className="h-4 w-4" />
                صندوق محادثات الذكاء الاصطناعي
              </div>
              <div className="mt-1 text-xl font-black text-white">مركز قيادة المبيعات</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConsoleOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.07] px-3 text-xs font-black text-slate-100">
                <Brain className="h-4 w-4" />
                سجلات الذكاء الاصطناعي
              </button>
              <button type="button" onClick={loadAll} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                تحديث
              </button>
            </div>
          </div>
          {error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
        </section>

        <details className="shrink-0 rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">مؤشرات مركز المبيعات</div>
              <div className="mt-1 text-sm font-black text-white">مطوية افتراضيًا</div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black text-slate-200">
              <ChevronDown className="h-4 w-4" />
              توسيع
            </span>
          </summary>
          <div className="grid gap-3 border-t border-white/10 p-3 md:grid-cols-4">
            <Metric icon={Radio} label="محادثات ميتا الحية" value={realMetaCount} tone="emerald" />
            <Metric icon={MessageSquareText} label="كل المحادثات" value={conversations.length} tone="cyan" />
            <Metric icon={Clock3} label="غير المقروء / بانتظار" value={conversations.filter((item) => item.unread || item.needs_human_support).length} tone="amber" />
            <Metric icon={EyeOff} label="بيانات العرض مخفية" value="مفعل" tone="violet" />
          </div>
        </details>

        <section className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          <div className="hidden xl:block w-[72px] shrink-0">
            <InboxChannelSidebar
              channels={fixedChannelSummaries}
              allUnread={channelSummaries.all.unread}
              activeChannel={channelFilter}
              onSelectChannel={(value) => {
                setChannelFilter(value);
                setMobileView("list");
              }}
            />
          </div>

          <aside className={`flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)] md:w-[300px] md:max-w-[300px] ${mobileView === "chat" ? "hidden md:flex" : "flex"}`}>
            <div className="shrink-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <SectionTitle icon={MessageSquareText} title="المحادثات" action={<Pill tone="zinc">{filteredConversations.length} ظاهرة</Pill>} />
              </div>
              <div className="xl:hidden">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button type="button" onClick={() => setChannelFilter("all")} className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black ${channelFilter === "all" ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white"}`}>الكل</button>
                  {channelSummaries.channels.map((channel) => (
                    <button key={channel.key} type="button" onClick={() => setChannelFilter(channel.key)} className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black ${channelFilter === channel.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white"}`}>
                      {channel.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <label className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن العميل أو المعرّف الخارجي أو الهاتف أو الرسالة" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
                    <ArrowUpDown className="h-4 w-4 text-slate-500" />
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الترتيب</span>
                    <select value={leadSort} onChange={(event) => setLeadSort(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
                      <option value="recent">الأحدث</option>
                      <option value="lead_score_desc">أعلى درجة للعميل أولًا</option>
                    </select>
                  </label>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {filters.map((item) => (
                    <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={`h-9 shrink-0 rounded-xl px-3 text-[11px] font-black transition ${filter === item.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">مرشحات العملاء المحتملين</span>
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
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pr-1">
              {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
              {filteredConversations.length ? (
                <VirtualList
                  items={filteredConversations}
                  estimateSize={98}
                  className="h-full pr-1"
                  itemKey={(item) => item.session_id}
                  renderItem={(item) => (
                    <div className="pb-2">
                      <InboxConversationCard
                        item={item}
                        unseen={unseenSessions.includes(item.session_id)}
                        active={selectedConversation?.session_id === item.session_id}
                        onSelect={handleSelectConversation}
                      />
                    </div>
                  )}
                />
              ) : !loading ? <EmptyBlock text={leadFilter === "all" && filter === "all" ? "لا توجد رسائل Meta حقيقية بعد. بيانات العرض مخفية كي تبقى محادثات الويبهوك الحية واضحة." : "لا توجد محادثات حقيقية تطابق المرشحات المحددة."} /> : null}
            </div>
          </aside>

          <main className={`flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)] ${mobileView === "chat" ? "flex" : "hidden md:flex"}`}>
            {selectedConversation ? (
              <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <InboxChatHeader
                    conversation={selectedConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading || modeSaving}
                    onBack={() => setMobileView("list")}
                    onToggleAi={toggleAiEnabled}
                    onAssign={() => updateConversationAction("assign")}
                    onTakeover={() => updateConversationAction("takeover")}
                    onReturnToAi={() => updateConversationAction(selectedConversation.conversation_status === "closed" ? "reopen" : "return")}
                    onClose={() => updateConversationAction("close")}
                    onOpenTools={() => setToolsTab("customer")}
                    showBack
                  />
                  <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <Transcript conversation={selectedConversation} loadingOlder={olderMessagesLoading} onLoadOlder={loadOlderMessages} />
                    </div>
                    <div className="shrink-0 border-t border-white/10 bg-slate-950/70 p-3">
                      <ManualReplyComposer
                        conversation={{ ...safeConversation, live_sending_available: Boolean(selectedChannelStatus.effective_enabled) || isMetaChannel(safeConversation.channel || safeConversation.source) }}
                        value={replyText}
                        onChange={setReplyText}
                        onSend={() => sendManualReply()}
                        onSaveDraft={saveDraftReply}
                        loading={loading}
                      />
                    </div>
                  </div>
                </div>
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
            ) : (
              <EmptyBlock text="اختر محادثة لعرض سجلها." />
            )}
          </main>
        </section>
      </div>
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
          <Metric icon={Radio} label="محادثات Meta الحية" value={realMetaCount} tone="emerald" />
          <Metric icon={MessageSquareText} label="كل المحادثات" value={conversations.length} tone="cyan" />
          <Metric icon={Clock3} label="غير مقروء / بانتظار الرد" value={conversations.filter((item) => item.unread || item.needs_human_support).length} tone="amber" />
          <Metric icon={EyeOff} label="بيانات العرض مخفية" value="مفعّل" tone="violet" />
        </section>

        <section className="hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن العميل أو المعرف الخارجي أو الهاتف أو الرسالة" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
              <ArrowUpDown className="h-4 w-4 text-slate-500" />
              <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الترتيب</span>
              <select value={leadSort} onChange={(event) => setLeadSort(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
                <option value="recent">الأحدث</option>
                <option value="lead_score_desc">الأعلى في درجة العميل أولًا</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              {filters.map((item) => (
                <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={`h-10 shrink-0 rounded-xl px-3 text-xs font-black transition ${filter === item.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"}`}>{item.label}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">مرشحات العملاء المحتملين</span>
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

        <section dir="ltr" className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[228px_minmax(0,1fr)_300px]">
          {profileOpen ? (
            <aside className="hidden min-w-0 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-3 xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-15rem)] xl:flex-col xl:overflow-y-auto">
              <CustomerProfilePanel
                conversation={selectedConversation}
                canSyncMessenger={canSyncMessengerProfile(selectedConversation)}
                syncing={profileSyncing}
                onSyncMessengerProfile={syncMessengerProfile}
              />
            </aside>
          ) : null}

          <main className="min-w-0 space-y-3">
            <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
              {selectedConversation ? (
                <>
                  <InboxChatHeader
                    conversation={safeConversation}
                    channelStatus={selectedChannelStatus}
                    loading={loading}
                    onToggleAi={toggleAiEnabled}
                    onAssign={() => updateConversationAction("assign")}
                    onTakeover={() => updateConversationAction("takeover")}
                    onReturnToAi={() => updateConversationAction(selectedConversation.conversation_status === "closed" ? "reopen" : "return")}
                    onClose={() => updateConversationAction("close")}
                    onOpenTools={() => setProfileOpen(true)}
                  />

                  <div className="mt-2 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-2 text-[11px] sm:grid-cols-3">
                    <div><span className="text-slate-500">الويب هوك</span><div className={selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "سليم" : "فشل"}</div></div>
                    <div><span className="text-slate-500">Token</span><div className={selectedTokenActive ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedTokenActive ? "نشط" : "منتهي"}</div></div>
                    <div><span className="text-slate-500">Messaging</span><div className={selectedMessagingActive ? "font-black text-emerald-100" : "font-black text-slate-300"}>{selectedMessagingActive ? "نشط" : "غير نشط"}</div></div>
                    {safeConversation.escalation_reason || safeConversation.last_escalation_keyword ? (
                      <div className="sm:col-span-3">
                        <span className="text-slate-500">التصعيد</span>
                        <div className="font-black text-amber-100">
                          {safeConversation.escalation_reason || "يحتاج تدخلًا بشريًا"}
                          {safeConversation.last_escalation_keyword ? ` / ${safeConversation.last_escalation_keyword}` : ""}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-2 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/65 p-2.5 lg:grid-cols-4">
                    <Info label="درجة العميل المحتمل" value={conversationLeadScore(safeConversation)} />
                    <Info label="حرارة العميل" value={conversationLeadTemperature(safeConversation)} />
                    <Info label="الإجراء الموصى به" value={conversationRecommendedSalesAction(safeConversation)} />
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3 lg:col-span-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">أسباب العميل المحتمل</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {conversationLeadReasons(safeConversation).length ? conversationLeadReasons(safeConversation).map((reason) => <Pill key={reason} tone="zinc">{reason.replace(/_/g, " ")}</Pill>) : <span className="text-sm text-slate-500">لا توجد أسباب بعد</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
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

                  <details className="group mb-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">أدوات المطور</div>
                        <div className="mt-1 text-sm font-black text-white">تشخيص، مزامنة الملف، التتبعات، وإعادة الضبط</div>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-[11px] font-black text-slate-200">
                        <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                        تبديل
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
                              أثر الذكاء الاصطناعي
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={syncMessengerProfile}
                            disabled={profileSyncing}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                          >
                            {profileSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            مزامنة ملف ماسنجر
                          </button>
                          <button
                            type="button"
                            onClick={debugMessengerProfile}
                            disabled={profileDebugging}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50"
                          >
                            {profileDebugging ? <Loader2 className="h-4 w-4 animate-spin" /> : <InfoIcon className="h-4 w-4" />}
                            تشخيص ملف ماسنجر
                          </button>
                          <button
                            type="button"
                            onClick={resetAiState}
                            disabled={resettingAiState}
                            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50"
                          >
                            {resettingAiState ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            إعادة ضبط حالة الذكاء الاصطناعي
                          </button>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <button type="button" onClick={() => setProfileOpen((value) => !value)} className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-slate-100">
                          {profileOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                          {profileOpen ? "إخفاء الملف" : "إظهار الملف"}
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
                      <SectionTitle icon={Sparkles} title="محرك رد الذكاء الاصطناعي" action={aiReply.loading ? <Pill tone="cyan">جاري الكتابة...</Pill> : null} />
                      {aiReply.error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{aiReply.error}</div> : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => generateAiReply({ persist: false })} disabled={aiReply.loading || safeConversation.conversation_status === "closed"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">{aiReply.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}مسودة رد الذكاء الاصطناعي</button>
                        <button type="button" onClick={() => generateAiReply({ persist: true })} disabled={aiReply.loading || safeConversation.conversation_status !== "ai_active"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><Bot className="h-4 w-4" />حفظ رد الذكاء الاصطناعي</button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
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

                  <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)]">
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black leading-5">سجل المحادثة</h3>
                            <p className="text-[11px] leading-4.5 text-slate-400">تسلسل مباشر للرسائل وردود الموظفين وأحداث المحادثة.</p>
                          </div>
                          {selectedConversation?.messages?.length ? <Pill tone="zinc">{selectedConversation.messages.length} رسالة</Pill> : null}
                        </div>
                        <div className="max-h-[44rem] overflow-y-auto pr-1">
                          <Transcript conversation={selectedConversation} loadingOlder={olderMessagesLoading} onLoadOlder={loadOlderMessages} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
                        <AiSuggestedRepliesPanel
                          conversation={selectedConversation}
                          suggestions={currentSuggestions.items}
                          intent={currentSuggestions.intent}
                          confidence={currentSuggestions.confidence}
                          loading={suggesting}
                          error={currentSuggestions.error}
                          onGenerate={generateSuggestedReplies}
                          onUse={setReplyText}
                          onCopySuggestion={copySuggestedReply}
                          onSendSuggestion={sendManualReply}
                          channelStatus={selectedChannelStatus}
                        />
                      </div>
                      <ManualReplyComposer conversation={{ ...safeConversation, live_sending_available: Boolean(selectedChannelStatus.effective_enabled) || isMetaChannel(safeConversation.channel || safeConversation.source) }} value={replyText} onChange={setReplyText} onSend={() => sendManualReply()} onSaveDraft={saveDraftReply} loading={loading} />
                    </div>
                    <div className="space-y-3">
                      {selectedConversation?.draft_orders?.length ? <OrderDraftPanel conversation={selectedConversation} drafts={drafts} onAction={updateDraft} busy={loading} /> : null}
                    </div>
                  </div>
                </>
              ) : <EmptyBlock text="اختر محادثة لعرض سجلها." />}
            </div>
          </main>

          <aside className="hidden min-w-0 w-full shrink-0 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-3 xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100vh-15rem)] xl:w-[228px] xl:max-w-[228px] xl:flex-col xl:overflow-y-auto">
            <SectionTitle
              icon={MessageSquareText}
              title="قائمة المحادثات"
              action={<Pill tone="zinc">{filteredConversations.length} ظاهرة</Pill>}
            />
            {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
            <div className="block">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button type="button" onClick={() => setChannelFilter("all")} className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black ${channelFilter === "all" ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white"}`}>الكل</button>
                {channelSummaries.channels.map((channel) => (
                  <button key={channel.key} type="button" onClick={() => setChannelFilter(channel.key)} className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black ${channelFilter === channel.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white"}`}>
                    {channel.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <label className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن العميل أو المعرف الخارجي أو الهاتف أو الرسالة" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 h-10">
                  <ArrowUpDown className="h-4 w-4 text-slate-500" />
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">الترتيب</span>
                  <select value={leadSort} onChange={(event) => setLeadSort(event.target.value)} className="min-w-0 bg-transparent text-xs font-black text-white outline-none">
                    <option value="recent">الأحدث</option>
                    <option value="lead_score_desc">الأعلى في درجة العميل أولًا</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {filters.map((item) => (
                  <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={`h-9 shrink-0 rounded-xl px-3 text-[11px] font-black transition ${filter === item.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"}`}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">مرشحات العملاء المحتملين</span>
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
            <div className="min-h-0 flex-1 overflow-hidden pr-1">
              {loading && !conversations.length ? <LoadingBlock text="جارٍ تحميل المحادثات..." /> : null}
              {filteredConversations.length ? (
                <VirtualList
                  items={filteredConversations}
                  estimateSize={96}
                  className="h-full pr-1"
                  itemKey={(item) => item.session_id}
                  renderItem={(item) => (
                    <div className="pb-2">
                      <ConversationListItem
                        item={item}
                        unseen={unseenSessions.includes(item.session_id)}
                        active={selectedConversation?.session_id === item.session_id}
                        onSelect={handleSelectConversation}
                      />
                    </div>
                  )}
                />
              ) : !loading ? <EmptyBlock text={leadFilter === "all" && filter === "all" ? "لا توجد رسائل Meta حقيقية بعد. بيانات العرض مخفية كي تبقى محادثات الويبهوك الحية واضحة." : "لا توجد محادثات حقيقية تطابق المرشحات المحددة."} /> : null}
            </div>
          </aside>
        </section>
      </div>
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

