import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Bot, CalendarClock, CalendarDays, Megaphone, Pencil, Settings2, Share2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { getMarketingDashboard } from "../services/marketingApi";
import MarketingMetricCard from "../components/MarketingMetricCard";
import { hasPermission } from "../../permissions/lib/rbacStore";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function MarketingDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getMarketingDashboard();
        if (active) setPayload(data);
      } catch (err) {
        if (active) {
          setError(err?.message || t("marketing.dashboard.loadFailed"));
          toast.error(err?.message || t("marketing.dashboard.loadFailed"));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const metrics = payload?.metrics || {};
  const recentPosts = Array.isArray(payload?.recent_posts) ? payload.recent_posts : [];

  const quickActions = [
    { label: t("marketing.dashboard.quickActions.createPost"), to: "/marketing/posts", icon: Pencil, permission: "marketing.create" },
    { label: t("marketing.dashboard.quickActions.socialCalendar"), to: "/marketing/social-calendar", icon: CalendarDays, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.socialPublisher", { defaultValue: "Social Media Publisher" }), to: "/marketing/social-media-publisher", icon: Megaphone, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.createCampaign"), to: "/marketing/campaigns", icon: CalendarClock, permission: "marketing.create" },
    { label: t("marketing.dashboard.quickActions.analytics"), to: "/marketing/analytics", icon: BarChart3, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.attribution"), to: "/marketing/attribution", icon: Sparkles, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.autoReplies"), to: "/marketing/automation", icon: Bot, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.templates"), to: "/marketing/templates", icon: Share2, permission: "marketing.view" },
    { label: t("marketing.dashboard.quickActions.settings"), to: "/marketing/settings", icon: Settings2, permission: "marketing.settings" },
  ].filter((action) => hasPermission(action.permission));

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <Megaphone className="h-3.5 w-3.5" />
                {t("marketing.dashboard.eyebrow")}
              </div>
              <h1 className="m1-display">{t("marketing.dashboard.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">{t("marketing.dashboard.subtitle")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickActions.map(({ label, to, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => navigate(to)}
                  className="inline-flex min-w-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MarketingMetricCard label={t("marketing.dashboard.metrics.totalPosts")} value={loading ? "-" : metrics.total_posts ?? 0} tone="violet" icon={<Megaphone className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.dashboard.metrics.scheduled")} value={loading ? "-" : metrics.scheduled_posts ?? 0} tone="cyan" icon={<CalendarClock className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.dashboard.metrics.published")} value={loading ? "-" : metrics.published_posts ?? 0} tone="emerald" icon={<Share2 className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.dashboard.metrics.failed")} value={loading ? "-" : metrics.failed_posts ?? 0} tone="rose" icon={<Sparkles className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.dashboard.metrics.activeCampaigns")} value={loading ? "-" : metrics.active_campaigns ?? 0} tone="amber" icon={<CalendarClock className="h-5 w-5" />} />
          <MarketingMetricCard label={t("marketing.dashboard.metrics.drafts")} value={loading ? "-" : metrics.draft_posts ?? 0} tone="slate" icon={<Pencil className="h-5 w-5" />} />
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="m1-section-title text-[var(--text)]">{t("marketing.dashboard.recent.title")}</h2>
              <p className="text-sm text-[var(--muted)]">{t("marketing.dashboard.recent.subtitle")}</p>
            </div>
          </div>
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-full">
              <thead>
                <tr className="text-start text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.dashboard.recent.titleHeader")}</th>
                  <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.posts.headers.channel")}</th>
                  <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.posts.headers.status")}</th>
                  <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.dashboard.recent.campaign")}</th>
                  <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">{t("marketing.posts.headers.scheduled")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-[var(--muted)]">{t("marketing.dashboard.recent.loading")}</td>
                  </tr>
                ) : recentPosts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-[var(--muted)]">{t("marketing.dashboard.recent.empty")}</td>
                  </tr>
                ) : (
                  recentPosts.map((post) => (
                    <tr key={String(post.id)} className="align-top">
                      <td className="border-b border-[var(--border)] px-3 py-4">
                        <div className="font-semibold text-[var(--text)]">{post.title || t("marketing.posts.untitled")}</div>
                        <div className="text-xs text-[var(--muted)]">{post.product_name || post.template_name || "-"}</div>
                      </td>
                      <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{post.channel || "-"}</td>
                      <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{post.status || "-"}</td>
                      <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{post.campaign_name || "-"}</td>
                      <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatDateTime(post.scheduled_at)}</td>
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
