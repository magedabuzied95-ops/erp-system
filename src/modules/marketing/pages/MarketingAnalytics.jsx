import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Filter, RefreshCw, Share2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      setError(err?.message || t("marketing.analytics.loadFailed"));
      toast.error(err?.message || t("marketing.analytics.loadFailed"));
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
      toast.error(t("marketing.analytics.permissionSync"));
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
      toast.success(syncedCount ? t("marketing.analytics.syncedCount", { count: syncedCount }) : t("marketing.analytics.syncCompleted"));
    } catch (err) {
      toast.error(err?.message || t("marketing.analytics.syncFailed"));
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
                {t("marketing.analytics.eyebrow")}
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">{t("marketing.analytics.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">{t("marketing.analytics.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refresh}
                disabled={syncing || !canSync}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {t("marketing.analytics.sync")}
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4 text-cyan-300" />
                {t("marketing.common.refreshView")}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}
        {permissionLimited ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            {t("marketing.analytics.permissionLimited")}
          </div>
        ) : null}
        {syncWarnings.length ? (
          <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm text-sky-100">
            <div className="font-semibold">{t("marketing.analytics.syncNotes")}</div>
            <ul className="mt-2 space-y-1">
              {syncWarnings.slice(0, 3).map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MarketingMetricCard label={t("marketing.analytics.metrics.postsTracked")} value={loading ? "-" : summary.tracked_posts ?? 0} tone="cyan" icon={<Share2 className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.metrics.likes")} value={loading ? "-" : summary.likes ?? 0} tone="emerald" icon={<Sparkles className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.metrics.comments")} value={loading ? "-" : summary.comments ?? 0} tone="violet" icon={<BarChart3 className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.metrics.shares")} value={loading ? "-" : summary.shares ?? 0} tone="amber" icon={<Share2 className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.metrics.impressions")} value={loading ? "-" : summary.impressions ?? 0} tone="slate" icon={<Filter className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.analytics.metrics.engagementRate")} value={loading ? "-" : formatPercent(summary.engagement_rate)} tone="rose" icon={<CalendarDays className="h-5 w-5" />} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.social.platform")}</span>
              <select
                value={filters.platform}
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="all">{t("marketing.social.allPlatforms")}</option>
                <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
                <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.common.from")}</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.common.to")}</span>
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
              {t("marketing.analytics.filteredView", { platform: activePlatform === "all" ? t("marketing.social.allPlatforms") : activePlatform })}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {t("marketing.analytics.lastSynced", { value: formatDateTime(summary.last_synced_at) })}
            </span>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">{t("marketing.analytics.topPosts.title")}</h2>
              <p className="text-sm text-slate-400">{t("marketing.analytics.topPosts.subtitle")}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.table.post")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.social.platform")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.metrics.likes")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.metrics.comments")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.metrics.shares")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.table.reach")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.metrics.impressions")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.table.engagement")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.analytics.table.synced")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">
                      {t("marketing.analytics.loading")}
                    </td>
                  </tr>
                ) : topRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">
                      {t("marketing.analytics.empty")}
                    </td>
                  </tr>
                ) : (
                  topRows.map((row) => (
                    <tr key={`${row.platform}-${row.id}`} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="max-w-[320px] truncate font-semibold text-white" title={row.title || t("marketing.analytics.table.postNumber", { id: row.post_id })}>
                          {row.title || t("marketing.analytics.table.postNumber", { id: row.post_id })}
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
