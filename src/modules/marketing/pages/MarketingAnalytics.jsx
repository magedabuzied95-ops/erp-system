import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Filter, RefreshCw, Share2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import { getMarketingAnalytics, syncMarketingAnalytics } from "../services/marketingApi";
import MarketingMetricCard from "../components/MarketingMetricCard";
import { hasPermission } from "../../permissions/lib/rbacStore";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
};

export default function MarketingAnalytics() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState(null);
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
      const data = await getMarketingAnalytics({
        platform: filters.platform === "all" ? "" : filters.platform,
        from: filters.from || "",
        to: filters.to || "",
      });
      setAnalytics(data || null);
    } catch (err) {
      setError(err?.message || "Failed to load marketing analytics");
      toast.error(err?.message || "Failed to load marketing analytics");
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
      toast.error("You do not have permission to sync marketing analytics.");
      return;
    }
    setSyncing(true);
    try {
      const result = await syncMarketingAnalytics({
        platform: filters.platform === "all" ? "" : filters.platform,
        from: filters.from || "",
        to: filters.to || "",
      });
      setAnalytics(result || null);
      const syncedCount = result?.sync?.synced ?? 0;
      toast.success(syncedCount ? `Synced ${syncedCount} analytics records` : "Analytics sync completed");
    } catch (err) {
      toast.error(err?.message || "Failed to sync marketing analytics");
    } finally {
      setSyncing(false);
    }
  };

  const summary = analytics?.summary || {};
  const rows = Array.isArray(analytics?.top_posts) ? analytics.top_posts : [];
  const activePlatform = analytics?.filters?.platform || filters.platform;
  const permissionLimited = Number(summary.permission_limited_rows || 0) > 0;
  const syncWarnings = Array.isArray(analytics?.sync?.warnings) ? analytics.sync.warnings : [];

  const topRows = useMemo(() => rows.slice(0, 20), [rows]);

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <BarChart3 className="h-3.5 w-3.5" />
                Marketing analytics
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Facebook and Instagram performance</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">Track post engagement, top performers, and the latest Meta sync status in one workspace.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refresh}
                disabled={syncing || !canSync}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                Sync analytics
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4 text-cyan-300" />
                Refresh view
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
        {permissionLimited ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            Some reach/impressions metrics were skipped because the connected Meta permissions do not expose them for every post.
          </div>
        ) : null}
        {syncWarnings.length ? (
          <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm text-sky-100">
            <div className="font-semibold">Sync notes</div>
            <ul className="mt-2 space-y-1">
              {syncWarnings.slice(0, 3).map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MarketingMetricCard label="Posts tracked" value={loading ? "-" : summary.tracked_posts ?? 0} tone="cyan" icon={<Share2 className="h-5 w-5" />} />
          <MarketingMetricCard label="Likes" value={loading ? "-" : summary.likes ?? 0} tone="emerald" icon={<Sparkles className="h-5 w-5" />} />
          <MarketingMetricCard label="Comments" value={loading ? "-" : summary.comments ?? 0} tone="violet" icon={<BarChart3 className="h-5 w-5" />} />
          <MarketingMetricCard label="Shares" value={loading ? "-" : summary.shares ?? 0} tone="amber" icon={<Share2 className="h-5 w-5" />} />
          <MarketingMetricCard label="Impressions" value={loading ? "-" : summary.impressions ?? 0} tone="slate" icon={<Filter className="h-5 w-5" />} />
          <MarketingMetricCard label="Engagement rate" value={loading ? "-" : formatPercent(summary.engagement_rate)} tone="rose" icon={<CalendarDays className="h-5 w-5" />} />
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
              Filtered view: {activePlatform === "all" ? "All platforms" : activePlatform}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Last synced: {formatDateTime(summary.last_synced_at)}
            </span>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Top posts</h2>
              <p className="text-sm text-slate-400">Posts with the strongest engagement in the selected range</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Post</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Platform</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Likes</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Comments</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Shares</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Reach</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Impressions</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Engagement</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Synced</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">
                      Loading analytics...
                    </td>
                  </tr>
                ) : topRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">
                      No analytics data found yet. Sync published posts first.
                    </td>
                  </tr>
                ) : (
                  topRows.map((row) => (
                    <tr key={`${row.platform}-${row.id}`} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="max-w-[320px] truncate font-semibold text-white" title={row.title || `Post #${row.post_id}`}>
                          {row.title || `Post #${row.post_id}`}
                        </div>
                        <div className="text-xs text-slate-400">{row.platform_post_id || "-"}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.platform || "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.likes ?? 0}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.comments ?? 0}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.shares ?? 0}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.reach ?? "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{row.impressions ?? "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">
                        <div className="font-semibold text-white">{row.engagement}</div>
                        <div className="text-xs text-slate-400">{formatPercent(row.engagement_rate)}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatDateTime(row.synced_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
