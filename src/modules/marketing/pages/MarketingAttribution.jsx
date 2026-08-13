import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Filter, RefreshCw, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { getMarketingAttribution, syncMarketingAttribution } from "../services/marketingApi";
import MarketingMetricCard from "../components/MarketingMetricCard";
import { hasPermission } from "../../permissions/lib/rbacStore";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const formatNumber = (value) => Number(value || 0).toLocaleString();
const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
};

const COLORS = ["#22c55e", "#06b6d4", "#f59e0b", "#8b5cf6", "#ec4899", "#3b82f6"];

export default function MarketingAttribution() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [filters, setFilters] = useState({
    platform: "all",
    from: "",
    to: "",
  });

  const canSync = hasPermission("marketing.update");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMarketingAttribution({
        platform: filters.platform === "all" ? "" : filters.platform,
        from: filters.from || "",
        to: filters.to || "",
      });
      setPayload(data || null);
    } catch (err) {
      setError(err?.message || t("marketing.analytics.attribution.loadFailed"));
      toast.error(err?.message || t("marketing.analytics.attribution.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [filters.from, filters.platform, filters.to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const refresh = async () => {
    if (!canSync) {
      toast.error(t("marketing.analytics.attribution.permissionSync"));
      return;
    }
    setSyncing(true);
    try {
      const result = await syncMarketingAttribution({
        platform: filters.platform === "all" ? "" : filters.platform,
        from: filters.from || "",
        to: filters.to || "",
      });
      setPayload(result || null);
      toast.success(t("marketing.analytics.attribution.syncCompleted"));
    } catch (err) {
      toast.error(err?.message || t("marketing.analytics.attribution.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  const summary = payload?.summary || {};
  const topPosts = Array.isArray(payload?.top_posts) ? payload.top_posts : [];
  const topCampaigns = Array.isArray(payload?.top_campaigns) ? payload.top_campaigns : [];
  const storyVsPost = Array.isArray(payload?.story_vs_post) ? payload.story_vs_post : [];
  const salesOverTime = Array.isArray(payload?.sales_over_time) ? payload.sales_over_time : [];
  const platformComparison = Array.isArray(payload?.platform_comparison) ? payload.platform_comparison : [];
  const bestPost = summary.top_converting_post || topPosts[0] || null;
  const bestPlatform = summary.best_platform || platformComparison[0] || null;
  const funnelData = [
    { name: t("marketing.analytics.funnel.clicks"), value: Number(summary.clicks || 0) },
    { name: t("marketing.analytics.funnel.addToCart"), value: Number(summary.add_to_cart || 0) },
    { name: t("marketing.analytics.funnel.checkout"), value: Number(summary.checkout || 0) },
    { name: t("marketing.analytics.funnel.orders"), value: Number(summary.order_created || 0) },
  ];

  const topRows = useMemo(() => topPosts.slice(0, 12), [topPosts]);

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <TrendingUp className="h-3.5 w-3.5" />
                {t("marketing.analytics.attribution.eyebrow")}
              </div>
              <h1 className="m1-display">{t("marketing.analytics.attribution.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">{t("marketing.analytics.attribution.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refresh}
                disabled={syncing || !canSync}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {t("marketing.analytics.attribution.sync")}
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface)] disabled:opacity-60"
              >
                <BarChart3 className="h-4 w-4 text-primary" />
                {t("marketing.common.refreshView")}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MarketingMetricCard label={t("marketing.analytics.attribution.metrics.revenue")} value={loading ? "-" : formatNumber(summary.revenue_from_marketing)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.attribution.metrics.orders")} value={loading ? "-" : formatNumber(summary.marketing_orders)} tone="cyan" icon={<BarChart3 className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.attribution.metrics.topPost")} value={loading ? "-" : bestPost?.title || "-"} tone="violet" icon={<CalendarDays className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.attribution.metrics.bestPlatform")} value={loading ? "-" : bestPlatform?.platform || "-"} tone="amber" icon={<Filter className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.attribution.metrics.conversionRate")} value={loading ? "-" : formatPercent(summary.conversion_rate)} tone="rose" icon={<RefreshCw className="h-5 w-5" />} />
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.social.platform")}</span>
              <select
                value={filters.platform}
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              >
                <option value="all">{t("marketing.social.allPlatforms")}</option>
                <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
                <option value="story">{t("marketing.social.platforms.story")}</option>
                <option value="tiktok">{t("marketing.social.platforms.tiktok")}</option>
                <option value="whatsapp">{t("marketing.social.platforms.whatsapp")}</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.common.from")}</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{t("marketing.common.to")}</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
              <Filter className="h-3.5 w-3.5" />
              {t("marketing.analytics.filteredView", { platform: payload?.filters?.platform || filters.platform })}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
              {t("marketing.analytics.lastSynced", { value: formatDateTime(summary.last_synced_at) })}
            </span>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.funnel.title")}</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#22c55e" radius={[12, 12, 0, 0]}>
                    <LabelList dataKey="value" position="top" fill="#fff" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.salesOverTime")}</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={salesOverTime}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="day" stroke="#94a3b8" tickFormatter={(value) => String(value || "").slice(5, 10)} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue" stroke="#06b6d4" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.platformComparison")}</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={platformComparison} dataKey="revenue" nameKey="platform" outerRadius={110} innerRadius={60} paddingAngle={2}>
                    {platformComparison.map((entry, index) => (
                      <Cell key={entry.platform || index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.storyVsPost")}</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={storyVsPost}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="tracking_kind" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#8b5cf6" radius={[12, 12, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)]">
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4">
              <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.attribution.topPostsBySales")}</h2>
              <p className="text-sm text-[var(--muted)]">{t("marketing.analytics.attribution.bestPerformers")}</p>
            </div>
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-full">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.analytics.table.post")}</th>
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.social.platform")}</th>
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.analytics.funnel.orders")}</th>
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.analytics.table.revenue")}</th>
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.analytics.funnel.clicks")}</th>
                    <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.analytics.table.engagement")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted)]">{t("marketing.analytics.attribution.loading")}</td>
                    </tr>
                  ) : topRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted)]">{t("marketing.analytics.attribution.empty")}</td>
                    </tr>
                  ) : (
                    topRows.map((row) => (
                      <tr key={`${row.platform}-${row.post_id}`} className="align-top">
                        <td className="border-b border-[var(--border)] px-3 py-4">
                          <div className="font-semibold text-[var(--text)]">{row.title || t("marketing.analytics.table.postNumber", { id: row.post_id })}</div>
                          <div className="text-xs text-[var(--muted)]">{row.tracking_kind || "post"} • {row.last_event_at ? formatDateTime(row.last_event_at) : "-"}</div>
                        </td>
                        <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.platform || "-"}</td>
                        <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatNumber(row.orders)}</td>
                        <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatNumber(row.revenue)}</td>
                        <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatNumber(row.clicks)}</td>
                        <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatPercent(row.engagement_rate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.attribution.topCampaigns")}</h2>
              <div className="mt-4 space-y-3">
                {topCampaigns.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">{t("marketing.analytics.attribution.noCampaigns")}</div>
                ) : (
                  topCampaigns.slice(0, 6).map((campaign) => (
                    <div key={`${campaign.platform}-${campaign.campaign}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="font-semibold text-[var(--text)]">{campaign.campaign || t("marketing.analytics.attribution.unassigned")}</div>
                      <div className="mt-1 text-sm text-[var(--muted)]">{campaign.platform || t("marketing.social.platforms.other")}</div>
                      <div className="mt-3 flex items-center justify-between text-sm text-[var(--muted)]">
                        <span>{t("marketing.analytics.attribution.orderCount", { count: formatNumber(campaign.orders) })}</span>
                        <span className="font-semibold text-[var(--text)]">{t("marketing.analytics.attribution.revenueValue", { value: formatNumber(campaign.revenue) })}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="m1-section-title text-[var(--text)]">{t("marketing.analytics.attribution.revenuePerPlatform")}</h2>
              <div className="mt-4 space-y-3">
                {platformComparison.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">{t("marketing.analytics.noPlatformComparison")}</div>
                ) : (
                  platformComparison.map((row, index) => (
                    <div key={row.platform || index} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{row.platform || "-"}</div>
                          <div className="text-xs text-[var(--muted)]">{t("marketing.analytics.attribution.orderCount", { count: formatNumber(row.orders) })}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-[var(--text)]">{formatNumber(row.revenue)}</div>
                          <div className="text-xs text-[var(--muted)]">{formatPercent(row.conversion_rate)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
