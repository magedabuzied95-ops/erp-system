import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  BadgePercent,
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
  MessageSquareText,
  PackageCheck,
  PauseCircle,
  PanelRightClose,
  PanelRightOpen,
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
import AISuggestedReplies from "../../../components/ai/AISuggestedReplies";
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
  { key: "all", label: "All" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "needs_human", label: "Needs human" },
  { key: "ai_replied", label: "AI replied" },
  { key: "unread", label: "Unread" },
];

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
  if (!value) return "No activity";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const absoluteTime = (value) => (value ? new Date(value).toLocaleString() : "");
const isMetaChannel = (value = "") => ["facebook_messenger", "instagram"].includes(clean(value).toLowerCase());
const isFacebookMessengerChannel = (value = "") => ["facebook_messenger", "facebook", "messenger"].includes(clean(value).toLowerCase());
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
  if (key === "facebook_messenger") return "Facebook Messenger";
  if (key === "instagram") return "Instagram DM";
  if (key === "whatsapp") return "WhatsApp";
  if (key === "web_chat") return "Web chat";
  return key || "Unknown channel";
};
const customerAvatarUrl = (item = {}) => {
  const source = item || {};
  return clean(source.customer_avatar_url || source.avatar_url || source.profile_pic_url || source.customer_profile?.avatar_url || source.customer_profile?.profile_pic_url || source.channel_metadata?.messenger_profile?.profile_pic);
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
                  <div className="mt-1 truncate text-xs font-black text-white">{item.title || "Product"}</div>
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
            {image ? <img src={image} alt={product.name || "Product"} className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-white/[0.055]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-white">{product.name || product.title || "Product"}</span>
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
  const customerName = clean(item.customer_name || item.first_name || item.phone || item.external_customer_id) || "Unknown customer";
  const avatarUrl = customerAvatarUrl(item);
  const lastMessage = item.latest_message_preview || item.last_message || item.customer_message || item.ai_answer || "No messages yet.";
  const mainStatus = item.conversation_status === "closed"
    ? { tone: "rose", label: "Closed", icon: LockKeyhole }
    : item.conversation_status === "human_takeover"
      ? { tone: "amber", label: "Human mode", icon: PauseCircle }
      : item.unread || unseen || item.needs_human_support
        ? { tone: "amber", label: "Waiting", icon: Clock3 }
        : liveMeta
          ? { tone: "emerald", label: "Live Meta", icon: Radio }
          : null;
  const MainStatusIcon = mainStatus?.icon;
  return (
    <button type="button" onClick={() => onSelect(item.session_id)} className={`w-full rounded-2xl p-4 text-left transition ${active ? "bg-cyan-300/10 ring-1 ring-cyan-300/35" : item.unread || unseen || liveMeta ? "bg-slate-950/85 ring-1 ring-cyan-300/15 hover:ring-cyan-300/30" : "bg-slate-950/65 ring-1 ring-white/10 hover:bg-white/[0.045] hover:ring-white/20"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-white/10" loading="lazy" />
            ) : (
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${liveMeta ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[0.07] text-slate-200"}`}><User className="h-4 w-4" /></span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-black text-white">{customerName}</span>
              <span className="block truncate text-xs font-bold text-slate-500">{channelLabel(channel)} / {item.external_customer_id || item.session_id}</span>
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs font-bold text-slate-500">{relativeTime(item.last_message_at || item.last_activity_at || item.updated_at)}</span>
      </div>
      <p dir={isRtlText(lastMessage) ? "rtl" : "auto"} className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">{lastMessage}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone={liveMeta ? "cyan" : "zinc"}>{channelLabel(channel)}</Pill>
        {mainStatus ? <Pill tone={mainStatus.tone}>{MainStatusIcon ? <MainStatusIcon className="h-3.5 w-3.5" /> : null}{mainStatus.label}</Pill> : null}
        {needsHumanAttention(item) ? <Pill tone="amber"><AlertTriangle className="h-3.5 w-3.5" />Needs human</Pill> : null}
      </div>
    </button>
  );
});

const Transcript = memo(function Transcript({ conversation, loadingOlder, onLoadOlder }) {
  const messages = uniqueMessages(conversation?.messages);
  const events = asArray(conversation?.system_events);
  if (!messages.length && !events.length) {
    return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">No transcript yet.</div>;
  }

  return (
    <div className="space-y-4">
      {conversation?.older_messages_available ? (
        <div className="flex justify-center">
          <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">
            {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
            Load older messages
          </button>
        </div>
      ) : null}
      {messages.map((message) => (
        <div key={messageKey(message)} className="space-y-2">
          {message.customer_message ? (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.06] p-3">
                <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Customer / {channelLabel(message.channel || conversation.channel)} / {absoluteTime(message.created_at)}</div>
                <LinkifiedText text={message.customer_message} className="mt-2" />
              </div>
            </div>
          ) : null}
          {message.ai_answer ? (
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-2xl rounded-tr-sm border border-cyan-300/15 bg-cyan-300/8 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-100">
                  <Bot className="h-3.5 w-3.5" />
                  AI
                  <span className="text-slate-500">{absoluteTime(message.created_at)}</span>
                  <span className="text-slate-500">confidence {Number(message.confidence || 0).toFixed(2)}</span>
                </div>
                <LinkifiedText text={message.ai_answer} className="mt-2" />
                <ProductCards products={message.suggested_products} />
                <VisualAttachmentsPreview attachments={message.visual_attachments} />
              </div>
            </div>
          ) : null}
          {message.staff_message ? (
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-2xl rounded-tr-sm border border-emerald-300/15 bg-emerald-400/10 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-100">
                  <UserCheck className="h-3.5 w-3.5" />
                  Staff
                  {message.staff_user_name ? <span className="text-slate-400">{message.staff_user_name}</span> : null}
                  <span className="text-slate-500">{absoluteTime(message.created_at)}</span>
                  {message.delivery_status ? <span className={message.delivery_status === "failed" ? "text-rose-200" : message.delivery_status === "sending" ? "text-amber-200" : "text-emerald-200"}>{message.delivery_status}</span> : null}
                </div>
                <LinkifiedText text={message.staff_message} className="mt-2" />
                {message.delivery_error ? <p className="mt-2 text-xs font-bold text-rose-200">{message.delivery_error}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {events.length ? (
        <div className="space-y-2">
          {events.map((event, index) => (
            <div key={`${event.type}-${event.order_id || index}`} className="mx-auto w-max max-w-full rounded-full border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-black text-slate-300">
              {event.label || event.type} / {absoluteTime(event.created_at)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function ConversationActions({ conversation, loading, assignName, onAssignNameChange, onAction }) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const assigned = conversation.assigned_user?.name || conversation.assigned_user_name || "Unassigned";
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={status === "human_takeover" ? "amber" : status === "closed" ? "rose" : "cyan"}>
            {status === "human_takeover" ? <PauseCircle className="h-3.5 w-3.5" /> : status === "closed" ? <LockKeyhole className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            {status === "human_takeover" ? "AI paused" : status === "closed" ? "Closed" : "AI active"}
          </Pill>
          <Pill tone="zinc"><UserCheck className="h-3.5 w-3.5" />Assigned: {assigned}</Pill>
          {conversation.takeover_started_at ? <Pill tone="amber">Taken over {relativeTime(conversation.takeover_started_at)}</Pill> : null}
          {conversation.closed_at ? <Pill tone="rose">Closed {relativeTime(conversation.closed_at)}</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "closed" ? (
            <button type="button" onClick={() => onAction("reopen")} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><PlayCircle className="h-4 w-4" />Reopen conversation</button>
          ) : (
            <>
              <button type="button" onClick={() => onAction("takeover")} disabled={loading || status === "human_takeover"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 text-xs font-black text-amber-100 disabled:opacity-50"><Handshake className="h-4 w-4" />Take over</button>
              <button type="button" onClick={() => onAction("return")} disabled={loading || status !== "human_takeover"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><PlayCircle className="h-4 w-4" />Return to AI</button>
              <button type="button" onClick={() => onAction("close")} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50"><LockKeyhole className="h-4 w-4" />Close</button>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input value={assignName} onChange={(event) => onAssignNameChange(event.target.value)} placeholder="Employee/admin name" disabled={loading || status === "closed"} className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 disabled:opacity-50" />
        <button type="button" onClick={() => onAction("assign")} disabled={loading || status === "closed" || !clean(assignName)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.07] px-4 text-sm font-black text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />Assign</button>
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
    return <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">Conversation closed. Manual replies are disabled.</div>;
  }
  const submit = () => {
    if (clean(value)) onSend();
  };
  return (
    <div className="sticky bottom-3 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
      <SectionTitle
        icon={Send}
        title={canSendLive ? "Reply composer" : "Draft / internal note"}
        action={canSendLive ? <Pill tone="emerald"><Radio className="h-3.5 w-3.5" />Live send ready</Pill> : <Pill tone="amber">Live channel unavailable</Pill>}
      />
      {status !== "human_takeover" && canSendLive ? <div className="mb-3 rounded-xl border border-cyan-300/15 bg-cyan-300/8 p-2 text-xs font-bold text-cyan-100">Sending a staff reply will take over this conversation and pause AI automation.</div> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        {quickReplies.map((reply) => (
          <button key={reply} type="button" onClick={() => onChange(reply)} className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-cyan-300/30">{reply}</button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-end gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-2 focus-within:border-cyan-300/40">
          <button type="button" title="Emoji picker coming soon" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.055] text-sm font-black text-slate-300">☺</button>
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
            rows={2}
            placeholder={canSendLive ? "اكتب رد للعميل..." : "Write an internal note. It will not be sent to Meta yet."}
            className="min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm font-bold leading-6 text-white outline-none placeholder:text-slate-600"
          />
          <button type="button" onClick={submit} disabled={loading || !clean(value) || !canSendLive} title="Send now through Meta" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send now</button>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onSaveDraft} disabled={loading || !clean(value)} className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">Save draft</button>
          <button type="button" onClick={submit} disabled={loading || !clean(value) || !canSendLive} className="inline-flex h-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50">Approve AI reply</button>
        </div>
      </div>
    </div>
  );
}

function AiSuggestedRepliesPanel({ conversation, suggestions, intent, confidence, loading, error, onGenerate, onUse, onSendSuggestion, channelStatus = {} }) {
  if (!conversation) return null;
  const status = conversation.conversation_status || conversation.status || "ai_active";
  const disabled = loading || status === "closed";
  const hasChannelSetup = Object.keys(channelStatus || {}).length > 0;
  const autoReplyEnabled = channelStatus.ai_replies_enabled === true;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle
          icon={Sparkles}
          title="AI Suggested Replies"
          action={intent ? <Pill tone="violet">{intent} / {Number(confidence || 0).toFixed(2)}</Pill> : null}
        />
        <button type="button" onClick={onGenerate} disabled={disabled} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate suggestions
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Pill tone={autoReplyEnabled ? "emerald" : "amber"}>Auto reply {autoReplyEnabled ? "enabled" : "disabled"}</Pill>
        {!hasChannelSetup ? <Pill tone="amber">Channel setup needed</Pill> : null}
      </div>
      {status === "closed" ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">Closed conversations cannot generate suggestions.</div> : null}
      {!hasChannelSetup ? <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">No channel settings row was found for this channel. Open AI Channels to finish setup before enabling live sends.</div> : null}
      {error ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
      {!suggestions.length && status !== "closed" && !error ? <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">Generate a staff-only suggested reply. It stays separate from sent replies until you approve or edit it.</div> : null}
      {suggestions.length ? (
        <div className="grid gap-2 lg:grid-cols-3">
          {suggestions.map((suggestion, index) => (
            <div key={`${suggestion}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-slate-100 transition hover:border-violet-300/30 hover:bg-violet-400/10">
              <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.14em] text-violet-200">Suggestion {index + 1}</span>
              <p dir={isRtlText(suggestion) ? "rtl" : "auto"}>{suggestion}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onUse(suggestion)} className="h-8 rounded-lg border border-white/10 bg-white/[0.055] text-[11px] font-black text-slate-100">Edit draft</button>
                <button type="button" onClick={() => onSendSuggestion(suggestion)} disabled={disabled} className="h-8 rounded-lg border border-emerald-300/20 bg-emerald-400/10 text-[11px] font-black text-emerald-100 disabled:opacity-50">Send</button>
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

function RecommendationsPanel({ products = [], loading, onRefresh, onQuickSend, onCreateDraft }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <SectionTitle
        icon={ShoppingBag}
        title="Matched products"
        action={<button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</button>}
      />
      {products.length ? (
        <div className="grid gap-2">
          {products.slice(0, 4).map((product) => (
            <div key={product.id || product.product_id} className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
              <div className="flex gap-3">
                {product.image_url ? <img src={product.image_url} alt={product.name || "Product"} className="h-16 w-16 rounded-lg object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-lg bg-white/[0.06]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{product.name || product.title || "Product"}</div>
                  <div className="mt-1 text-xs text-slate-400">{money(product.final_price || product.price)} / {product.stock_state || product.availability || "stock unknown"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{[product.size, product.color].filter(Boolean).join(" / ") || product.sku || "No variant details"}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => onQuickSend(product)} className="h-9 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 text-[11px] font-black text-cyan-100">Quick send</button>
                <button type="button" onClick={() => onCreateDraft(product)} className="h-9 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 text-[11px] font-black text-emerald-100">Draft order</button>
                <a href={product.product_url || "#"} className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.055] px-2 text-[11px] font-black text-white">Open</a>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No matched products yet. Refresh after the customer sends a model, color, size, or category.</div>}
    </div>
  );
}

function SalesCloserPanel({ plan = {}, products = [], conversation = {}, loading, onRefresh, onTakeover, onUseText }) {
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
      ? "Product context found. Suggest price or availability reply."
      : intent.size
        ? "Ask the customer for product name or photo."
        : "Ask for size before recommending stock.";
  const practicalActions = [
    { key: "ask_size", label: "Ask for size", enabled: !intent.size },
    { key: "ask_product", label: "Ask for product", enabled: !primary },
    { key: "recommend_alternative", label: "Recommend alternative", enabled: Boolean(primary || products.length) },
    { key: "escalate_human", label: "Escalate to human", enabled: true, action: onTakeover },
    { key: "follow_up", label: "Follow up", enabled: Boolean(followup.low_stock_message || followup.ten_minute_message), action: () => onUseText(followup.low_stock_message || followup.ten_minute_message || "") },
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
    <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <SectionTitle
        icon={Brain}
        title="AI Next Step"
        action={<button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Analyze</button>}
      />
      <div className="mb-3 rounded-2xl bg-cyan-300/10 p-4 ring-1 ring-cyan-300/20">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">Recommended next step</div>
        <p className="mt-2 text-sm font-black leading-6 text-white">{recommendedStep}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-950/65 p-3 ring-1 ring-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Pill tone={leadTone}>{(lead.label || "cold").toUpperCase()} lead</Pill>
              <span className="text-2xl font-black text-white">{Number(lead.score || 0)}%</span>
            </div>
            <div className="text-xs leading-5 text-slate-400">Purchase intent: <span className="font-black text-slate-100">{intent.purchase_intent || "unknown"}</span></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.length ? chips.map((chip) => <Pill key={chip} tone="zinc">{chip}</Pill>) : <span className="text-sm text-slate-500">Waiting for product, size, color, or buying signal.</span>}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {practicalActions.map((action) => (
              <button key={action.key} type="button" onClick={action.action || (() => {})} disabled={loading || action.enabled === false} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3 text-xs font-black text-slate-100 ring-1 ring-white/10 disabled:text-slate-500 disabled:opacity-60">
                {action.key === "follow_up" ? <Flame className="h-4 w-4" /> : action.key === "escalate_human" ? <Handshake className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
                {action.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {["Create order", "Reserve stock", "Payment link"].map((label) => (
              <div key={label} className="rounded-xl bg-slate-950/45 p-3 text-xs font-black text-slate-500 ring-1 ring-white/10">
                {label}
                <span className="mt-1 block text-[11px] font-bold text-slate-600">Coming soon</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {primary ? (
            <div className="rounded-xl bg-slate-950/65 p-3 ring-1 ring-white/10">
              <div className="flex gap-3">
                {primary.image_url ? <img src={primary.image_url} alt={primary.name || "Product"} className="h-20 w-20 rounded-lg object-cover" /> : <span className="grid h-20 w-20 place-items-center rounded-lg bg-white/[0.06]"><ShoppingBag className="h-5 w-5 text-slate-500" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{primary.name || primary.title || "Matched product"}</div>
                  <div className="mt-1 text-xs text-emerald-100">{money(primary.final_price || primary.price)} / {primary.stock_state || primary.availability || "stock unknown"}</div>
                  <div className="mt-1 text-xs text-slate-500">{[primary.size, primary.color].filter(Boolean).join(" / ") || primary.sku || "Variant selected during draft"}</div>
                  <button type="button" onClick={() => onUseText(`${primary.name || primary.title}\n${money(primary.final_price || primary.price)}\n${primary.product_url || ""}`.trim())} className="mt-2 inline-flex h-8 items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100">Quick send card</button>
                </div>
              </div>
            </div>
          ) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">No product match yet. Ask for model, category, size, color, or budget.</div>}
          {actions.length ? <div className="grid gap-2 sm:grid-cols-2">
            {actions.slice(0, 4).map((action) => (
              <div key={action.key} className="rounded-xl bg-slate-950/45 p-3 ring-1 ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-100">{action.label}</span>
                  <Pill tone={action.priority === "high" ? "rose" : action.priority === "low" ? "zinc" : "cyan"}>{action.priority || "normal"}</Pill>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{action.enabled === false ? "Needs more data" : "Suggested"}</div>
              </div>
            ))}
          </div> : null}
          <div className="rounded-xl bg-slate-950/45 p-3 ring-1 ring-white/10">
            <div className="mb-2 flex items-center gap-2 text-xs font-black text-slate-100"><BadgePercent className="h-4 w-4 text-amber-200" />Memory</div>
            <div className="flex flex-wrap gap-1.5">
              {memory.preferred_size ? <Pill tone="zinc">Size {memory.preferred_size}</Pill> : null}
              {asArray(memory.preferred_colors).slice(0, 3).map((item) => <Pill key={item} tone="zinc">{item}</Pill>)}
              {asArray(memory.favorite_models).slice(0, 3).map((item) => <Pill key={item} tone="zinc">{item}</Pill>)}
              {!memory.preferred_size && !asArray(memory.preferred_colors).length && !asArray(memory.favorite_models).length ? <span className="text-xs text-slate-500">Memory will improve as the conversation continues.</span> : null}
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
  const avatarUrl = customerAvatarUrl(conversation);
  const lastProduct = conversation?.current_product || conversation?.product || conversation?.channel_metadata?.current_product || conversation?.channel_metadata?.last_viewed_product || null;
  const lastSize = profile.preferred_size || conversation?.channel_metadata?.last_size || "";
  const escalation = clean(conversation?.escalation_reason || conversation?.ai_escalation_reason);

  return (
    <div className="mb-4 rounded-2xl bg-slate-950/55 p-4 ring-1 ring-white/10">
      <div className="mb-3 flex items-center gap-3">
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-12 w-12 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" /> : <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.07] text-slate-200"><User className="h-5 w-5" /></span>}
        <SectionTitle icon={User} title="Customer context" />
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
        <Info label="Customer" value={conversation?.customer_name || profile.name || conversation?.external_customer_id || "Unknown customer"} />
        <Info label="Phone / external ID" value={profile.phone || conversation?.phone || conversation?.external_customer_id || "No phone yet"} />
        <Info label="Channel" value={channelLabel(conversation?.channel || conversation?.source)} />
        <Info label="Last intent" value={latest.detected_intent || conversation?.detected_intent || "Unknown"} />
        <Info label="Last product" value={lastProduct?.name || lastProduct?.title || lastProduct?.product_name || "No product context"} />
        <Info label="Last size" value={lastSize || "Unknown"} />
      </div>
      {needsHumanAttention(conversation) ? (
        <div className="mt-3 rounded-xl bg-amber-400/10 p-3 text-sm font-bold text-amber-100 ring-1 ring-amber-300/20">
          Human mode active{escalation ? ` / ${escalation}` : ""}{conversation?.last_escalation_keyword ? ` / ${conversation.last_escalation_keyword}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function CustomerProfilePanel({ conversation, canSyncMessenger = false, syncing = false, onSyncMessengerProfile }) {
  const profile = conversation?.customer_profile || {};
  const avatarUrl = customerAvatarUrl(conversation);
  const viewed = asArray(profile.viewed_products);
  const abandoned = asArray(profile.abandoned_products);
  const previousOrders = asArray(profile.previous_orders);
  const notes = asArray(profile.memory_notes);
  return (
    <aside className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
        <div className="mb-3 flex items-center gap-3">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" /> : <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.07] text-slate-200"><User className="h-6 w-6" /></span>}
          <SectionTitle
            icon={User}
            title="Customer profile"
            action={canSyncMessenger ? (
              <button type="button" onClick={onSyncMessengerProfile} disabled={syncing} className="inline-flex h-8 items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 text-[11px] font-black text-cyan-100 disabled:opacity-50">
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync
              </button>
            ) : null}
          />
        </div>
        <div className="space-y-3">
          <Info label="Name" value={profile.name || "Anonymous"} />
          <Info label="Phone" value={profile.phone || "No phone yet"} />
          <Info label="CRM customer" value={profile.id ? `Linked profile #${profile.id}` : "No matched CRM customer"} />
          <Info label="City / area" value={profile.city_area || "Unknown customer"} />
          <Info label="Preferred size" value={profile.preferred_size || "Unknown"} />
          <TagRow label="Colors" values={profile.preferred_colors} />
          <TagRow label="Models" values={profile.preferred_models} />
          <Info label="Memory score" value={profile.memory_score ?? conversation?.lead_score ?? 0} />
        </div>
      </div>
      <MiniList title="Viewed products" items={viewed} empty="No viewed products." />
      <MiniList title="Abandoned products" items={abandoned} empty="No abandoned products." />
      <MiniList title="Previous orders" items={previousOrders} empty="No previous orders in memory." />
      <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
        <SectionTitle icon={MessageSquareText} title="Sentiment & memory" />
        <div className="mb-3 flex flex-wrap gap-2">
          <Pill tone={sentimentTone(profile.customer_sentiment)}>{profile.customer_sentiment || "neutral"}</Pill>
          {asArray(profile.sentiment_history).length ? <Pill tone="violet">{profile.sentiment_history.length} history</Pill> : null}
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {notes.length ? notes.slice(0, 12).map((note) => <div key={note.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">{note.key || note.type}: {JSON.stringify(note.value || {})}</div>) : <div className="text-sm text-slate-500">{profile.conversation_summary || "No memory notes yet."}</div>}
        </div>
      </div>
    </aside>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-white">{value || "Unknown"}</div>
    </div>
  );
}

function TagRow({ label, values = [] }) {
  const items = asArray(values).filter(Boolean);
  return (
    <div>
      <div className="mb-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.slice(0, 8).map((item) => <Pill key={item}>{item}</Pill>) : <span className="text-sm text-slate-500">Unknown</span>}
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
        )) : <div className="text-sm text-slate-500">{empty}</div>}
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
        <Info label="Product" value={item.product_name || metadata.product_name || "Unknown"} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Info label="Variant / size / color" value={item.variant_name || [metadata.size, metadata.color].filter(Boolean).join(" / ") || "Unknown"} />
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

export default function AiInbox() {
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const pageVisible = usePageVisible();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [inbox, setInbox] = useState({ conversations: [], followups: [] });
  const [drafts, setDrafts] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [channelStatus, setChannelStatus] = useState({});
  const [recommendations, setRecommendations] = useState({ sessionId: "", products: [], loading: false });
  const [salesCloser, setSalesCloser] = useState({ sessionId: "", plan: {}, loading: false });
  const [aiReply, setAiReply] = useState({ sessionId: "", text: "", loading: false, error: "" });
  const [modeSaving, setModeSaving] = useState(false);
  const [unseenSessions, setUnseenSessions] = useState([]);
  const [profileOpen, setProfileOpen] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [assignNameDraft, setAssignNameDraft] = useState({ sessionId: "", value: "" });
  const [suggestedReplies, setSuggestedReplies] = useState({ sessionId: "", items: [], intent: "", confidence: 0, error: "" });
  const [suggesting, setSuggesting] = useState(false);
  const [profileSyncing, setProfileSyncing] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ tone: "", text: "" });
  const pollIntervalRef = useRef(null);
  const requestSeqRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const selectedSessionIdRef = useRef("");
  const selectedConversationCacheRef = useRef(null);

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
      setError(err?.message || "Failed to load AI inbox");
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
        setToast({ tone: "cyan", text: "Customer replied" });
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
  const selectedAIStatus = needsHumanAttention(selectedConversation)
    ? { status: "HUMAN_MODE", label: "HUMAN MODE", color: "yellow" }
    : selectedConversation?.conversation_status === "closed"
      ? { status: "OFF", label: "AI OFF", color: "gray" }
      : selectedChannelStatus.ai_replies_enabled && selectedTokenActive && selectedMessagingActive
        ? { status: "LIVE", label: "AI LIVE", color: "green" }
        : selectedChannelStatus.aiStatus || { status: "OFF", label: "AI OFF", color: "gray" };

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
      setToast({ tone: "rose", text: err?.message || "Failed to load older messages" });
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
      setError(err?.message || "Failed to update draft");
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
        setToast({ tone: "emerald", text: "Conversation returned to AI. تم إرجاع المحادثة للذكاء الاصطناعي." });
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
        setToast({ tone: "emerald", text: "Conversation reopened and returned to AI." });
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
      setError(err?.message || "Failed to update conversation");
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
      setToast({ tone: "rose", text: "Could not fetch Messenger profile" });
      setError(err?.message || "Could not fetch Messenger profile");
    } finally {
      setProfileSyncing(false);
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
      setToast({ tone: "rose", text: err?.message || "Send failed" });
      setError(err?.message || "Failed to send manual reply");
      patchConversation(sessionId, (conversation) => ({
        ...conversation,
        messages: asArray(conversation.messages).map((item) => item.id === optimistic.id ? { ...item, delivery_status: "failed", delivery_error: err?.message || "Send failed" } : item),
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
      setError(err?.message || "Failed to save draft");
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
        error: err?.message || "Failed to generate suggestions",
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
      setRecommendations({ sessionId, products: asArray(payload.products), loading: false });
    } catch {
      setRecommendations({ sessionId, products: [], loading: false });
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
      setAiReply({ sessionId, text: "", loading: false, error: err?.message || "Failed to generate AI reply" });
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
      setError(err?.message || "Failed to update auto reply mode");
    } finally {
      setModeSaving(false);
    }
  };

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
      setError(err?.message || "Failed to create draft order");
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
      <div className="mx-auto flex max-w-[96rem] flex-col gap-5">
        <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur">
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

        <section className="grid gap-3 md:grid-cols-4">
          <Metric icon={Radio} label="Live Meta threads" value={realMetaCount} tone="emerald" />
          <Metric icon={MessageSquareText} label="All conversations" value={conversations.length} tone="cyan" />
          <Metric icon={Clock3} label="Unread / waiting" value={conversations.filter((item) => item.unread || item.needs_human_support).length} tone="amber" />
          <Metric icon={EyeOff} label="Demo data hidden" value="On" tone="violet" />
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, external ID, phone, or message" className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40" />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {filters.map((item) => (
              <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={`h-10 shrink-0 rounded-xl px-3 text-xs font-black transition ${filter === item.key ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"}`}>{item.label}</button>
            ))}
            </div>
          </div>
        </section>

        <section className={`grid gap-5 ${profileOpen ? "xl:grid-cols-[26rem_minmax(0,1fr)_20rem]" : "xl:grid-cols-[26rem_minmax(0,1fr)]"}`}>
          <aside className="space-y-3 xl:max-h-[calc(100vh-15rem)] xl:overflow-y-auto">
            <SectionTitle icon={MessageSquareText} title="Conversations list" />
            {loading && !conversations.length ? <LoadingBlock text="Loading conversations..." /> : null}
            {conversations.length ? (
              <VirtualList
                items={conversations}
                estimateSize={172}
                className="max-h-[calc(100vh-18rem)] overflow-y-auto pr-1"
                itemKey={(item) => item.session_id}
                renderItem={(item) => (
                  <div className="pb-3">
                    <ConversationListItem
                      item={item}
                      unseen={unseenSessions.includes(item.session_id)}
                      active={selectedConversation?.session_id === item.session_id}
                      onSelect={handleSelectConversation}
                    />
                  </div>
                )}
              />
            ) : !loading ? <EmptyBlock text={filter === "all" ? "No real Meta messages yet. Demo data is hidden so live webhook conversations stay clear." : "No real conversations match this filter."} /> : null}
          </aside>

          <main className="min-w-0 space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <SectionTitle
                icon={Bot}
                title="Conversation detail"
                action={selectedConversation ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {canSyncMessengerProfile(selectedConversation) ? (
                      <button
                        type="button"
                        onClick={syncMessengerProfile}
                        disabled={profileSyncing}
                        className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                      >
                        {profileSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Sync Messenger Profile
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setProfileOpen((value) => !value)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100">
                      {profileOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                      Profile
                    </button>
                  </div>
                ) : null}
              />
              {selectedConversation ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {customerAvatarUrl(safeConversation) ? (
                        <img src={customerAvatarUrl(safeConversation)} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" loading="lazy" />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-slate-200"><User className="h-5 w-5" /></span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xl font-black text-white">{safeConversation.customer_name || safeConversation.first_name || safeConversation.external_customer_id || "Unknown customer"}</div>
                        <div className="mt-1 truncate text-sm text-slate-500">{channelLabel(safeConversation.channel || safeConversation.source)} / {safeConversation.external_customer_id || safeConversation.session_id}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AIStatusBadge status={selectedAIStatus} />
                      {needsHumanAttention(selectedConversation) ? <Pill tone="amber"><AlertTriangle className="h-3.5 w-3.5" />Needs human</Pill> : null}
                    </div>
                  </div>
                  <CustomerContextCard conversation={safeConversation} />
                  <div className="mb-4 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-xs sm:grid-cols-3">
                    <div><span className="text-slate-500">Webhook</span><div className={selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedChannelStatus.webhook_healthy || safeConversation.last_webhook_event_at ? "Healthy" : "Failed"}</div></div>
                    <div><span className="text-slate-500">Token</span><div className={selectedTokenActive ? "font-black text-emerald-100" : "font-black text-rose-100"}>{selectedTokenActive ? "Active" : "Expired"}</div></div>
                    <div><span className="text-slate-500">Messaging</span><div className={selectedMessagingActive ? "font-black text-emerald-100" : "font-black text-slate-300"}>{selectedMessagingActive ? "Active" : "Inactive"}</div></div>
                    {safeConversation.escalation_reason || safeConversation.last_escalation_keyword ? (
                      <div className="sm:col-span-3">
                        <span className="text-slate-500">Escalation</span>
                        <div className="font-black text-amber-100">
                          {safeConversation.escalation_reason || "Needs human"}
                          {safeConversation.last_escalation_keyword ? ` / ${safeConversation.last_escalation_keyword}` : ""}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <ConversationActions conversation={selectedConversation} loading={loading} assignName={currentAssignName} onAssignNameChange={updateAssignName} onAction={updateConversationAction} />
                  <div className="mb-4 grid gap-3 lg:grid-cols-2">
                    <AutoReplyModePanel
                      channelStatus={selectedChannelStatus}
                      mode={selectedChannelStatus.auto_reply_mode || (selectedChannelStatus.ai_replies_enabled ? "fully_automatic" : "off")}
                      onChange={updateAutoReplyMode}
                      saving={modeSaving}
                    />
                    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <SectionTitle icon={Sparkles} title="AI reply engine" action={aiReply.loading ? <Pill tone="cyan">Typing...</Pill> : null} />
                      {aiReply.error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{aiReply.error}</div> : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => generateAiReply({ persist: false })} disabled={aiReply.loading || safeConversation.conversation_status === "closed"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">{aiReply.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Draft AI reply</button>
                        <button type="button" onClick={() => generateAiReply({ persist: true })} disabled={aiReply.loading || safeConversation.conversation_status !== "ai_active"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"><Bot className="h-4 w-4" />Save AI reply</button>
                      </div>
                    </div>
                  </div>
                  <div className="mb-4">
                    <SalesCloserPanel
                      plan={salesCloser.sessionId === safeConversation.session_id ? salesCloser.plan : {}}
                      products={recommendations.sessionId === safeConversation.session_id ? recommendations.products : []}
                      conversation={safeConversation}
                      loading={salesCloser.loading || loading}
                      onRefresh={loadSalesCloser}
                      onTakeover={() => updateConversationAction("takeover")}
                      onUseText={setReplyText}
                    />
                  </div>
                  <div className="mb-4">
                    <RecommendationsPanel
                      products={recommendations.sessionId === safeConversation.session_id ? recommendations.products : []}
                      loading={recommendations.loading}
                      onRefresh={loadRecommendations}
                      onQuickSend={quickSendProduct}
                      onCreateDraft={createDraftFromProduct}
                    />
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto pr-1">
                    <Transcript conversation={selectedConversation} loadingOlder={olderMessagesLoading} onLoadOlder={loadOlderMessages} />
                  </div>
                  <div className="mt-4 space-y-4">
                    <AISuggestedReplies
                      conversationId={selectedConversation?.session_id}
                      channelId={selectedConversation?.channel_id || selectedConversation?.channel || selectedConversation?.source}
                      platform={selectedConversation?.platform || selectedConversation?.channel || selectedConversation?.source}
                      lastCustomerMessage={lastCustomerMessage}
                      productId={selectedConversation?.product_id || selectedConversation?.matched_product_id}
                      onUseSuggestion={setReplyText}
                    />
                    <ManualReplyComposer conversation={{ ...safeConversation, live_sending_available: Boolean(selectedChannelStatus.effective_enabled) || isMetaChannel(safeConversation.channel || safeConversation.source) }} value={replyText} onChange={setReplyText} onSend={() => sendManualReply()} onSaveDraft={saveDraftReply} loading={loading} />
                  </div>
                </>
              ) : <EmptyBlock text="Select a conversation to inspect the transcript." />}
            </div>
            {selectedConversation?.draft_orders?.length ? <OrderDraftPanel conversation={selectedConversation} drafts={drafts} onAction={updateDraft} busy={loading} /> : null}
          </main>

          {profileOpen ? (
            <CustomerProfilePanel
              conversation={selectedConversation}
              canSyncMessenger={canSyncMessengerProfile(selectedConversation)}
              syncing={profileSyncing}
              onSyncMessengerProfile={syncMessengerProfile}
            />
          ) : null}
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
