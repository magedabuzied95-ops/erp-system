import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Sparkles,
  Bot,
  MessageSquare,
  CalendarClock,
  Share2,
  LineChart,
  Settings2,
  BookOpen,
  ShieldCheck,
  Megaphone,
  Video,
  Users,
  Activity,
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser, isAdminUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";
import { hasPermission } from "../../permissions/lib/rbacStore";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { getInboundAiMode, setInboundAiMode, getInboundIntakeStats, getInboundAiChannels, setInboundAiChannel, getStyleProfile, setStyleLearning, resetStyleLearning } from "../services/aiStudioApi";

// Phase 10/11 — Inbound Assisted Replies control (default OFF). AI drafts a grounded reply SUGGESTION for
// inbound WhatsApp/Messenger/Instagram text; a human approves/edits/sends from the existing AI Inbox.
// There is NO autonomous reply. Phase 11 adds per-channel staged rollout + real operational metrics.
function InboundAssistedRepliesCard() {
  const { headers } = useStudioHeaders();
  const [mode, setMode] = useState("off");
  const [capable, setCapable] = useState(false);
  const [stats, setStats] = useState(null);
  const [channels, setChannels] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [m, s, ch] = await Promise.all([getInboundAiMode(headers).catch(() => null), getInboundIntakeStats(headers).catch(() => null), getInboundAiChannels(headers).catch(() => null)]);
    if (m) { setMode(m.mode || "off"); setCapable(Boolean(m.capabilityEnabled)); }
    if (s) setStats(s);
    if (ch?.channels) setChannels(ch.channels);
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  const change = async (next) => { setBusy(true); try { const r = await setInboundAiMode(next, headers); if (r?.mode) setMode(r.mode); } finally { setBusy(false); } };
  const toggleChannel = async (ch, enabled) => { setBusy(true); try { const r = await setInboundAiChannel(ch, enabled, headers); if (r?.channels) setChannels(r.channels); } finally { setBusy(false); } };
  const { t } = useTranslation();
  /* Left value is the API mode/channel VALUE and stays raw; right is display. */
  const MODES = [["off", t("aiStudio.assisted.modes.off")], ["suggest_only", t("aiStudio.assisted.modes.suggestOnly")], ["approval_reply", t("aiStudio.assisted.modes.approvalReply")]];
  const CHANNELS = [["facebook_messenger", "Messenger"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"]];
  const w = stats?.last7d || {};
  const d = stats?.last24h || {};
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /><h2 className="m1-section-title text-[12px] uppercase tracking-[0.16em] text-slate-300">{t("aiStudio.assisted.title")}</h2></div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${capable ? "bg-emerald-400/15 text-emerald-100" : "bg-slate-500/20 text-slate-300"}`}>{capable ? t("aiStudio.assisted.capabilityOn") : t("aiStudio.assisted.capabilityOff")}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-slate-400">{t("aiStudio.assisted.explainerBefore")} <b className="text-slate-200">{t("aiStudio.assisted.explainerStrong")}</b> {t("aiStudio.assisted.explainerAfter")} <b className="text-slate-200">{t("aiStudio.assisted.neverAutonomous")}</b>{!capable ? t("aiStudio.assisted.capabilityOffNote") : ""}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t("aiStudio.assisted.mode")}</span>
        {MODES.map(([val, label]) => (
          <button key={val} type="button" disabled={busy} onClick={() => change(val)} className={`inline-flex h-[var(--control-height-sm)] items-center rounded-[var(--radius-control)] border px-3 text-[11px] font-black ${mode === val ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>{label}</button>
        ))}
        {mode !== "off" ? <button type="button" disabled={busy} onClick={() => change("off")} className="inline-flex h-8 items-center rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 text-[11px] font-black text-rose-100">{t("aiStudio.assisted.pauseAll")}</button> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t("aiStudio.assisted.channelsStaged")}</span>
        {CHANNELS.map(([val, label]) => (
          <button key={val} type="button" disabled={busy} onClick={() => toggleChannel(val, !channels[val])} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-[11px] font-black ${channels[val] ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-slate-400"}`}>{channels[val] ? "● " : "○ "}{label}</button>
        ))}
      </div>
      {stats ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[["generated", w.generated], ["approvedUnchanged", w.approved_unchanged], ["approvedEdited", w.approved_edited], ["stale", w.stale], ["skipped", w.skipped], ["errored", w.errored]].map(([id, val]) => (
            <div key={id} className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 py-2"><div className="text-[9px] font-black uppercase tracking-wide text-slate-500">{t("aiStudio.assisted.stats.window7d", { label: t(`aiStudio.assisted.stats.${id}`) })}</div><div className="mt-0.5 text-lg font-black text-slate-100">{Number(val || 0)}</div></div>
          ))}
        </div>
      ) : null}
      {mode !== "off" ? <div className="mt-2 text-[11px] text-amber-200">{t("aiStudio.assisted.enabledNote")}</div> : null}
      <div className="mt-1 text-[10px] text-slate-500">{t("aiStudio.assisted.last24h", { generated: Number(d.generated || 0), approved: Number(d.approved || 0), stale: Number(d.stale || 0) })}</div>
    </section>
  );
}

// Phase 11.2 — bounded Reply Style Learning inspector (learn presentation only; facts stay authoritative).
function ReplyStyleLearningCard() {
  const { t } = useTranslation();
  const { headers } = useStudioHeaders();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await getStyleProfile(headers).catch(() => null); if (r) setData(r); }, [headers]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (enabled) => { setBusy(true); try { await setStyleLearning(enabled, headers); await load(); } finally { setBusy(false); } };
  const reset = async () => { setBusy(true); try { await resetStyleLearning(headers); await load(); } finally { setBusy(false); } };
  /* Keys are the raw signal/value ids from the API; only the values are display. */
  const SIGNAL_LABEL = { brevity: t("aiStudio.style.signals.brevity"), exact_stock_count: t("aiStudio.style.signals.exactStockCount"), emoji: t("aiStudio.style.signals.emoji") };
  const VALUE_LABEL = { concise: t("aiStudio.style.values.concise"), normal: t("aiStudio.style.values.normal"), usually_omit: t("aiStudio.style.values.usuallyOmit"), usually_include: t("aiStudio.style.values.usuallyInclude"), light: t("aiStudio.style.values.light"), heavy: t("aiStudio.style.values.heavy"), none: t("aiStudio.style.values.none") };
  const profile = data?.profile || {};
  const intents = Object.keys(profile);
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-300">{t("aiStudio.style.title")}</h2>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => toggle(!data?.learning_enabled)} className={`inline-flex h-8 items-center rounded-lg border px-3 text-[11px] font-black ${data?.learning_enabled ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>{data?.learning_enabled ? t("aiStudio.style.learningOn") : t("aiStudio.style.learningOff")}</button>
          <button type="button" disabled={busy} onClick={reset} className="inline-flex h-8 items-center rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 text-[11px] font-black text-amber-100">{t("aiStudio.style.reset")}</button>
        </div>
      </div>
      <p className="mt-1.5 text-[12px] text-slate-400">{t("aiStudio.style.explainer1")} <b className="text-slate-200">{t("aiStudio.style.explainerHow")}</b> {t("aiStudio.style.explainer2")} <b className="text-slate-200">{t("aiStudio.style.explainerNever")}</b> {t("aiStudio.style.explainer3")} <b className="text-slate-200">{t("aiStudio.style.explainerStable")}</b> {t("aiStudio.style.explainer4")}</p>
      <p className="mt-1 text-[12px] text-slate-400">{t("aiStudio.style.factsNote")}</p>
      {!intents.length ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-400">{t("aiStudio.style.noPreference", { count: Number(data?.evidence_count || 0) })}</div>
      ) : intents.map((intent) => (
        <div key={intent} className="mt-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{intent.replace(/_/g, " ")}</div>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {Object.entries(profile[intent]).map(([signal, info]) => (
              <div key={signal} className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-200">{SIGNAL_LABEL[signal] || signal}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${info.status === "stable" ? "bg-emerald-400/15 text-emerald-100" : info.status === "conflicting" ? "bg-rose-400/15 text-rose-100" : "bg-slate-500/20 text-slate-300"}`}>{info.status}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300">{info.status === "stable" ? (VALUE_LABEL[info.value] || info.value) : t("aiStudio.style.evidence", { have: info.evidence, need: info.threshold })}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// AI Studio is a CONTROL PLANE: it surfaces real metrics from existing AI endpoints and
// links to the existing AI pages (the execution layer). It does not re-implement any
// engine, inbox, automation, or knowledge base. See docs/ai-studio-architecture.md.

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

// Every card maps to an EXISTING page. Gated by the same permission/adminOnly rules as the
// sidebar so users only see what they can already open.
const MODULE_GROUPS = [
  {
    id: "conversations",
    titleKey: "aiStudio.groups.conversations.title",
    subtitleKey: "aiStudio.groups.conversations.subtitle",
    modules: [
      { id: "aiInbox", labelKey: "aiStudio.modules.aiInbox.label", descriptionKey: "aiStudio.modules.aiInbox.description", to: "/admin/ai-inbox", icon: Bot, permission: "settings.view", adminOnly: true },
      { id: "inboxPwa", labelKey: "aiStudio.modules.inboxPwa.label", descriptionKey: "aiStudio.modules.inboxPwa.description", to: "/inbox", icon: MessageSquare, permission: "ai_inbox_messenger.view" },
      { id: "followups", labelKey: "aiStudio.modules.followups.label", descriptionKey: "aiStudio.modules.followups.description", to: "/admin/ai-followups", icon: CalendarClock, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    id: "agents",
    titleKey: "aiStudio.groups.agents.title",
    subtitleKey: "aiStudio.groups.agents.subtitle",
    modules: [
      { id: "agentSettings", labelKey: "aiStudio.modules.agentSettings.label", descriptionKey: "aiStudio.modules.agentSettings.description", to: "/admin/ai-agent-settings", icon: Settings2, permission: "settings.view", adminOnly: true },
      { id: "replySettings", labelKey: "aiStudio.modules.replySettings.label", descriptionKey: "aiStudio.modules.replySettings.description", to: "/ai/settings", icon: Sparkles, permission: "settings.edit" },
      { id: "knowledgeBase", labelKey: "aiStudio.modules.knowledgeBase.label", descriptionKey: "aiStudio.modules.knowledgeBase.description", to: "/admin/ai-support-knowledge-base", icon: BookOpen, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    id: "channels",
    titleKey: "aiStudio.groups.channels.title",
    subtitleKey: "aiStudio.groups.channels.subtitle",
    modules: [
      { id: "channels", labelKey: "aiStudio.modules.channels.label", descriptionKey: "aiStudio.modules.channels.description", to: "/admin/ai-channels", icon: Share2, permission: "settings.view", adminOnly: true },
      { id: "marketingAutomation", labelKey: "aiStudio.modules.marketingAutomation.label", descriptionKey: "aiStudio.modules.marketingAutomation.description", to: "/marketing/automation", icon: Zap, permission: "marketing.view" },
      { id: "socialComments", labelKey: "aiStudio.modules.socialComments.label", descriptionKey: "aiStudio.modules.socialComments.description", to: "/marketing/social-comments", icon: MessageSquare, permission: "marketing.view" },
    ],
  },
  {
    id: "observability",
    titleKey: "aiStudio.groups.observability.title",
    subtitleKey: "aiStudio.groups.observability.subtitle",
    modules: [
      { id: "agentAnalytics", labelKey: "aiStudio.modules.agentAnalytics.label", descriptionKey: "aiStudio.modules.agentAnalytics.description", to: "/admin/ai-agent-analytics", icon: LineChart, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    id: "marketing",
    titleKey: "aiStudio.groups.marketing.title",
    subtitleKey: "aiStudio.groups.marketing.subtitle",
    modules: [
      { id: "marketingCenter", labelKey: "aiStudio.modules.marketingCenter.label", descriptionKey: "aiStudio.modules.marketingCenter.description", to: "/marketing/ai-center", icon: Megaphone, permission: "marketing.view" },
      { id: "leadCenter", labelKey: "aiStudio.modules.leadCenter.label", descriptionKey: "aiStudio.modules.leadCenter.description", to: "/marketing/ai-center/leads", icon: Users, permission: "marketing.view" },
      { id: "marketingVideos", labelKey: "aiStudio.modules.marketingVideos.label", descriptionKey: "aiStudio.modules.marketingVideos.description", to: "/marketing/ai-center/videos", icon: Video, permission: "marketing.view" },
    ],
  },
];

const canSeeModule = (module, user) => {
  if (module.adminOnly && !isAdminUser(user)) return false;
  return hasPermission(module.permission, user);
};

function MetricCard({ icon: Icon, label, value, hint, tone = "cyan" }) {
  const toneRing = tone === "amber" ? "text-amber-200" : tone === "rose" ? "text-rose-200" : tone === "emerald" ? "text-emerald-200" : "text-primary";
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
        {Icon ? <Icon className={`h-4 w-4 ${toneRing}`} /> : null}
      </div>
      <div className="mt-2 text-2xl font-black text-white">{value === null || value === undefined ? "—" : value}</div>
      {hint ? <div className="mt-1 text-[11px] font-medium text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function AiStudio() {
  const { t } = useTranslation();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const user = useMemo(() => getCurrentUser?.() || {}, []);

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    analyticsAvailable: false,
    followupsAvailable: false,
    channelsAvailable: false,
    aiReplies: null,
    conversations: null,
    waiting: null,
    takeovers: null,
    pendingFollowups: null,
    connectedChannels: null,
  });

  const loadOverview = useCallback(async () => {
    setLoading(true);
    const [analyticsRes, followupsRes, channelsRes] = await Promise.allSettled([
      api.get("/ai-agent/analytics", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/ai-agent/followups", { params: { tenant_id: tenantId, status: "all", limit: 200 }, headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
      api.get("/ai-agent/channels/status", { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] }),
    ]);

    const next = {
      analyticsAvailable: false,
      followupsAvailable: false,
      channelsAvailable: false,
      aiReplies: null,
      conversations: null,
      waiting: null,
      takeovers: null,
      pendingFollowups: null,
      connectedChannels: null,
    };

    if (analyticsRes.status === "fulfilled") {
      const a = analyticsRes.value?.analytics && typeof analyticsRes.value.analytics === "object" ? analyticsRes.value.analytics : {};
      next.analyticsAvailable = true;
      next.aiReplies = num(a.ai_replies_count);
      next.conversations = num(a.total_conversations);
      next.waiting = num(a.waiting_customers);
      next.takeovers = num(a.human_takeover_count);
    }

    if (followupsRes.status === "fulfilled") {
      const rows = asArray(followupsRes.value?.followups);
      next.followupsAvailable = true;
      next.pendingFollowups = rows.filter((row) => {
        const status = String(row.status || "").toLowerCase();
        return status !== "completed" && status !== "done" && status !== "cancelled" && status !== "canceled";
      }).length;
    }

    if (channelsRes.status === "fulfilled") {
      const channels = channelsRes.value?.channels && typeof channelsRes.value.channels === "object" ? channelsRes.value.channels : {};
      next.channelsAvailable = true;
      next.connectedChannels = Object.values(channels).filter((ch) => {
        if (ch === true) return true;
        if (!ch || typeof ch !== "object") return false;
        return ch.connected === true || ch.enabled === true || ch.is_connected === true || String(ch.status || "").toLowerCase() === "connected";
      }).length;
    }

    setMetrics(next);
    setLoading(false);
  }, [headers, tenantId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const visibleGroups = useMemo(
    () =>
      MODULE_GROUPS.map((group) => ({
        ...group,
        modules: group.modules.filter((module) => canSeeModule(module, user)),
      })).filter((group) => group.modules.length > 0),
    [user]
  );

  return (
    <div dir="ltr" className="space-y-5 p-4 text-white md:p-6">
      {/* Header */}
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-4 w-4" />
              {t("aiStudio.page.eyebrow")}
            </div>
            <h1 className="m1-page-title mt-1 text-white">{t("aiStudio.page.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("aiStudio.page.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-white transition hover:border-white/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("aiStudio.page.refresh")}
          </button>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      <InboundAssistedRepliesCard />
      <ReplyStyleLearningCard />

      {/* Real metrics */}
      <section>
        <div className="mb-2 flex items-center gap-2 px-1">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="m1-section-title text-[12px] uppercase tracking-[0.16em] text-slate-300">{t("aiStudio.page.overview")}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard icon={Bot} label={t("aiStudio.metrics.aiReplies")} value={metrics.aiReplies} hint={metrics.analyticsAvailable ? t("aiStudio.metrics.fromAnalytics") : t("aiStudio.metrics.notAvailable")} />
          <MetricCard icon={MessageSquare} label={t("aiStudio.metrics.conversations")} value={metrics.conversations} hint={metrics.analyticsAvailable ? t("aiStudio.metrics.totalTracked") : t("aiStudio.metrics.notAvailable")} />
          <MetricCard icon={Users} label={t("aiStudio.metrics.waiting")} value={metrics.waiting} tone="amber" hint={metrics.analyticsAvailable ? t("aiStudio.metrics.awaitingReply") : t("aiStudio.metrics.notAvailable")} />
          <MetricCard icon={ShieldCheck} label={t("aiStudio.metrics.takeovers")} value={metrics.takeovers} tone="rose" hint={metrics.analyticsAvailable ? t("aiStudio.metrics.escalated") : t("aiStudio.metrics.notAvailable")} />
          <MetricCard icon={CalendarClock} label={t("aiStudio.metrics.pendingFollowups")} value={metrics.pendingFollowups} tone="amber" hint={metrics.followupsAvailable ? t("aiStudio.metrics.openTasks") : t("aiStudio.metrics.notAvailable")} />
          <MetricCard icon={Share2} label={t("aiStudio.metrics.connectedChannels")} value={metrics.connectedChannels} tone="emerald" hint={metrics.channelsAvailable ? t("aiStudio.metrics.liveChannels") : t("aiStudio.metrics.notAvailable")} />
        </div>
      </section>

      {/* Module directory (control-plane hub) */}
      {visibleGroups.map((group) => (
        <section key={group.id}>
          <div className="mb-2 px-1">
            <h2 className="m1-section-title text-[12px] uppercase tracking-[0.16em] text-slate-300">{t(group.titleKey)}</h2>
            {group.subtitleKey ? <p className="text-[11px] font-medium text-slate-500">{t(group.subtitleKey)}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.modules.map((module) => {
              const Icon = module.icon || Sparkles;
              return (
                <Link
                  key={module.to + module.id}
                  to={module.to}
                  className="group flex items-start gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)] transition hover:border-primary/40 hover:bg-white/[0.06]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-slate-950/60 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-black text-white">
                      {t(module.labelKey)}
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:text-primary" />
                    </span>
                    <span className="mt-0.5 block text-[12px] font-medium leading-5 text-slate-400">{t(module.descriptionKey)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
