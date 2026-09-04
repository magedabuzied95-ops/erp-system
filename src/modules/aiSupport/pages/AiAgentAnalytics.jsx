import { shiftDateKey, todayInAppTimezone } from "../../../shared/lib/appTimezone";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

const todayInput = () => todayInAppTimezone();
const daysAgoInput = (days) => shiftDateKey(todayInAppTimezone(), -days);

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

/* Keys are the RAW pilot_readiness_state enum; literal key strings keep these
   verifiable by the missing-key guard. */
const READINESS_KEY = {
  ready: "aiSupport.analytics.shadow.readiness.ready",
  near_ready: "aiSupport.analytics.shadow.readiness.near_ready",
  not_ready: "aiSupport.analytics.shadow.readiness.not_ready",
};
const readinessLabel = (t, state) => {
  const key = READINESS_KEY[state || "not_ready"];
  return key ? t(key) : state;
};

function KpiCard({ icon: Icon, label, value, tone = "cyan" }) {
  const toneClass = {
    cyan: "text-primary",
    emerald: "text-emerald-200",
    amber: "text-amber-200",
    rose: "text-rose-200",
    violet: "text-violet-200",
  }[tone] || "text-slate-200";
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4">
      <Icon className={`h-5 w-5 ${toneClass}`} />
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-primary">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text = "" }) {
  const { t } = useTranslation();
  const message = text || t("aiSupport.analytics.noData");
  return <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">{message}</div>;
}

function BarList({ rows = [], labelKey = "name", valueKey = "count", valueFormatter = (value) => value }) {
  const { t } = useTranslation();
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
              <span className="truncate font-bold text-slate-200">{item[labelKey] || item.objection || item.product_id || t("aiSupport.analytics.unknown")}</span>
              <span className="shrink-0 font-black text-white">{valueFormatter(value, item)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ rows = [], columns = [], empty = "" }) {
  const { t } = useTranslation();
  const items = asArray(rows);
  if (!items.length) return <EmptyState text={empty || t("aiSupport.analytics.noRows")} />;
  return (
    <div className="m1-table-container overflow-x-auto">
      <table className="m1-table m1-table--compact w-full min-w-[34rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} className="px-3 py-2 font-black">{column.label}</th>)}</tr>
        </thead>
        <tbody>
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
  const { t } = useTranslation();
  const items = asArray(rows);
  if (!items.length) return <EmptyState text={t("aiSupport.analytics.noEventLogs")} />;
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((item, index) => (
        <div key={item.id || `${item.event_type || "event"}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">
              {item.category || item.event_type || t("aiSupport.analytics.event")}
            </span>
            {item.channel ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-300">
                {item.channel}
              </span>
            ) : null}
            <span className="text-xs text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
          </div>
          <div className="mt-2 text-sm font-bold text-white">{item.message || item.reason || item.source || t("aiSupport.analytics.aiEvent")}</div>
          <div className="mt-1 text-xs text-slate-400">
            {item.conversation_id ? t("aiSupport.analytics.conversation", { id: item.conversation_id }) : t("aiSupport.analytics.conversationNone")}
            {item.error?.message ? t("aiSupport.analytics.errorSuffix", { message: item.error.message }) : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AiAgentAnalytics() {
  const { t } = useTranslation();
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
      <div className="mx-auto flex w-full flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary"><BarChart3 className="h-4 w-4" />{t("aiSupport.analytics.eyebrow")}</div>
              <h1 className="m1-display mt-3">{t("aiSupport.analytics.title")}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{t("aiSupport.analytics.subtitle")}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40" />
              <input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40" />
              <select value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-primary/40">
                <option value="">{t("aiSupport.analytics.allBranches")}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || t("aiSupport.analytics.branchNumber", { id: branch.id })}</option>)}
              </select>
              <button type="button" onClick={loadAnalytics} disabled={loading} className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("aiSupport.analytics.refresh")}
              </button>
            </div>
          </div>
          {error ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100"><AlertTriangle className="h-4 w-4" />{error}</div> : null}
        </section>

        {loading && !analytics ? <EmptyState text={t("aiSupport.analytics.loadingAnalytics")} /> : null}
        {!loading && !analytics && !error ? <EmptyState /> : null}

        {analytics ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <KpiCard icon={TrendingUp} label={t("aiSupport.analytics.kpi.aiRevenue")} value={money(analytics.ai_revenue)} tone="emerald" />
              <KpiCard icon={ShoppingCart} label={t("aiSupport.analytics.kpi.drafts")} value={analytics.draft_orders || 0} tone="cyan" />
              <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.kpi.confirmedOrders")} value={analytics.confirmed_orders || 0} tone="emerald" />
              <KpiCard icon={Flame} label={t("aiSupport.analytics.kpi.conversionRate")} value={percent(analytics.conversion_rate)} tone="amber" />
              <KpiCard icon={ShoppingCart} label={t("aiSupport.analytics.kpi.averageOrderValue")} value={money(analytics.average_order_value)} tone="violet" />
              <KpiCard icon={Clock3} label={t("aiSupport.analytics.kpi.abandonedRecovered")} value={`${analytics.abandoned_conversations || 0} / ${analytics.recovered_conversations || 0}`} tone="rose" />
            </section>

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <KpiCard icon={Users} label={t("aiSupport.analytics.kpi.totalConversations")} value={analytics.total_conversations || 0} />
              <KpiCard icon={Bot} label={t("aiSupport.analytics.kpi.aiReplies")} value={analytics.ai_replies_count || 0} />
              <KpiCard icon={Handshake} label={t("aiSupport.analytics.kpi.humanTakeovers")} value={analytics.human_takeover_count || 0} tone="amber" />
              <KpiCard icon={Clock3} label={t("aiSupport.analytics.kpi.avgResponseTime")} value={seconds(analytics.average_response_seconds)} tone="violet" />
              <KpiCard icon={Clock3} label={t("aiSupport.analytics.kpi.waitingCustomers")} value={analytics.waiting_customers || 0} tone="amber" />
              <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.kpi.closedConversations")} value={analytics.closed_conversations || 0} tone="emerald" />
            </section>

            <section className="grid gap-5 xl:grid-cols-3">
              <Panel icon={Flame} title={t("aiSupport.analytics.lead.title")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard icon={Flame} label={t("aiSupport.analytics.lead.hot")} value={lead.hot_leads || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label={t("aiSupport.analytics.lead.warm")} value={lead.warm_leads || 0} tone="amber" />
                  <KpiCard icon={Users} label={t("aiSupport.analytics.lead.cold")} value={lead.cold_leads || 0} tone="cyan" />
                  <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.lead.vip")} value={lead.vip_customers || 0} tone="emerald" />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.lead.complaints")} value={lead.complaints || 0} tone="rose" />
                </div>
              </Panel>

              <Panel icon={AlertTriangle} title={t("aiSupport.analytics.objections.title")}>
                <BarList rows={analytics.top_objections} labelKey="objection" valueKey="count" />
              </Panel>

              <Panel icon={RefreshCw} title={t("aiSupport.analytics.followups.title")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard icon={Clock3} label={t("aiSupport.analytics.followups.scheduled")} value={followups.scheduled_followups || 0} />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.followups.due")} value={followups.due_followups || 0} tone="amber" />
                  <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.followups.sent")} value={followups.sent_followups || 0} tone="emerald" />
                  <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.followups.manuallySent")} value={followups.manually_sent_followups || 0} tone="emerald" />
                  <KpiCard icon={Clock3} label={t("aiSupport.analytics.followups.snoozed")} value={followups.snoozed_followups || 0} tone="violet" />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.followups.cancelled")} value={followups.cancelled_followups || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label={t("aiSupport.analytics.followups.recovered")} value={followups.recovered_conversations_after_followup || 0} tone="cyan" />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.followups.stopped")} value={followups.stopped_after_rejection || 0} tone="rose" />
                </div>
              </Panel>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <Panel icon={PackageSearch} title={t("aiSupport.analytics.products.asked")}>
                <DataTable
                  rows={productIntel.top_products_asked_about}
                  columns={[
                    { key: "name", label: t("aiSupport.analytics.products.columns.product"), render: (row) => row.name || row.product_id || t("aiSupport.analytics.unknown") },
                    { key: "interest_count", label: t("aiSupport.analytics.products.columns.interest"), render: (row) => row.interest_count || 0 },
                  ]}
                />
              </Panel>
              <Panel icon={CheckCircle2} title={t("aiSupport.analytics.products.converted")}>
                <DataTable
                  rows={productIntel.top_products_converted}
                  columns={[
                    { key: "name", label: t("aiSupport.analytics.products.columns.product"), render: (row) => row.name || row.product_id || t("aiSupport.analytics.unknown") },
                    { key: "converted_count", label: t("aiSupport.analytics.products.columns.orders"), render: (row) => row.converted_count || 0 },
                    { key: "revenue", label: t("aiSupport.analytics.products.columns.revenue"), render: (row) => money(row.revenue) },
                  ]}
                />
              </Panel>
              <Panel icon={TrendingUp} title={t("aiSupport.analytics.products.highInterest")}>
                <DataTable
                  rows={productIntel.high_interest_low_conversion}
                  columns={[
                    { key: "name", label: t("aiSupport.analytics.products.columns.product"), render: (row) => row.name || row.product_id || t("aiSupport.analytics.unknown") },
                    { key: "interest_count", label: t("aiSupport.analytics.products.columns.interest"), render: (row) => row.interest_count || 0 },
                    { key: "conversion_rate", label: t("aiSupport.analytics.products.columns.conversion"), render: (row) => percent(row.conversion_rate) },
                  ]}
                />
              </Panel>
              <Panel icon={AlertTriangle} title={t("aiSupport.analytics.products.stockConflicts")}>
                <DataTable
                  rows={productIntel.products_with_stock_conflicts}
                  columns={[
                    { key: "name", label: t("aiSupport.analytics.products.columns.product"), render: (row) => row.name || row.product_id || t("aiSupport.analytics.unknown") },
                    { key: "conflict_count", label: t("aiSupport.analytics.products.columns.conflicts"), render: (row) => row.conflict_count || 0 },
                  ]}
                />
              </Panel>
            </section>

            <section className="space-y-5">
              <Panel icon={ShieldAlert} title={t("aiSupport.analytics.shadow.title")}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <KpiCard icon={BarChart3} label={t("aiSupport.analytics.shadow.totalDrafts")} value={shadow.total_drafts || 0} tone="cyan" />
                  <KpiCard icon={CheckCircle2} label={t("aiSupport.analytics.shadow.eligible")} value={shadow.eligible_count || 0} tone="emerald" />
                  <KpiCard icon={Clock3} label={t("aiSupport.analytics.shadow.review")} value={shadow.review_count || 0} tone="amber" />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.shadow.humanRequired")} value={shadow.human_required_count || 0} tone="rose" />
                  <KpiCard icon={TrendingUp} label={t("aiSupport.analytics.shadow.eligibilityRate")} value={percent(shadow.eligibility_rate)} tone="violet" />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.analytics.shadow.pilotReadiness")}</div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className={`rounded-2xl border border-white/10 px-4 py-3 text-3xl font-black ${shadowReadinessClass}`}>
                        {shadow.pilot_readiness_score ?? 0}
                      </div>
                      <div>
                        <div className="text-sm font-black text-white">{readinessLabel(t, shadow.pilot_readiness_state)}</div>
                        <div className="mt-1 text-xs text-slate-500">{t("aiSupport.analytics.shadow.weeklyScore")}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs leading-5 text-slate-400">
                      {shadow.pilot_readiness_formula || "score = clamp(round(eligible_rate*100 - correction_rate*80 - safety_block_rate*60 - validator_violation_rate*40), 0, 100)"}
                    </div>
                  </div>

                  <KpiCard icon={RefreshCw} label={t("aiSupport.analytics.shadow.corrections")} value={shadow.corrections_count || 0} tone="violet" />
                  <KpiCard icon={ShieldAlert} label={t("aiSupport.analytics.shadow.safetyBlocks")} value={shadow.safety_blocks_count || 0} tone="rose" />
                  <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.shadow.validatorViolations")} value={shadow.validator_violations_count || 0} tone="amber" />
                </div>
              </Panel>

              <Panel icon={ShieldAlert} title={t("aiSupport.analytics.safety.title")}>
                {aiEventLogsError ? (
                  <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {aiEventLogsError}
                  </div>
                ) : null}
                {aiEventLogsSummary && (aiSafety.total_events > 0 || asArray(aiSafety.latest_events).length > 0) ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <KpiCard icon={ShieldAlert} label={t("aiSupport.analytics.safety.duplicatePrevented")} value={aiSafety.duplicate_prevention_count || 0} tone="emerald" />
                    <KpiCard icon={AlertTriangle} label={t("aiSupport.analytics.safety.autoReplyFailures")} value={aiSafety.auto_reply_failure_count || 0} tone="rose" />
                    <KpiCard icon={BarChart3} label={t("aiSupport.analytics.safety.totalEvents")} value={aiSafety.total_events || 0} tone="cyan" />
                  </div>
                ) : aiEventLogsSummary && !aiEventLogsError ? (
                  <EmptyState text="No AI safety events recorded in the last 7 days." />
                ) : null}

                {aiEventLogsSummary && (aiSafety.total_events > 0 || asArray(aiSafety.latest_events).length > 0) ? (
                  <div className="mt-5">
                    <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{t("aiSupport.analytics.safety.latestEvents")}</div>
                    <EventLogList rows={aiSafety.latest_events || []} />
                  </div>
                ) : null}
              </Panel>

              <div className="grid gap-5 xl:grid-cols-2">
                <Panel icon={Flame} title={t("aiSupport.analytics.safety.topBlockers")}>
                  <BarList rows={shadow.top_blockers} labelKey="blocker" valueKey="count" />
                </Panel>
                <Panel icon={TrendingUp} title={t("aiSupport.analytics.safety.topIntents")}>
                  <BarList rows={shadow.top_intents} labelKey="intent" valueKey="count" />
                </Panel>
                <Panel icon={AlertTriangle} title={t("aiSupport.analytics.safety.intentDistribution")}>
                  <BarList rows={shadow.top_safety_intents} labelKey="safety_intent" valueKey="count" />
                </Panel>
                <Panel icon={Clock3} title={t("aiSupport.analytics.safety.confidenceDistribution")}>
                  <BarList rows={shadow.confidence_distribution} labelKey="bucket" valueKey="count" />
                </Panel>
                <Panel icon={Users} title={t("aiSupport.analytics.safety.channelsBreakdown")}>
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
