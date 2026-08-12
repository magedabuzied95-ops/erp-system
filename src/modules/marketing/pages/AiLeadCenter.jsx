import { useEffect, useMemo, useState } from "react";
import { Bot, Clock3, Filter, Loader2, RefreshCw, Sparkles, Users2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import AiMarketingCenterNav from "../components/AiMarketingCenterNav";
import Customer360Drawer from "../../aiSupport/components/Customer360Drawer.jsx";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);

const PLATFORM_OPTIONS = [
  { key: "all", get label() { return tt("marketing.leadCenter.platforms.all"); }, tone: "zinc" },
  { key: "facebook", get label() { return tt("marketing.leadCenter.platforms.facebook"); }, tone: "cyan" },
  { key: "instagram", get label() { return tt("marketing.leadCenter.platforms.instagram"); }, tone: "rose" },
  { key: "messenger", get label() { return tt("marketing.leadCenter.platforms.messenger"); }, tone: "emerald" },
  { key: "web_chat", get label() { return tt("marketing.leadCenter.platforms.web_chat"); }, tone: "amber" },
];

const STAGE_OPTIONS = [
  { key: "all", get label() { return tt("marketing.leadCenter.stages.all"); }, tone: "zinc" },
  { key: "new_lead", get label() { return tt("marketing.leadCenter.stages.new_lead"); }, tone: "cyan" },
  { key: "waiting_reply", get label() { return tt("marketing.leadCenter.stages.waiting_reply"); }, tone: "amber" },
  { key: "ai_handling", get label() { return tt("marketing.leadCenter.stages.ai_handling"); }, tone: "emerald" },
  { key: "human_takeover", get label() { return tt("marketing.leadCenter.stages.human_takeover"); }, tone: "rose" },
  { key: "order_created", get label() { return tt("marketing.leadCenter.stages.order_created"); }, tone: "sky" },
  { key: "shipped", get label() { return tt("marketing.leadCenter.stages.shipped"); }, tone: "violet" },
  { key: "review_pending", get label() { return tt("marketing.leadCenter.stages.review_pending"); }, tone: "fuchsia" },
  { key: "upsell_opportunity", get label() { return tt("marketing.leadCenter.stages.upsell_opportunity"); }, tone: "lime" },
];

const statusToneClass = {
  zinc: "border-white/10 bg-white/[0.06] text-slate-200",
  cyan: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
  emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
  amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  sky: "border-sky-300/20 bg-sky-400/10 text-sky-100",
  violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
  fuchsia: "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100",
  lime: "border-lime-300/20 bg-lime-400/10 text-lime-100",
};

const clean = (value = "") => String(value || "").trim();
const safeArray = (value) => (Array.isArray(value) ? value : []);

const resolveTenantId = () => {
  const user = getCurrentUser();
  const tenant = getCurrentTenant();
  return String(user?.tenant_id || user?.tenantId || tenant?.id || tenant?.tenant_id || "").trim();
};

const isWithinToday = (value = "") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
};

const isWithinThisWeek = (value = "") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return date >= start;
};

const platformLabel = (platformKey = "") =>
  tt(`marketing.leadCenter.platforms.${PLATFORM_OPTIONS.some((entry) => entry.key === platformKey) && platformKey !== "all" ? platformKey : "web_chat"}`);

const platformKeyFrom = (value = "") => {
  const normalized = clean(value).toLowerCase();
  if (normalized.includes("facebook") && normalized.includes("comment")) return "facebook";
  if (normalized.includes("instagram") && normalized.includes("comment")) return "instagram";
  if (normalized.includes("facebook") && normalized.includes("messenger")) return "messenger";
  if (normalized.includes("facebook")) return "facebook";
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("messenger")) return "messenger";
  if (normalized.includes("web")) return "web_chat";
  return "web_chat";
};

const leadStageTone = (stageKey = "") => {
  const item = STAGE_OPTIONS.find((entry) => entry.key === stageKey) || STAGE_OPTIONS[0];
  return item.tone;
};

const confidencePercent = (conversation = {}) => {
  const leadScore = Number(conversation.lead_score || 0);
  if (Number.isFinite(leadScore) && leadScore > 0) {
    return Math.max(0, Math.min(100, leadScore <= 1 ? leadScore * 100 : leadScore));
  }
  const replyConfidence = Number(conversation.last_ai_reply_confidence_engine?.score || 0);
  if (Number.isFinite(replyConfidence) && replyConfidence > 0) return Math.max(0, Math.min(100, replyConfidence));
  const directConfidence = Number(conversation.confidence || 0);
  return Number.isFinite(directConfidence) ? Math.max(0, Math.min(100, directConfidence <= 1 ? directConfidence * 100 : directConfidence)) : 0;
};

const deriveLeadStage = (conversation = {}) => {
  const leadStatus = clean(conversation.lead_status || conversation.channel_metadata?.lead_status || conversation.metadata?.lead_status || "").toLowerCase();
  const status = clean(conversation.conversation_status || conversation.status || "").toLowerCase();
  const orderStatus = clean(conversation.order_status || conversation.payment_status || conversation.shipping_status || "").toLowerCase();
  const reviewPending = Boolean(conversation.review_pending === true || conversation.review_status === "pending" || conversation.needs_review === true);
  const hasOrder = Boolean(orderStatus || conversation.order_created_at || conversation.ai_order?.created_at || conversation.detected_intent === "order_draft_created");
  const hasShipping = Boolean(
    /ship|deliver/.test(orderStatus) ||
      conversation.shipped_at ||
      conversation.delivered_at ||
      conversation.order?.shipped_at ||
      conversation.order?.delivered_at
  );
  const takeover = conversation.human_takeover === true || conversation.ai_paused === true || status === "human_takeover" || conversation.needs_human_support === true;
  const aiHandling = conversation.ai_enabled !== false && !takeover && !hasOrder;
  const waitingReply = !takeover && !hasOrder && Boolean(conversation.unread_count || conversation.waiting === true || conversation.last_message_at);
  const upsell = Number(conversation.lead_score || conversation.confidence || 0) >= 80 || Boolean(conversation.upsell_opportunity === true || conversation.marked_for_upsell === true);
  if (reviewPending) return "review_pending";
  if (hasShipping) return "shipped";
  if (hasOrder) return "order_created";
  if (takeover) return "human_takeover";
  if (upsell) return "upsell_opportunity";
  if (aiHandling) return "ai_handling";
  if (waitingReply) return "waiting_reply";
  if (leadStatus === "contacted" || leadStatus === "interested" || leadStatus === "negotiation" || leadStatus === "won" || leadStatus === "lost") return leadStatus === "contacted" ? "waiting_reply" : "ai_handling";
  return "new_lead";
};

const leadStageLabel = (stageKey = "") => STAGE_OPTIONS.find((entry) => entry.key === stageKey)?.label || tt("marketing.leadCenter.stages.new_lead");

const getDisplayName = (conversation = {}) => {
  const profile = conversation.customer_profile || {};
  return clean(
    conversation.customer_name ||
      profile.name ||
      [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
      conversation.channel_metadata?.commenter_name ||
      conversation.metadata?.commenter_name ||
      conversation.sender_name ||
      conversation.external_customer_id ||
      conversation.phone ||
      ""
  );
};

const getSourcePost = (conversation = {}) =>
  clean(
    conversation.source_post_title ||
      conversation.source_post_name ||
      conversation.channel_metadata?.post_caption ||
      conversation.metadata?.post_caption ||
      conversation.metadata?.source_post ||
      conversation.external_comment_id ||
      conversation.comment_id ||
      conversation.external_message_id ||
      ""
  );

const getInterestedProduct = (conversation = {}) => {
  const firstCard = safeArray(conversation.product_cards)[0] || {};
  const firstSuggestion = safeArray(conversation.suggested_products)[0] || {};
  return clean(
    firstCard.name ||
      firstCard.title ||
      firstSuggestion.name ||
      firstSuggestion.title ||
      conversation.channel_metadata?.product_name ||
      conversation.metadata?.product_name ||
      conversation.metadata?.interested_product ||
      ""
  );
};

const getAssignment = (conversation = {}) => {
  const named = clean(conversation.assigned_user?.name || conversation.assigned_user_name);
  // A named assignee is user data and is never translated.
  if (named) return { key: "human", name: named, labelKey: "" };
  if (conversation.human_takeover === true || conversation.conversation_status === "human_takeover") {
    return { key: "human", name: "", labelKey: "assigned.humanTakeover" };
  }
  if (conversation.ai_enabled === false) return { key: "human", name: "", labelKey: "assigned.human" };
  return { key: "ai", name: "", labelKey: "assigned.ai" };
};

/** Display side of getAssignment(); resolved at render, never stored. */
const assignmentLabel = (assignment = {}) => assignment.name || tt(`marketing.leadCenter.${assignment.labelKey || "assigned.ai"}`);

const formatDateTime = (value = "") => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const buildTimeline = (conversation = {}) => {
  const sourceEvents = safeArray(conversation.system_events);
  const timeline = [
    { key: "comment", labelKey: "timeline.comment", icon: "💬", time: conversation.created_at || conversation.last_message_at || conversation.updated_at, active: true },
    { key: "ai_reply", labelKey: "timeline.ai_reply", icon: "🤖", time: conversation.last_ai_reply_at || conversation.ai_reply_at || conversation.updated_at, active: Boolean(conversation.last_ai_reply_at || conversation.ai_reply_at || conversation.ai_answer) },
    { key: "messenger", labelKey: "timeline.messenger", icon: "✉️", time: conversation.last_message_at || conversation.updated_at, active: true },
    { key: "order", labelKey: "timeline.order", icon: "🧾", time: conversation.order_created_at || conversation.ai_order?.created_at || conversation.order?.created_at, active: Boolean(conversation.order_created_at || conversation.ai_order?.created_at || conversation.order?.created_at) },
    { key: "payment", labelKey: "timeline.payment", icon: "💳", time: conversation.payment_received_at || conversation.order?.paid_at, active: Boolean(conversation.payment_received_at || conversation.order?.paid_at) },
    { key: "shipping", labelKey: "timeline.shipping", icon: "🚚", time: conversation.shipped_at || conversation.order?.shipped_at, active: Boolean(conversation.shipped_at || conversation.order?.shipped_at) },
    { key: "delivered", labelKey: "timeline.delivered", icon: "📦", time: conversation.delivered_at || conversation.order?.delivered_at, active: Boolean(conversation.delivered_at || conversation.order?.delivered_at) },
    { key: "review", labelKey: "timeline.review", icon: "⭐", time: conversation.review_pending_at || conversation.review_at, active: Boolean(conversation.review_pending === true || conversation.review_status === "pending" || conversation.review_pending_at || conversation.review_at) },
  ];
  if (sourceEvents.length) {
    sourceEvents.forEach((event) => {
      if (!event) return;
      const label = clean(event.label || event.type || "");
      if (!label) return;
      timeline.push({
        key: `${label}-${event.created_at || ""}`,
        label,
        icon: "•",
        time: event.created_at || event.timestamp || "",
        active: true,
      });
    });
  }
  return timeline.filter((item) => item.active || item.time);
};

const LeadStatCard = ({ label, value, tone = "zinc" }) => (
  <article className={`rounded-3xl border px-4 py-4 shadow-2xl shadow-black/20 ${statusToneClass[tone] || statusToneClass.zinc}`}>
    <div className="text-[11px] font-black uppercase tracking-[0.2em] opacity-80">{label}</div>
    <div className="mt-2 text-2xl font-black">{value}</div>
  </article>
);

const Pill = ({ tone = "zinc", children }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${statusToneClass[tone] || statusToneClass.zinc}`}>{children}</span>
);

export default function AiLeadCenter() {
  const navigate = useNavigate();
  const tenantId = useMemo(resolveTenantId, []);
  const headers = useMemo(() => (tenantId ? { "x-tenant-id": tenantId } : {}), [tenantId]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [leads, setLeads] = useState([]);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const { t } = useTranslation();
  const [assignedFilter, setAssignedFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [customerDrawer, setCustomerDrawer] = useState({ open: false, customer: null, customerId: "", context: {} });

  const openCustomerDrawer = (lead = {}) => {
    const conversation = lead.conversation || {};
    const customerProfile = conversation.customer_profile || {};
    const customerId = clean(conversation.customer_profile_id || conversation.customerProfileId || conversation.external_customer_id || customerProfile.id || conversation.id || lead.id || "");
    setCustomerDrawer({
      open: true,
      customerId,
      customer: {
        ...conversation,
        id: customerId,
        customer_name: clean(lead.customer || conversation.customer_name || customerProfile.name || customerProfile.display_name || ""),
        customer_avatar_url: clean(conversation.customer_avatar_url || customerProfile.avatar_url || customerProfile.profile_pic_url || ""),
        platform: clean(lead.platform || conversation.platform || conversation.channel || conversation.source || ""),
        customer_profile: customerProfile,
        external_customer_id: clean(conversation.external_customer_id || customerProfile.external_customer_id || ""),
      },
      context: {
        platform: clean(lead.platform || conversation.platform || conversation.channel || conversation.source || ""),
        summary: clean(lead.summary || conversation.latest_message_preview || conversation.summary || ""),
        lastActiveAt: clean(lead.updatedAt || conversation.last_message_at || conversation.last_activity_at || conversation.updated_at || ""),
        source: "lead_center",
        customerName: clean(lead.customer || conversation.customer_name || ""),
      },
    });
  };

  const loadLeads = async ({ silent = false } = {}) => {
    if (!tenantId) {
      setLeads([]);
      setError("AI Lead Center requires an active tenant.");
      if (!silent) setLoading(false);
      return [];
    }
    if (!silent) setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-inbox/conversations", {
        params: { tenant_id: tenantId, filter: "all", channel_filter: "", limit: 120, message_limit: 12 },
        headers,
      });
      const rows = Array.isArray(payload?.conversations)
        ? payload.conversations
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
            ? payload
            : [];
      const normalized = rows.map((conversation) => {
        const stage = deriveLeadStage(conversation);
        const platform = platformKeyFrom(conversation.channel || conversation.source || conversation.provider || conversation.platform || "");
        const timeline = buildTimeline(conversation);
        return {
          id: conversation.conversation_key || conversation.session_id || conversation.id,
          customer: getDisplayName(conversation),
          platform,
          sourcePost: getSourcePost(conversation),
          interestedProduct: getInterestedProduct(conversation),
          currentStage: stage,
          stageTone: leadStageTone(stage),
          assignment: getAssignment(conversation),
          confidence: confidencePercent(conversation),
          updatedAt: conversation.last_message_at || conversation.updated_at || conversation.created_at || "",
          unreadCount: Number(conversation.unread_count || conversation.unread || 0),
          summary: clean(conversation.latest_message_preview || conversation.last_message || conversation.preview_message || ""),
          leadStatus: clean(conversation.lead_status || conversation.channel_metadata?.lead_status || conversation.metadata?.lead_status || ""),
          timeline,
          conversation,
        };
      });
      setLeads(normalized);
      if (!selectedLeadId && normalized[0]?.id) {
        setSelectedLeadId(normalized[0].id);
      }
      return normalized;
    } catch (loadError) {
      setError(loadError?.message || tt("marketing.leadCenter.loadFailed"));
      setLeads([]);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadLeads();
  }, [tenantId]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (platformFilter !== "all" && lead.platform !== platformFilter) return false;
      if (stageFilter !== "all" && lead.currentStage !== stageFilter) return false;
      if (assignedFilter !== "all") {
        // Filters on the RAW assignment key, never on the display label.
        if (assignedFilter !== lead.assignment.key) return false;
      }
      if (timeFilter === "today" && !isWithinToday(lead.updatedAt)) return false;
      if (timeFilter === "week" && !isWithinThisWeek(lead.updatedAt)) return false;
      return true;
    });
  }, [assignedFilter, leads, platformFilter, stageFilter, timeFilter]);

  const selectedLead = useMemo(
    () => filteredLeads.find((lead) => String(lead.id) === String(selectedLeadId)) || filteredLeads[0] || null,
    [filteredLeads, selectedLeadId]
  );

  useEffect(() => {
    if (selectedLead?.id) setSelectedLeadId(selectedLead.id);
  }, [selectedLead?.id]);

  const counts = useMemo(() => {
    const seed = {
      new_lead: 0,
      waiting_reply: 0,
      ai_handling: 0,
      human_takeover: 0,
      order_created: 0,
      shipped: 0,
      review_pending: 0,
      upsell_opportunity: 0,
    };
    leads.forEach((lead) => {
      if (seed[lead.currentStage] !== undefined) seed[lead.currentStage] += 1;
    });
    return seed;
  }, [leads]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadLeads({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  const summaryCards = [
    { key: "new_lead", value: counts.new_lead, tone: "cyan" },
    { key: "waiting_reply", value: counts.waiting_reply, tone: "amber" },
    { key: "ai_handling", value: counts.ai_handling, tone: "emerald" },
    { key: "human_takeover", value: counts.human_takeover, tone: "rose" },
    { key: "order_created", value: counts.order_created, tone: "sky" },
    { key: "shipped", value: counts.shipped, tone: "violet" },
    { key: "review_pending", value: counts.review_pending, tone: "fuchsia" },
    { key: "upsell_opportunity", value: counts.upsell_opportunity, tone: "lime" },
  ].map((card) => ({ ...card, label: t(`marketing.leadCenter.stages.${card.key}`) }));

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.15),_transparent_32%),linear-gradient(180deg,#07111f_0%,#050816_100%)] px-4 py-4 text-white md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AiMarketingCenterNav />

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-primary">
                <Bot className="h-4 w-4" />
                {t("marketing.leadCenter.brand")}
              </div>
              <h1 className="m1-display mt-3">{t("marketing.leadCenter.title")}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {t("marketing.leadCenter.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading || refreshing}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("marketing.leadCenter.refresh")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/ai-inbox")}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-primary"
              >
                <Users2 className="h-4 w-4" />
                {t("marketing.leadCenter.openInbox")}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">{error}</div> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          {summaryCards.map((card) => (
            <LeadStatCard key={card.key} label={card.label} value={card.value} tone={card.tone} />
          ))}
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <span className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">{t("marketing.leadCenter.filters.title")}</span>
              <div className="h-6 w-px bg-white/10" />
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setPlatformFilter(option.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${ platformFilter === option.key ? statusToneClass[option.tone] : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]" }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {STAGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStageFilter(option.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${ stageFilter === option.key ? statusToneClass[option.tone] : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]" }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAssignedFilter("all")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${assignedFilter === "all" ? statusToneClass.zinc : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.assigned.label", { value: t("marketing.leadCenter.assigned.all") })}
            </button>
            <button
              type="button"
              onClick={() => setAssignedFilter("ai")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${assignedFilter === "ai" ? statusToneClass.emerald : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.assigned.label", { value: t("marketing.leadCenter.assigned.ai") })}
            </button>
            <button
              type="button"
              onClick={() => setAssignedFilter("human")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${assignedFilter === "human" ? statusToneClass.rose : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.assigned.label", { value: t("marketing.leadCenter.assigned.human") })}
            </button>
            <div className="mx-1 hidden h-5 w-px bg-white/10 md:block" />
            <button
              type="button"
              onClick={() => setTimeFilter("all")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${timeFilter === "all" ? statusToneClass.zinc : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.time.all")}
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter("today")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${timeFilter === "today" ? statusToneClass.cyan : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.time.today")}
            </button>
            <button
              type="button"
              onClick={() => setTimeFilter("week")}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${timeFilter === "week" ? statusToneClass.cyan : "border-white/10 bg-white/[0.04] text-slate-300"}`}
            >
              {t("marketing.leadCenter.time.week")}
            </button>
          </div>
        </section>

        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
          <section className="min-w-0 space-y-3">
            {loading ? (
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center text-sm text-slate-400">{t("marketing.leadCenter.list.loading")}</div>
            ) : filteredLeads.length === 0 ? (
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] text-slate-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="text-lg font-black text-white">{t("marketing.leadCenter.list.emptyTitle")}</div>
                <div className="mt-1 text-sm text-slate-400">{t("marketing.leadCenter.list.emptyHint")}</div>
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const active = String(lead.id) === String(selectedLeadId);
                return (
                  <article
                    key={lead.id}
                    className={[
                      "min-w-0 overflow-hidden rounded-[2rem] border p-4 shadow-2xl shadow-black/15 transition",
                      active ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <button type="button" onClick={() => setSelectedLeadId(lead.id)} className="block w-full min-w-0 text-start">
                      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-black text-white">{lead.customer || t("marketing.leadCenter.fallback.customer")}</div>
                            <Pill tone={lead.stageTone}>{leadStageLabel(lead.currentStage)}</Pill>
                            <Pill tone={lead.platform === "instagram" ? "rose" : lead.platform === "facebook" ? "cyan" : lead.platform === "messenger" ? "emerald" : "amber"}>{platformLabel(lead.platform)}</Pill>
                          </div>
                          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.customer")}</div>
                              <div className="mt-1 truncate text-sm font-semibold text-white">{lead.customer || t("marketing.leadCenter.fallback.customer")}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.platform")}</div>
                              <div className="mt-1 truncate text-sm font-semibold text-white">{platformLabel(lead.platform)}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.sourcePost")}</div>
                              <div dir="auto" className="mt-1 line-clamp-2 break-words text-sm font-semibold text-white [overflow-wrap:anywhere]">{lead.sourcePost || t("marketing.leadCenter.fallback.sourcePost")}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.interestedProduct")}</div>
                              <div dir="auto" className="mt-1 line-clamp-2 break-words text-sm font-semibold text-white [overflow-wrap:anywhere]">{lead.interestedProduct || t("marketing.leadCenter.fallback.interestedProduct")}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.currentStage")}</div>
                              <div className="mt-1 text-sm font-semibold text-white">{leadStageLabel(lead.currentStage)}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.assignedAi")}</div>
                              <div className="mt-1 text-sm font-semibold text-white">{assignmentLabel(lead.assignment)}</div>
                            </div>
                          </div>
                        </div>
                        <div className="flex w-full min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-3 2xl:w-72 2xl:shrink-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.confidence")}</div>
                            <div className="text-sm font-black text-white">{Math.round(lead.confidence)}%</div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary via-emerald-400 to-lime-400" style={{ width: `${Math.max(0, Math.min(100, lead.confidence))}%` }} />
                          </div>
                          <div dir="auto" className="min-w-0 break-words text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">
                            {lead.summary || t("marketing.leadCenter.fallback.summary")}
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="inline-flex min-w-0 items-center gap-1"><Clock3 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{formatDateTime(lead.updatedAt)}</span></span>
                            {lead.unreadCount ? <span className="rounded-full border border-rose-300/20 bg-rose-400/10 px-2 py-1 font-black text-rose-100">{t("marketing.leadCenter.fields.unread", { count: lead.unreadCount })}</span> : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  </article>
                );
              })
            )}
          </section>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
            <section className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-4 shadow-2xl shadow-black/15">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black uppercase tracking-[0.18em] text-primary">{t("marketing.leadCenter.detail.title")}</div>
                  <div className="text-xs text-slate-400">{t("marketing.leadCenter.detail.subtitle")}</div>
                </div>
                {selectedLead ? <Pill tone={selectedLead.stageTone}>{leadStageLabel(selectedLead.currentStage)}</Pill> : null}
              </div>

              {selectedLead ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <button type="button" onClick={() => openCustomerDrawer(selectedLead)} className="text-left text-lg font-black text-white hover:underline">
                      {selectedLead.customer || t("marketing.leadCenter.fallback.customer")}
                    </button>
                    <div className="mt-1 text-sm text-slate-400">{platformLabel(selectedLead.platform)} · {assignmentLabel(selectedLead.assignment)}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.sourcePost")}</div>
                      <div dir="auto" className="mt-1 break-words text-sm font-semibold text-white [overflow-wrap:anywhere]">{selectedLead.sourcePost || t("marketing.leadCenter.fallback.sourcePost")}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.fields.interestedProduct")}</div>
                      <div dir="auto" className="mt-1 break-words text-sm font-semibold text-white [overflow-wrap:anywhere]">{selectedLead.interestedProduct || t("marketing.leadCenter.fallback.interestedProduct")}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t("marketing.leadCenter.detail.timeline")}</div>
                      <div className="text-[10px] text-slate-500">{t("marketing.leadCenter.detail.events", { count: selectedLead.timeline.length })}</div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedLead.timeline.map((item) => (
                        <div key={item.key} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-white/5 bg-white/[0.03] px-3 py-2">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm">
                            {item.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-bold text-white">{item.labelKey ? t(`marketing.leadCenter.${item.labelKey}`) : item.label}</div>
                              <div className="text-[11px] text-slate-500">{formatDateTime(item.time)}</div>
                            </div>
                            <div className="text-xs text-slate-400">{item.active ? t("marketing.leadCenter.timeline.captured") : t("marketing.leadCenter.timeline.pending")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-slate-400">
                  {t("marketing.leadCenter.detail.empty")}
                </div>
              )}
            </section>
          </aside>
        </div>
        <Customer360Drawer
          open={customerDrawer.open}
          onClose={() => setCustomerDrawer((current) => ({ ...current, open: false }))}
          customer={customerDrawer.customer}
          customerId={customerDrawer.customerId}
          context={customerDrawer.context}
          title={t("marketing.leadCenter.detail.customer360")}
        />
      </div>
    </div>
  );
}
