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
      setError(err?.message || "Failed to load marketing attribution");
      toast.error(err?.message || "Failed to load marketing attribution");
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
      toast.error("You do not have permission to sync marketing attribution.");
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
      toast.success("Marketing attribution sync completed");
    } catch (err) {
      toast.error(err?.message || "Failed to sync marketing attribution");
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
    { name: "Clicks", value: Number(summary.clicks || 0) },
    { name: "Add to cart", value: Number(summary.add_to_cart || 0) },
    { name: "Checkout", value: Number(summary.checkout || 0) },
    { name: "Orders", value: Number(summary.order_created || 0) },
  ];

  const topRows = useMemo(() => topPosts.slice(0, 12), [topPosts]);

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <TrendingUp className="h-3.5 w-3.5" />
                Marketing attribution
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Sales from Facebook, Instagram, Story, and campaigns</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">See which marketing posts actually turn into orders, revenue, and funnel movement.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refresh}
                disabled={syncing || !canSync}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                Sync attribution
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <BarChart3 className="h-4 w-4 text-cyan-300" />
                Refresh view
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MarketingMetricCard label="Revenue from marketing" value={loading ? "-" : formatNumber(summary.revenue_from_marketing)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
          <MarketingMetricCard label="Orders from marketing" value={loading ? "-" : formatNumber(summary.marketing_orders)} tone="cyan" icon={<BarChart3 className="h-5 w-5" />} />
          <MarketingMetricCard label="Top converting post" value={loading ? "-" : bestPost?.title || "-"} tone="violet" icon={<CalendarDays className="h-5 w-5" />} />
          <MarketingMetricCard label="Best platform" value={loading ? "-" : bestPlatform?.platform || "-"} tone="amber" icon={<Filter className="h-5 w-5" />} />
          <MarketingMetricCard label="Conversion rate" value={loading ? "-" : formatPercent(summary.conversion_rate)} tone="rose" icon={<RefreshCw className="h-5 w-5" />} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Platform</span>
              <select
                value={filters.platform}
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="all">All platforms</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="story">Story</option>
                <option value="tiktok">TikTok</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">From</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">To</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <Filter className="h-3.5 w-3.5" />
              Filtered view: {payload?.filters?.platform || filters.platform}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Last synced: {formatDateTime(summary.last_synced_at)}
            </span>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-black text-white">Clicks to orders funnel</h2>
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

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-black text-white">Sales over time</h2>
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
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-black text-white">Platform comparison</h2>
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

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-black text-white">Story vs post</h2>
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
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
            <div className="mb-4">
              <h2 className="text-lg font-black text-white">Top posts by sales</h2>
              <p className="text-sm text-slate-400">Best performers in the selected range</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Post</th>
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Platform</th>
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Orders</th>
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Revenue</th>
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Clicks</th>
                    <th className="border-b border-white/10 px-3 py-3 font-semibold">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">Loading attribution...</td>
                    </tr>
                  ) : topRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">No attribution data found yet.</td>
                    </tr>
                  ) : (
                    topRows.map((row) => (
                      <tr key={`${row.platform}-${row.post_id}`} className="align-top">
                        <td className="border-b border-white/5 px-3 py-4">
                          <div className="font-semibold text-white">{row.title || `Post #${row.post_id}`}</div>
                          <div className="text-xs text-slate-400">{row.tracking_kind || "post"} • {row.last_event_at ? formatDateTime(row.last_event_at) : "-"}</div>
                        </td>
                        <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.platform || "-"}</td>
                        <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatNumber(row.orders)}</td>
                        <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatNumber(row.revenue)}</td>
                        <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatNumber(row.clicks)}</td>
                        <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatPercent(row.engagement_rate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
              <h2 className="text-lg font-black text-white">Top campaigns</h2>
              <div className="mt-4 space-y-3">
                {topCampaigns.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">No campaign attribution yet.</div>
                ) : (
                  topCampaigns.slice(0, 6).map((campaign) => (
                    <div key={`${campaign.platform}-${campaign.campaign}`} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <div className="font-semibold text-white">{campaign.campaign || "Unassigned"}</div>
                      <div className="mt-1 text-sm text-slate-400">{campaign.platform || "other"}</div>
                      <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
                        <span>{formatNumber(campaign.orders)} orders</span>
                        <span className="font-semibold text-white">{formatNumber(campaign.revenue)} revenue</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
              <h2 className="text-lg font-black text-white">Revenue per platform</h2>
              <div className="mt-4 space-y-3">
                {platformComparison.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">No platform comparison yet.</div>
                ) : (
                  platformComparison.map((row, index) => (
                    <div key={row.platform || index} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{row.platform || "-"}</div>
                          <div className="text-xs text-slate-400">{formatNumber(row.orders)} orders</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-white">{formatNumber(row.revenue)}</div>
                          <div className="text-xs text-slate-400">{formatPercent(row.conversion_rate)}</div>
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
