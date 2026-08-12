import { useCallback, useEffect, useMemo, useState } from "react";
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
import { getInboundAiMode, setInboundAiMode, getInboundIntakeStats, getInboundAiChannels, setInboundAiChannel } from "../services/aiStudioApi";

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
  const MODES = [["off", "Off"], ["suggest_only", "Suggest only"], ["approval_reply", "Approval + Send"]];
  const CHANNELS = [["facebook_messenger", "Messenger"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"]];
  const w = stats?.last7d || {};
  const d = stats?.last24h || {};
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /><h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-300">Inbound Assisted Replies</h2></div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${capable ? "bg-emerald-400/15 text-emerald-100" : "bg-slate-500/20 text-slate-300"}`}>{capable ? "Capability enabled" : "Capability off (server flag)"}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-slate-400">On an inbound customer text, AI drafts a <b className="text-slate-200">grounded reply suggestion</b> that a human approves, edits, or rejects in the AI Inbox. <b className="text-slate-200">It never sends autonomously.</b>{!capable ? " The server capability flag is off, so no suggestions are generated yet." : ""}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Mode</span>
        {MODES.map(([val, label]) => (
          <button key={val} type="button" disabled={busy} onClick={() => change(val)} className={`inline-flex h-[var(--control-height-sm)] items-center rounded-lg border px-3 text-[11px] font-black ${mode === val ? "border-primary/50 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>{label}</button>
        ))}
        {mode !== "off" ? <button type="button" disabled={busy} onClick={() => change("off")} className="inline-flex h-8 items-center rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 text-[11px] font-black text-rose-100">⏸ Pause all (kill switch)</button> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Channels (staged)</span>
        {CHANNELS.map(([val, label]) => (
          <button key={val} type="button" disabled={busy} onClick={() => toggleChannel(val, !channels[val])} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-[11px] font-black ${channels[val] ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-slate-400"}`}>{channels[val] ? "● " : "○ "}{label}</button>
        ))}
      </div>
      {stats ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[["Generated", w.generated], ["Approved", w.approved], ["Edited", w.approved_edited], ["Stale", w.stale], ["Skipped", w.skipped], ["Errors", w.errored]].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 py-2"><div className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label} 7d</div><div className="mt-0.5 text-lg font-black text-slate-100">{Number(val || 0)}</div></div>
          ))}
        </div>
      ) : null}
      {mode !== "off" ? <div className="mt-2 text-[11px] text-amber-200">Suggestions are generated on enabled channels. Review and send from the AI Inbox — nothing is sent without a human. A newer customer message blocks approving a stale suggestion (server-enforced).</div> : null}
      <div className="mt-1 text-[10px] text-slate-500">Last 24h — generated {Number(d.generated || 0)} · approved {Number(d.approved || 0)} · stale {Number(d.stale || 0)}</div>
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
    title: "Conversations",
    subtitle: "Operational AI conversation surfaces",
    modules: [
      { label: "AI Inbox", description: "Desktop omni-channel support inbox with AI drafts.", to: "/admin/ai-inbox", icon: Bot, permission: "settings.view", adminOnly: true },
      { label: "Inbox (mobile / PWA)", description: "Mobile-optimized conversation inbox.", to: "/inbox", icon: MessageSquare, permission: "ai_inbox_messenger.view" },
      { label: "AI Follow-ups", description: "Scheduled follow-up queue and takeovers.", to: "/admin/ai-followups", icon: CalendarClock, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    title: "Agents & Behaviour",
    subtitle: "Configure how the AI agent replies",
    modules: [
      { label: "AI Agent Settings", description: "Agent tone, phrases, follow-up templates.", to: "/admin/ai-agent-settings", icon: Settings2, permission: "settings.view", adminOnly: true },
      { label: "AI Reply Settings", description: "Reply mode, tone and AI feature toggles.", to: "/ai/settings", icon: Sparkles, permission: "settings.edit" },
      { label: "AI Knowledge Base", description: "Store info the AI uses to answer questions.", to: "/admin/ai-support-knowledge-base", icon: BookOpen, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    title: "Channels & Automation",
    subtitle: "Where the AI operates and its triggers",
    modules: [
      { label: "AI Channels", description: "Messenger / Instagram / WhatsApp connection status.", to: "/admin/ai-channels", icon: Share2, permission: "settings.view", adminOnly: true },
      { label: "Marketing Automation", description: "Comment → DM automation rules.", to: "/marketing/automation", icon: Zap, permission: "marketing.view" },
      { label: "Social Comments", description: "Moderate and reply to social comments.", to: "/marketing/social-comments", icon: MessageSquare, permission: "marketing.view" },
    ],
  },
  {
    title: "Observability & Approvals",
    subtitle: "Understand and govern AI actions",
    modules: [
      { label: "AI Agent Analytics", description: "Replies, takeovers, intents and shadow analytics.", to: "/admin/ai-agent-analytics", icon: LineChart, permission: "settings.view", adminOnly: true },
    ],
  },
  {
    title: "Marketing AI",
    subtitle: "Autonomous content and lead intelligence",
    modules: [
      { label: "AI Marketing Center", description: "Autonomous social content generation & queue.", to: "/marketing/ai-center", icon: Megaphone, permission: "marketing.view" },
      { label: "AI Lead Center", description: "Lead pipeline built from conversations.", to: "/marketing/ai-center/leads", icon: Users, permission: "marketing.view" },
      { label: "AI Marketing Videos", description: "Autonomous video generation queue.", to: "/marketing/ai-center/videos", icon: Video, permission: "marketing.view" },
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
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
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-4 w-4" />
              AI Studio
            </div>
            <h1 className="mt-1 text-xl font-black text-white">AI Studio</h1>
            <p className="mt-1 text-sm text-slate-400">Central control plane for every AI capability in your store — configure agents, channels, knowledge and automations, and observe what the AI is doing.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black text-white transition hover:border-white/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      <InboundAssistedRepliesCard />

      {/* Real metrics */}
      <section>
        <div className="mb-2 flex items-center gap-2 px-1">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-300">Overview</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard icon={Bot} label="AI replies" value={metrics.aiReplies} hint={metrics.analyticsAvailable ? "From AI agent analytics" : "Not available"} />
          <MetricCard icon={MessageSquare} label="Conversations" value={metrics.conversations} hint={metrics.analyticsAvailable ? "Total tracked" : "Not available"} />
          <MetricCard icon={Users} label="Waiting customers" value={metrics.waiting} tone="amber" hint={metrics.analyticsAvailable ? "Awaiting a reply" : "Not available"} />
          <MetricCard icon={ShieldCheck} label="Human takeovers" value={metrics.takeovers} tone="rose" hint={metrics.analyticsAvailable ? "Escalated to a human" : "Not available"} />
          <MetricCard icon={CalendarClock} label="Pending follow-ups" value={metrics.pendingFollowups} tone="amber" hint={metrics.followupsAvailable ? "Open follow-up tasks" : "Not available"} />
          <MetricCard icon={Share2} label="Connected channels" value={metrics.connectedChannels} tone="emerald" hint={metrics.channelsAvailable ? "Live AI channels" : "Not available"} />
        </div>
      </section>

      {/* Module directory (control-plane hub) */}
      {visibleGroups.map((group) => (
        <section key={group.title}>
          <div className="mb-2 px-1">
            <h2 className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-300">{group.title}</h2>
            {group.subtitle ? <p className="text-[11px] font-medium text-slate-500">{group.subtitle}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.modules.map((module) => {
              const Icon = module.icon || Sparkles;
              return (
                <Link
                  key={module.to + module.label}
                  to={module.to}
                  className="group flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)] transition hover:border-primary/40 hover:bg-white/[0.06]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-slate-950/60 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-black text-white">
                      {module.label}
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:text-primary" />
                    </span>
                    <span className="mt-0.5 block text-[12px] font-medium leading-5 text-slate-400">{module.description}</span>
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
