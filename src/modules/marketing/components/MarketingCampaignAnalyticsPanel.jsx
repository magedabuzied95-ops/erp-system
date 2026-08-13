import { useEffect, useMemo, useState } from "react";
import { Activity, Eye, RefreshCcw, Repeat2, Share2, Trash2, CalendarDays, BarChart3, Filter, Sparkles, Copy, ImageIcon, Play } from "lucide-react";
import toast from "react-hot-toast";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const formatRelativeDayLabel = (date) => {
  if (!date) return "-";
  const today = new Date();
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return "-";
  const diff = Math.floor((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(target);
};

const getTimestamp = (post = {}) => {
  const value = post.published_at || post.scheduled_at || post.created_at || post.updated_at || post.timestamp || null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const getPrimaryPlatformLabel = (post = {}) => {
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  if (platforms.length) return platforms[0];
  return post.platform || post.channel || post.network || "-";
};

const deriveTemplateLabel = (post = {}) => {
  if (post.template_name) return post.template_name;
  if (post.template) return post.template;
  if (post.post_type) return post.post_type;
  return `Post #${post.id ?? "-"}`;
};

const firstMediaValue = (value) => {
  if (Array.isArray(value)) return value.find((item) => String(item || "").trim()) || "";
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      return firstMediaValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return value || "";
};

const getPostMediaUrl = (post = {}) =>
  resolveProductImageUrl(
    post.media_url ||
      post.image_url ||
      post.primary_image_url ||
      post.thumbnail_url ||
      firstMediaValue(post.media_urls) ||
      post.metadata?.media_url ||
      post.metadata?.image_url ||
      ""
  );

function PostMediaPreview({ post, className = "" }) {
  const mediaUrl = getPostMediaUrl(post);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [mediaUrl]);

  if (!mediaUrl || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-[var(--card)] text-center text-[var(--muted)] ${className}`}>
        <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <ImageIcon className="h-6 w-6" />
        </span>
        <span className="px-3 text-xs font-semibold">No post image</span>
      </div>
    );
  }

  if (String(post.media_type || "").toLowerCase() === "video") {
    return (
      <div className={`relative overflow-hidden bg-black ${className}`}>
        <video src={mediaUrl} muted playsInline preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        <span className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] backdrop-blur">
          <Play className="h-5 w-5 fill-current" />
        </span>
      </div>
    );
  }

  return <img src={mediaUrl} alt={deriveTemplateLabel(post)} loading="lazy" onError={() => setFailed(true)} className={`bg-[var(--card)] object-cover ${className}`} />;
}

const getHistoryStatusDetails = (status, errorMessage = "") => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "published") {
    return { label: "Published ✓", toneClass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100", detail: "" };
  }
  if (normalized === "scheduled") {
    return { label: "Scheduled", toneClass: "border-amber-400/20 bg-amber-400/10 text-amber-100", detail: "" };
  }
  if (normalized === "failed") {
    return { label: "Failed", toneClass: "border-rose-400/20 bg-rose-400/10 text-rose-100", detail: String(errorMessage || "Unknown reason").trim() };
  }
  if (normalized === "skipped") {
    return { label: "Skipped", toneClass: "border-slate-400/20 bg-slate-400/10 text-[var(--text)]", detail: String(errorMessage || "").trim() };
  }
  return { label: normalized || "Draft", toneClass: "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]", detail: "" };
};

const buildPostCountsByDay = (posts = []) => {
  const dayMap = new Map();
  const now = new Date();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    dayMap.set(key, {
      key,
      label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
      total: 0,
    });
  }
  posts.forEach((post) => {
    const timestamp = getTimestamp(post);
    if (!timestamp) return;
    const key = new Date(timestamp).toISOString().slice(0, 10);
    if (dayMap.has(key)) {
      dayMap.get(key).total += 1;
    }
  });
  return Array.from(dayMap.values());
};

function HistoryActionButton({ children, tone = "neutral", ...props }) {
  const toneClass =
    tone === "danger"
      ? "border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
      : tone === "primary"
        ? "bg-amber-400 font-black text-slate-950 hover:bg-amber-300"
        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export default function MarketingCampaignAnalyticsPanel({
  summary = {},
  posts = [],
  topPosts = [],
  loading = false,
  onRefresh,
}) {
  const [visiblePosts, setVisiblePosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    setVisiblePosts(Array.isArray(posts) ? posts : []);
  }, [posts]);

  const analyticsCounts = useMemo(() => {
    const counts = {
      published: 0,
      scheduled: 0,
      drafts: 0,
      firstCommentPublished: 0,
      firstCommentFailed: 0,
      firstCommentSkipped: 0,
    };
    visiblePosts.forEach((post) => {
      const status = String(post.status || "draft").toLowerCase();
      if (status === "published") counts.published += 1;
      else if (status === "scheduled") counts.scheduled += 1;
      else counts.drafts += 1;
      const firstCommentStatus = String(
        post.first_comment_status || (String(post.first_comment || "").trim() ? (status === "published" ? "published" : status) : "skipped")
      )
        .trim()
        .toLowerCase();
      if (firstCommentStatus === "published") counts.firstCommentPublished += 1;
      else if (firstCommentStatus === "failed") counts.firstCommentFailed += 1;
      else counts.firstCommentSkipped += 1;
    });
    return counts;
  }, [visiblePosts]);

  const postsByDay = useMemo(() => buildPostCountsByDay(visiblePosts), [visiblePosts]);
  const maxPostsPerDay = Math.max(1, ...postsByDay.map((item) => item.total));
  const timelineItems = useMemo(
    () =>
      visiblePosts
        .slice(0, 8)
        .map((post) => {
          const timestamp = getTimestamp(post);
          const status = getHistoryStatusDetails(post.status, post.error_message);
          const firstCommentStatus = getHistoryStatusDetails(
            post.first_comment_status || (String(post.first_comment || "").trim() ? post.status : "skipped"),
            post.first_comment_error || (String(post.first_comment || "").trim() && String(post.status || "").toLowerCase() === "failed" ? post.error_message : "")
          );
          return {
            id: post.id,
            timestamp,
            dayLabel: timestamp ? formatRelativeDayLabel(new Date(timestamp)) : "-",
            time: timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)) : "-",
            platform: getPrimaryPlatformLabel(post),
            statusLabel: status.label,
            statusKey: String(post.status || "draft").toLowerCase(),
            firstCommentStatusKey: String(
              post.first_comment_status ||
                (String(post.first_comment || "").trim() ? (String(post.status || "").toLowerCase() === "published" ? "published" : String(post.status || "draft").toLowerCase()) : "skipped")
            )
              .trim()
              .toLowerCase(),
            firstCommentStatusLabel: firstCommentStatus.label,
            hasFirstComment: Boolean(String(post.first_comment || "").trim()),
          };
        })
        .filter((item) => item.id),
    [visiblePosts]
  );

  const topRows = useMemo(() => (Array.isArray(topPosts) ? topPosts.slice(0, 20) : []), [topPosts]);

  const removeFromView = (post) => {
    setVisiblePosts((current) => current.filter((item) => String(item.id) !== String(post.id)));
  };

  const handleDuplicate = (post) => {
    toast.success(`Duplicated ${deriveTemplateLabel(post)} in view only.`);
  };

  const handleRepublish = (post) => {
    toast.success(`Open ${deriveTemplateLabel(post)} in Publisher to republish.`);
  };

  return (
    <section className="space-y-6 rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] md:p-6 2xl:p-7">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-2 text-amber-200">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="m1-section-title text-[var(--text)]">Campaign Analytics</h2>
            <p className="text-base text-[var(--muted)]">Overview, timeline, history, and top posts.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-[var(--control-height-lg)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-base font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.5rem] border border-emerald-400/25 bg-emerald-400/12 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100">Published</div>
          <div className="mt-3 text-4xl font-black text-[var(--text)]">{loading ? "-" : summary.published ?? analyticsCounts.published}</div>
          <div className="mt-1 text-xs text-emerald-100/80">Number of published posts.</div>
        </div>
        <div className="rounded-[1.5rem] border border-amber-400/25 bg-amber-400/12 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-100">Scheduled</div>
          <div className="mt-3 text-4xl font-black text-[var(--text)]">{loading ? "-" : summary.scheduled ?? analyticsCounts.scheduled}</div>
          <div className="mt-1 text-xs text-amber-100/80">Posts queued for later.</div>
        </div>
        <div className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Drafts</div>
          <div className="mt-3 text-4xl font-black text-[var(--text)]">{loading ? "-" : summary.drafts ?? analyticsCounts.drafts}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">Draft content in progress.</div>
        </div>
        <div className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">First Comments</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[var(--text)]">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-2 py-2">
              <div className="text-lg font-black">{loading ? "-" : summary.firstCommentPublished ?? analyticsCounts.firstCommentPublished}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-100">Published</div>
            </div>
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-2 py-2">
              <div className="text-lg font-black">{loading ? "-" : summary.firstCommentFailed ?? analyticsCounts.firstCommentFailed}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-rose-100">Failed</div>
            </div>
            <div className="rounded-2xl border border-slate-400/20 bg-slate-400/10 px-2 py-2">
              <div className="text-lg font-black">{loading ? "-" : summary.firstCommentSkipped ?? analyticsCounts.firstCommentSkipped}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text)]">Skipped</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.85fr)]">
        <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-[var(--muted)]">Charts</div>
              <div className="text-xs text-[var(--muted)]">Last 30 days</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
              Total
            </div>
          </div>
          <div className="mt-4">
            <div className="grid grid-cols-7 gap-2">
              {postsByDay.map((day) => {
                const height = Math.max(8, Math.round((day.total / maxPostsPerDay) * 112));
                return (
                  <div key={day.key} className="flex min-w-0 flex-col items-center gap-2">
                    <div className="flex h-[112px] w-full items-end justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-1 py-2">
                      <div
                        className="w-full rounded-t-2xl bg-gradient-to-t from-amber-600 via-amber-400 to-yellow-200 shadow-lg shadow-amber-500/15"
                        style={{ height: `${height}px` }}
                        title={`${day.label}: ${day.total}`}
                      />
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{day.label}</div>
                    <div className="text-[10px] text-[var(--muted)]">{day.total}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-300" />
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-[var(--muted)]">Timeline</div>
              <div className="text-xs text-[var(--muted)]">Recent publishing activity</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {timelineItems.length ? (
              timelineItems.map((item) => (
                <div key={item.id} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                      {item.dayLabel} · {item.time}
                    </div>
                    <div className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text)]">
                      {item.platform}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getHistoryStatusDetails(item.statusKey).toneClass}`}>
                      {item.statusLabel}
                    </span>
                    {item.hasFirstComment ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                        {item.firstCommentStatusKey === "published"
                          ? "First Comment Published"
                          : item.firstCommentStatusKey === "failed"
                            ? "First Comment Failed"
                            : item.firstCommentStatusKey === "skipped"
                              ? "First Comment Skipped"
                              : `First Comment ${item.firstCommentStatusLabel}`}
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text)]">
                        First Comment Skipped
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">No activity yet.</div>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5 md:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-200">
              <ImageIcon className="h-3.5 w-3.5" />
              Published content
            </div>
            <h3 className="m1-section-title text-[var(--text)]">Post History</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Creative, caption, first comment, and publishing status in one place.</p>
          </div>
          <div className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">{visiblePosts.length} posts</div>
        </div>

        {visiblePosts.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">No history yet.</div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {visiblePosts.slice(0, 20).map((post) => {
                const statusDetails = getHistoryStatusDetails(post.status, post.error_message);
                const firstCommentStatus = getHistoryStatusDetails(
                  post.first_comment_status || (String(post.first_comment || "").trim() ? post.status : "skipped"),
                  post.first_comment_error || (String(post.first_comment || "").trim() && String(post.status || "").toLowerCase() === "failed" ? post.error_message : "")
                );
                const publishedAtLabel = post.published_at ? formatDateTime(post.published_at) : post.scheduled_at ? formatDateTime(post.scheduled_at) : "-";
                return (
                  <article key={post.id} className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
                    <PostMediaPreview post={post} className="mb-4 h-56 w-full rounded-2xl" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--text)]">{getPrimaryPlatformLabel(post)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">{deriveTemplateLabel(post)}</div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusDetails.toneClass}`}>
                        {statusDetails.label}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Caption Preview</div>
                        <div className="mt-2 line-clamp-3 break-words text-sm leading-6 text-[var(--text)]">{post.caption || "No caption yet"}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Comment Preview</div>
                        <div className="mt-2 line-clamp-3 break-words text-sm leading-6 text-[var(--text)]">{String(post.first_comment || "").trim() || "-"}</div>
                        <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${firstCommentStatus.toneClass}`}>
                          {String(post.first_comment || "").trim() && firstCommentStatus.label === "Published ✓" ? "✓ First Comment" : firstCommentStatus.label}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Published</div>
                        <div className="mt-2 text-sm font-semibold text-[var(--text)]">{publishedAtLabel}</div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Actions</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <HistoryActionButton onClick={() => setSelectedPost(post)}>
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </HistoryActionButton>
                          <HistoryActionButton onClick={() => handleDuplicate(post)}>
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                          </HistoryActionButton>
                          <HistoryActionButton tone="danger" onClick={() => removeFromView(post)}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </HistoryActionButton>
                          <HistoryActionButton tone="primary" onClick={() => handleRepublish(post)}>
                            <Repeat2 className="h-3.5 w-3.5" />
                            Republish
                          </HistoryActionButton>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="m1-table-container hidden overflow-x-auto md:block">
              <table className="m1-table m1-table--compact m1-table--separate min-w-[1280px] table-fixed border-separate">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    <th className="w-[14%] px-3">Creative</th>
                    <th className="w-[11%] px-3">Platform</th>
                    <th className="w-[14%] px-3">Template</th>
                    <th className="w-[12%] px-3">Status</th>
                    <th className="w-[19%] px-3">Caption</th>
                    <th className="w-[17%] px-3">First Comment</th>
                    <th className="w-[10%] px-3">Published</th>
                    <th className="w-[14%] px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePosts.slice(0, 20).map((post) => {
                    const statusDetails = getHistoryStatusDetails(post.status, post.error_message);
                    const firstCommentStatus = getHistoryStatusDetails(
                      post.first_comment_status || (String(post.first_comment || "").trim() ? post.status : "skipped"),
                      post.first_comment_error || (String(post.first_comment || "").trim() && String(post.status || "").toLowerCase() === "failed" ? post.error_message : "")
                    );
                    const publishedAtLabel = post.published_at ? formatDateTime(post.published_at) : post.scheduled_at ? formatDateTime(post.scheduled_at) : "-";
                    return (
                      <tr key={post.id} className="align-top">
                        <td className="px-3">
                          <div className="overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[var(--shadow-card)]">
                            <PostMediaPreview post={post} className="h-32 w-full rounded-2xl" />
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="truncate text-sm font-semibold text-[var(--text)]" title={getPrimaryPlatformLabel(post)}>
                              {getPrimaryPlatformLabel(post)}
                            </div>
                            <div className="mt-2 text-xs text-[var(--muted)]">{post.media_type || "image"}</div>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="truncate text-sm font-semibold text-[var(--text)]" title={deriveTemplateLabel(post)}>
                              {deriveTemplateLabel(post)}
                            </div>
                            <div className="mt-1 text-xs text-[var(--muted)]">Content template snapshot</div>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusDetails.toneClass}`}>
                              {statusDetails.label}
                            </span>
                            {statusDetails.detail ? <div className="mt-2 break-words text-xs leading-5 text-rose-200">{statusDetails.detail}</div> : null}
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="line-clamp-3 break-words text-sm leading-6 text-[var(--text)]" title={post.caption || ""}>
                              {post.caption || "No caption yet"}
                            </div>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="line-clamp-3 break-words text-sm leading-6 text-[var(--text)]" title={String(post.first_comment || "").trim()}>
                              {String(post.first_comment || "").trim() || "-"}
                            </div>
                            <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${firstCommentStatus.toneClass}`}>
                              {String(post.first_comment || "").trim() && firstCommentStatus.label === "Published ✓" ? "✓ First Comment" : firstCommentStatus.label}
                            </div>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">
                            <div className="truncate" title={publishedAtLabel}>
                              {publishedAtLabel}
                            </div>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3">
                            <div className="flex flex-wrap gap-2">
                              <HistoryActionButton onClick={() => setSelectedPost(post)}>
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </HistoryActionButton>
                              <HistoryActionButton onClick={() => handleDuplicate(post)}>
                                <Copy className="h-3.5 w-3.5" />
                                Duplicate
                              </HistoryActionButton>
                              <HistoryActionButton tone="danger" onClick={() => removeFromView(post)}>
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </HistoryActionButton>
                              <HistoryActionButton tone="primary" onClick={() => handleRepublish(post)}>
                                <Repeat2 className="h-3.5 w-3.5" />
                                Republish
                              </HistoryActionButton>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-300" />
          <div>
            <div className="text-sm font-black uppercase tracking-[0.18em] text-[var(--muted)]">Top Posts</div>
            <div className="text-xs text-[var(--muted)]">Best performing posts from analytics</div>
          </div>
        </div>
        <div className="m1-table-container overflow-x-auto">
          <table className="m1-table m1-table--compact min-w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Post</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Platform</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Likes</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Comments</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Shares</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Reach</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Impressions</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Engagement</th>
                <th className="border-b border-[var(--border)] px-3 py-3 font-semibold">Synced</th>
              </tr>
            </thead>
            <tbody>
              {topRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                    No top posts available.
                  </td>
                </tr>
              ) : (
                topRows.map((row) => (
                  <tr key={`${row.platform}-${row.id}`} className="align-top">
                    <td className="border-b border-[var(--border)] px-3 py-4">
                      <div className="max-w-[320px] truncate font-semibold text-[var(--text)]" title={row.title || `Post #${row.post_id}`}>
                        {row.title || `Post #${row.post_id}`}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{row.platform_post_id || "-"}</div>
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.platform || "-"}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.likes ?? 0}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.comments ?? 0}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.shares ?? 0}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.reach ?? "-"}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{row.impressions ?? "-"}</td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">
                      <div className="font-semibold text-[var(--text)]">{row.engagement}</div>
                      <div className="text-xs text-[var(--muted)]">{row.engagement_rate ? `${Number(row.engagement_rate).toFixed(1)}%` : "-"}</div>
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">{formatDateTime(row.synced_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedPost ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)] p-4 backdrop-blur-sm" role="presentation" onClick={() => setSelectedPost(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Campaign post details"
            className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-[var(--shadow-card)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 md:px-6">
              <div className="min-w-0">
                <div className="text-sm font-black uppercase tracking-[0.22em] text-amber-100">View</div>
                <div className="text-xs text-[var(--muted)]">{deriveTemplateLabel(selectedPost)}</div>
              </div>
              <button type="button" onClick={() => setSelectedPost(null)} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]">
                Close
              </button>
            </div>
            <div className="max-h-[78vh] overflow-y-auto p-4 md:p-6">
              <PostMediaPreview post={selectedPost} className="mb-4 h-72 w-full rounded-[var(--radius-card)] md:h-96" />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Platform</div>
                  <div className="mt-2 text-sm font-semibold text-[var(--text)]">{getPrimaryPlatformLabel(selectedPost)}</div>
                </div>
                <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Status</div>
                  <div className="mt-2 text-sm font-semibold text-[var(--text)]">{String(selectedPost.status || "draft")}</div>
                </div>
                <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 md:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Caption</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{selectedPost.caption || "No caption yet"}</div>
                </div>
                <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 md:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">First Comment</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{String(selectedPost.first_comment || "").trim() || "-"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
