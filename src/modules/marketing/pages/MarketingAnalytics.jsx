import { useCallback, useEffect, useState } from "react";
import { BarChart3, CalendarDays, Filter, RefreshCw, Share2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { getMarketingAnalytics, getSocialPublisherPosts, syncMarketingAnalytics } from "../services/marketingApi";
import MarketingMetricCard from "../components/MarketingMetricCard";
import MarketingStudioHeader from "../components/MarketingStudioHeader";
import MarketingCampaignAnalyticsPanel from "../components/MarketingCampaignAnalyticsPanel";
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
  const [postsLoading, setPostsLoading] = useState(true);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [publisherPosts, setPublisherPosts] = useState([]);
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

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const rows = await getSocialPublisherPosts({ limit: 50 });
      setPublisherPosts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setPublisherPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPosts]);

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

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[#0c0d0c] text-white">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-7 px-4 py-6 md:px-6 lg:px-8 2xl:px-10 2xl:py-8">
        <MarketingStudioHeader size="large" />
        <section className="rounded-[2rem] border border-amber-300/25 bg-[#171815] p-6 shadow-2xl shadow-black/30 md:p-7 2xl:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                <BarChart3 className="h-3.5 w-3.5" />
                {t("marketing.analytics.eyebrow")}
              </div>
              <h1 className="text-4xl font-black tracking-tight md:text-5xl">{t("marketing.analytics.title")}</h1>
              <p className="max-w-4xl text-base leading-7 text-slate-300">{t("marketing.analytics.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refresh}
                disabled={syncing || !canSync}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-amber-300/35 bg-amber-300/10 px-5 py-3 text-base font-bold text-amber-100 transition hover:bg-amber-300/20 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {t("marketing.analytics.sync")}
              </button>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.07] px-5 py-3 text-base font-bold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4 text-amber-300" />
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
          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            <div className="font-semibold">{t("marketing.analytics.syncNotes")}</div>
            <ul className="mt-2 space-y-1">
              {syncWarnings.slice(0, 3).map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.postsTracked")} value={loading ? "-" : summary.tracked_posts ?? 0} tone="amber" icon={<Share2 className="h-6 w-6" />} />
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.likes")} value={loading ? "-" : summary.likes ?? 0} tone="amber" icon={<Sparkles className="h-6 w-6" />} />
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.comments")} value={loading ? "-" : summary.comments ?? 0} tone="amber" icon={<BarChart3 className="h-6 w-6" />} />
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.shares")} value={loading ? "-" : summary.shares ?? 0} tone="amber" icon={<Share2 className="h-6 w-6" />} />
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.impressions")} value={loading ? "-" : summary.impressions ?? 0} tone="amber" icon={<Filter className="h-6 w-6" />} />
          <MarketingMetricCard size="large" label={t("marketing.analytics.metrics.engagementRate")} value={loading ? "-" : formatPercent(summary.engagement_rate)} tone="amber" icon={<CalendarDays className="h-6 w-6" />} />
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#191a18] p-6 shadow-2xl shadow-black/25 md:p-7">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.social.platform")}</span>
              <select
                value={filters.platform}
                onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
                className="min-h-13 w-full rounded-2xl border border-white/15 bg-[#10110f] px-4 py-3 text-base text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
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
                className="min-h-13 w-full rounded-2xl border border-white/15 bg-[#10110f] px-4 py-3 text-base text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("marketing.common.to")}</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                className="min-h-13 w-full rounded-2xl border border-white/15 bg-[#10110f] px-4 py-3 text-base text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
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

        <MarketingCampaignAnalyticsPanel
          summary={{
            published: summary.published_posts ?? summary.published ?? 0,
            scheduled: summary.scheduled_posts ?? summary.scheduled ?? 0,
            drafts: summary.draft_posts ?? summary.drafts ?? 0,
            firstCommentPublished: summary.first_comment_published ?? 0,
            firstCommentFailed: summary.first_comment_failed ?? 0,
            firstCommentSkipped: summary.first_comment_skipped ?? 0,
          }}
          posts={publisherPosts}
          topPosts={rows}
          loading={loading || postsLoading}
          onRefresh={load}
        />
      </div>
    </div>
  );
}
