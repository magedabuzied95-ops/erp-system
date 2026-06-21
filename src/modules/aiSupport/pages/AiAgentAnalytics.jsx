import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  Flame,
  Handshake,
  Loader2,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { formatCurrency } from "../../../shared/lib/currency";
import { useTenant } from "../../saas/context/TenantContext";

const asArray = (value) => (Array.isArray(value) ? value : []);
const number = (value) => Number(value || 0);
const money = (value) => formatCurrency(number(value));
const percent = (value) => `${(number(value) * 100).toFixed(1)}%`;
const seconds = (value) => {
  const sec = Math.round(number(value));
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
};

const todayInput = () => new Date().toISOString().slice(0, 10);
const daysAgoInput = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

function KpiCard({ icon: Icon, label, value, tone = "cyan" }) {
  const toneClass = {
    cyan: "text-cyan-200",
    emerald: "text-emerald-200",
    amber: "text-amber-200",
    rose: "text-rose-200",
    violet: "text-violet-200",
  }[tone] || "text-slate-200";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <Icon className={`h-5 w-5 ${toneClass}`} />
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-cyan-100">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text = "No data for this period." }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">{text}</div>;
}

function BarList({ rows = [], labelKey = "name", valueKey = "count", valueFormatter = (value) => value }) {
  const items = asArray(rows).filter(Boolean);
  const max = Math.max(1, ...items.map((item) => number(item[valueKey])));
  if (!items.length) return <EmptyState />;
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const value = number(item[valueKey]);
        return (
          <div key={`${item[labelKey] || item.product_id || index}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-bold text-slate-200">{item[labelKey] || item.objection || item.product_id || "Unknown"}</span>
              <span className="shrink-0 font-black text-white">{valueFormatter(value, item)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ rows = [], columns = [], empty = "No rows." }) {
  const items = asArray(rows);
  if (!items.length) return <EmptyState text={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} className="px-3 py-2 font-black">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {items.map((row, index) => (
            <tr key={row.id || row.product_id || row.objection || index}>
              {columns.map((column) => <td key={column.key} className="px-3 py-3 text-slate-200">{column.render ? column.render(row) : row[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventLogList({ rows = [] }) {
  const items = asArray(rows);
  if (!items.length) return <EmptyState text="No AI event logs in the selected period." />;
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((item, index) => (
        <div key={item.id || `${item.event_type || "event"}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">
              {item.category || item.event_type || "event"}
            </span>
            {item.channel ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-300">
                {item.channel}
              </span>
            ) : null}
            <span className="text-xs text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white">{item.message || item.reason || item.source || "AI event"}</div>
          <div className="mt-1 text-xs text-slate-400">
            {item.conversation_id ? `Conversation: ${item.conversation_id}` : "Conversation: -"}
            {item.error?.message ? ` • Error: ${item.error.message}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AiAgentAnalytics() {
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const [filters, setFilters] = useState({ from_date: daysAgoInput(30), to_date: todayInput(), branch_id: "" });
  const [branches, setBranches] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [shadowAnalytics, setShadowAnalytics] = useState(null);
  const [aiEventLogsSummary, setAiEventLogsSummary] = useState(null);
  const [aiEventLogsError, setAiEventLogsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [baseResult, shadowResult, eventLogsResult] = await Promise.allSettled([
        api.get("/ai-agent/analytics", {
          params: {
            tenant_id: tenantId,
            from_date: filters.from_date,
            to_date: filters.to_date,
            branch_id: filters.branch_id,
          },
          headers,
        }),
        api.get("/ai-agent/shadow-analytics", {
          params: {
            tenant_id: tenantId,
            from_date: filters.from_date,
            to_date: filters.to_date,
          },
          headers,
        }),
        api.get("/ai-agent/event-logs/summary", {
          params: {
            tenant_id: tenantId,
            days: 7,
          },
          headers,
          suppressErrorStatuses: [400, 401, 403, 404, 500],
        }),
      ]);
      if (baseResult.status === "fulfilled") {
        setAnalytics(baseResult.value.analytics || {});
      } else {
        throw baseResult.reason;
      }
      if (shadowResult.status === "fulfilled") {
        setShadowAnalytics(shadowResult.value.analytics || {});
      } else {
        setShadowAnalytics(null);
      }
      if (eventLogsResult?.status === "fulfilled") {
        setAiEventLogsSummary(eventLogsResult.value || {});
        setAiEventLogsError("");
      } else {
        setAiEventLogsSummary(null);
        setAiEventLogsError(eventLogsResult?.reason?.message || "Failed to load AI safety monitor");
      }
    } catch (err) {
      setError(err?.message || "Failed to load AI agent analytics");
    } finally {
      setLoading(false);
    }
  }, [filters.branch_id, filters.from_date, filters.to_date, headers, tenantId]);

  useEffect(() => {
    api.get("/branches", { headers, suppressErrorStatuses: [403, 404] })
      .then((payload) => setBranches(asArray(payload.branches || payload.data)))
      .catch(() => setBranches([]));
  }, [headers]);

  useEffect(() => {
    Promise.resolve().then(loadAnalytics);
  }, [loadAnalytics]);

  const lead = analytics?.lead_quality || {};
  const productIntel = analytics?.product_intelligence || {};
  const followups = analytics?.followup_performance || {};
  const shadow = shadowAnalytics || {};
  const aiSafety = aiEventLogsSummary || {};
  const shadowReadinessClass = {
    pilot_ready: "text-emerald-200",
    monitor: "text-amber-200",
    not_ready: "text-rose-200",
  }[shadow.pilot_readiness_state] || "text-slate-200";

  return (
    <div dir="ltr" className="min-h-full bg-[linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-cyan-100"><BarChart3 className="h-4 w-4" />AI Agent Analytics</div>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">Performance Dashboard</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Commercial and operational performance for AI-assisted conversations, drafts, orders, follow-ups, objections, and product demand.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40" />
              <input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40" />
              <select value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className="h-11 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40">
                <option value="">All branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || `Branch ${branch.id}`}</option>)}
              </select>
              <button type="button" onClick={loadAnalytics} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>
          </div>
          {error ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100"><AlertTriangle className="h-4 w-4" />{error}</div> : null}
        </section>

        {loading && !analytics ? <EmptyState text="Loading analytics..." /> : null}
        {!loading && !analytics && !error ? <EmptyState /> : null}

        {analytics ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <KpiCard icon={TrendingUp} label="AI-assisted revenue" value={money(analytics.ai_revenue)} tone="emerald" />
              <KpiCard icon={ShoppingCart} label="AI-created drafts" value={analytics.draft_orders || 0} tone="cyan" />
              <KpiCard icon={CheckCircle2} label="Confirmed AI orders" value={analytics.confirmed_orders || 0} tone="emerald" />
              <KpiCard icon={Flame} label="Conversion rate" value={percent(analytics.conversion_rate)} tone="amber" />
              <KpiCard icon={ShoppingCart} label="Average order value" value={money(analytics.average_order_value)} tone="violet" />
              <KpiCard icon={Clock3} label="Abandoned / recovered" value={`${analytics.abandoned_conversations || 0} / ${analytics.recovered_conversations || 0}`} tone="rose" />
            </section>

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <KpiCard icon={Users} label="Total conversations" value={analytics.total_conversations || 0} />
              <KpiCard icon={Bot} label="AI replies" value={analytics.ai_replies_count || 0} />
              <KpiCard icon={Handshake} label="Human takeovers" value={analytics.human_takeover_count || 0} tone="amber" />
              <KpiCard icon={Clock3} label="Avg response time" value={seconds(analytics.average_response_seconds)} tone="violet" />
              <KpiCard icon={Clock3} label="Waiting customers" value={analytics.waiting_customers || 0} tone="amber" />
              <KpiCard icon={CheckCircle2} label="Closed conversations" value={analytics.closed_conversations || 0} tone="emerald" />
            </section>

            <section className="grid gap-5 xl:grid-cols-3">
              <Panel icon={Flame} title="Lead Quality">
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard icon={Flame} label="Hot leads" value={lead.hot_leads || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label="Warm leads" value={lead.warm_leads || 0} tone="amber" />
                  <KpiCard icon={Users} label="Cold leads" value={lead.cold_leads || 0} tone="cyan" />
                  <KpiCard icon={CheckCircle2} label="VIP customers" value={lead.vip_customers || 0} tone="emerald" />
                  <KpiCard icon={AlertTriangle} label="Complaints" value={lead.complaints || 0} tone="rose" />
                </div>
              </Panel>

              <Panel icon={AlertTriangle} title="Top Objections">
                <BarList rows={analytics.top_objections} labelKey="objection" valueKey="count" />
              </Panel>

              <Panel icon={RefreshCw} title="Follow-up Performance">
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard icon={Clock3} label="Scheduled" value={followups.scheduled_followups || 0} />
                  <KpiCard icon={AlertTriangle} label="Due" value={followups.due_followups || 0} tone="amber" />
                  <KpiCard icon={CheckCircle2} label="Sent" value={followups.sent_followups || 0} tone="emerald" />
                  <KpiCard icon={CheckCircle2} label="Manually sent" value={followups.manually_sent_followups || 0} tone="emerald" />
                  <KpiCard icon={Clock3} label="Snoozed" value={followups.snoozed_followups || 0} tone="violet" />
                  <KpiCard icon={AlertTriangle} label="Cancelled" value={followups.cancelled_followups || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label="Recovered after follow-up" value={followups.recovered_conversations_after_followup || 0} tone="cyan" />
                  <KpiCard icon={AlertTriangle} label="Stopped after rejection" value={followups.stopped_after_rejection || 0} tone="rose" />
                </div>
              </Panel>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <Panel icon={PackageSearch} title="Top Products Asked About">
                <DataTable
                  rows={productIntel.top_products_asked_about}
                  columns={[
                    { key: "name", label: "Product", render: (row) => row.name || row.product_id || "Unknown" },
                    { key: "interest_count", label: "Interest", render: (row) => row.interest_count || 0 },
                  ]}
                />
              </Panel>
              <Panel icon={CheckCircle2} title="Top Products Converted">
                <DataTable
                  rows={productIntel.top_products_converted}
                  columns={[
                    { key: "name", label: "Product", render: (row) => row.name || row.product_id || "Unknown" },
                    { key: "converted_count", label: "Orders", render: (row) => row.converted_count || 0 },
                    { key: "revenue", label: "Revenue", render: (row) => money(row.revenue) },
                  ]}
                />
              </Panel>
              <Panel icon={TrendingUp} title="High Interest, Low Conversion">
                <DataTable
                  rows={productIntel.high_interest_low_conversion}
                  columns={[
                    { key: "name", label: "Product", render: (row) => row.name || row.product_id || "Unknown" },
                    { key: "interest_count", label: "Interest", render: (row) => row.interest_count || 0 },
                    { key: "conversion_rate", label: "Conversion", render: (row) => percent(row.conversion_rate) },
                  ]}
                />
              </Panel>
              <Panel icon={AlertTriangle} title="Products With Stock Conflicts">
                <DataTable
                  rows={productIntel.products_with_stock_conflicts}
                  columns={[
                    { key: "name", label: "Product", render: (row) => row.name || row.product_id || "Unknown" },
                    { key: "conflict_count", label: "Conflicts", render: (row) => row.conflict_count || 0 },
                  ]}
                />
              </Panel>
            </section>

            <section className="space-y-5">
              <Panel icon={ShieldAlert} title="Shadow Analytics">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <KpiCard icon={BarChart3} label="Total Drafts" value={shadow.total_drafts || 0} tone="cyan" />
                  <KpiCard icon={CheckCircle2} label="Eligible" value={shadow.eligible_count || 0} tone="emerald" />
                  <KpiCard icon={Clock3} label="Review" value={shadow.review_count || 0} tone="amber" />
                  <KpiCard icon={AlertTriangle} label="Human Required" value={shadow.human_required_count || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label="Eligibility %" value={percent(shadow.eligibility_rate)} tone="violet" />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Pilot Readiness</div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className={`rounded-2xl border border-white/10 px-4 py-3 text-3xl font-black ${shadowReadinessClass}`}>
                        {shadow.pilot_readiness_score ?? 0}
                      </div>
                      <div>
                        <div className="text-sm font-black text-white">{shadow.pilot_readiness_state || "not_ready"}</div>
                        <div className="mt-1 text-xs text-slate-500">Weekly readiness score</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs leading-5 text-slate-400">
                      {shadow.pilot_readiness_formula || "score = clamp(round(eligible_rate*100 - correction_rate*80 - safety_block_rate*60 - validator_violation_rate*40), 0, 100)"}
                    </div>
                  </div>

                  <KpiCard icon={RefreshCw} label="Corrections" value={shadow.corrections_count || 0} tone="violet" />
                  <KpiCard icon={ShieldAlert} label="Safety Blocks" value={shadow.safety_blocks_count || 0} tone="rose" />
                  <KpiCard icon={AlertTriangle} label="Validator Violations" value={shadow.validator_violations_count || 0} tone="amber" />
                </div>
              </Panel>

              <Panel icon={ShieldAlert} title="AI Safety Monitor">
                {aiEventLogsError ? (
                  <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {aiEventLogsError}
                  </div>
                ) : null}
                {aiEventLogsSummary && (aiSafety.total_events > 0 || asArray(aiSafety.latest_events).length > 0) ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <KpiCard icon={ShieldAlert} label="Duplicate prevented" value={aiSafety.duplicate_prevention_count || 0} tone="emerald" />
                    <KpiCard icon={AlertTriangle} label="Auto reply failures" value={aiSafety.auto_reply_failure_count || 0} tone="rose" />
                    <KpiCard icon={BarChart3} label="Total events" value={aiSafety.total_events || 0} tone="cyan" />
                  </div>
                ) : aiEventLogsSummary && !aiEventLogsError ? (
                  <EmptyState text="No AI safety events recorded in the last 7 days." />
                ) : null}

                {aiEventLogsSummary && (aiSafety.total_events > 0 || asArray(aiSafety.latest_events).length > 0) ? (
                  <div className="mt-5">
                    <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Latest 5 events</div>
                    <EventLogList rows={aiSafety.latest_events || []} />
                  </div>
                ) : null}
              </Panel>

              <div className="grid gap-5 xl:grid-cols-2">
                <Panel icon={Flame} title="Top Blockers">
                  <BarList rows={shadow.top_blockers} labelKey="blocker" valueKey="count" />
                </Panel>
                <Panel icon={TrendingUp} title="Top Intents">
                  <BarList rows={shadow.top_intents} labelKey="intent" valueKey="count" />
                </Panel>
                <Panel icon={AlertTriangle} title="Safety Intent Distribution">
                  <BarList rows={shadow.top_safety_intents} labelKey="safety_intent" valueKey="count" />
                </Panel>
                <Panel icon={Clock3} title="Confidence Distribution">
                  <BarList rows={shadow.confidence_distribution} labelKey="bucket" valueKey="count" />
                </Panel>
                <Panel icon={Users} title="Channels Breakdown">
                  <BarList rows={shadow.channels_breakdown} labelKey="channel" valueKey="count" />
                </Panel>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
