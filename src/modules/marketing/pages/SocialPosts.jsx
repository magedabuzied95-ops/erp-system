import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Image as ImageIcon, RefreshCcw, Video } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { getSocialPublisherPosts } from "../services/marketingApi";
import i18n from "../../../i18n/i18n";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const normalizePlatforms = (value) => {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s/]+/)
      : [];

  return Array.from(
      new Set(
        items
          .map((item) => String(item || "").trim().toLowerCase())
        .filter((item) => ["facebook", "instagram", "tiktok"].includes(item))
      )
  );
};

const normalizeMediaType = (post = {}) => {
  const explicit = String(post.media_type || post.mediaType || "").trim().toLowerCase();
  if (explicit === "video") return "video";

  const mediaUrls = [post.media_url, ...(Array.isArray(post.media_urls) ? post.media_urls : [])]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (mediaUrls.some((url) => /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(url))) return "video";
  return "image";
};

const getStatusTone = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "published":
      return "emerald";
    case "scheduled":
      return "cyan";
    case "publishing":
      return "amber";
    case "failed":
      return "rose";
    case "draft":
    default:
      return "slate";
  }
};

const getStatusLabel = (status) => String(status || "").trim().toLowerCase() || "draft";

const Badge = ({ children, tone = "slate", className = "" }) => {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    cyan: "border-primary/20 bg-primary/10 text-primary",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    slate: "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${tones[tone] || tones.slate} ${className}`}
    >
      {children}
    </span>
  );
};

const TIKTOK_PUBLISHING_NOT_CONNECTED_MESSAGE = "TikTok publishing is not connected yet.";
const PUBLISHER_PLATFORMS = [
  { id: "facebook", label: "Facebook", get subtitle() { return tt("marketing.publisher.ready"); }, disabled: false },
  { id: "instagram", label: "Instagram", get subtitle() { return tt("marketing.publisher.ready"); }, disabled: false },
  { id: "tiktok", label: "TikTok", get subtitle() { return tt("marketing.publisher.comingSoon"); }, disabled: true, helper: "Connect TikTok لاحقًا" },
];

function PublisherPlatformCard({ platform }) {
  const disabled = Boolean(platform.disabled);
  return (
    <div
      className={`rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)] ${ disabled ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface)] opacity-70" : "border-[var(--border)] bg-[var(--surface)]" }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-[var(--text)]">{platform.label}</div>
          <div className={`mt-1 text-xs font-bold uppercase tracking-[0.18em] ${disabled ? "text-amber-200" : "text-emerald-200"}`}>{platform.subtitle}</div>
        </div>
        <Badge tone={disabled ? "amber" : "emerald"}>{disabled ? "Disabled" : "Ready"}</Badge>
      </div>
      {platform.helper ? <div className="mt-3 text-sm text-[var(--muted)]">{platform.helper}</div> : null}
    </div>
  );
}

function HistoryRow({ item, t }) {
  const platforms = normalizePlatforms(item.platforms);
  const mediaType = normalizeMediaType(item);
  const scheduledAt = formatDateTime(item.scheduled_at);
  const publishedAt = formatDateTime(item.published_at);
  const status = getStatusLabel(item.status);
  const errorMessage = String(item.error_message || "").trim();
  const caption = String(item.caption || "").trim();
  const platformLabels = {
    facebook: t("marketing.social.platforms.facebook"),
    instagram: t("marketing.social.platforms.instagram"),
    tiktok: t("marketing.social.platforms.tiktok"),
  };

  return (
    // min-w-0: as a grid item its automatic minimum size is its min-content width,
    // which the nowrap caption inflates far past the column. Without this the track
    // resolves to ~3390px inside a ~1174px grid and the overflow is clipped, not scrollable.
    <article className="min-w-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)] transition hover:border-[var(--border)] hover:bg-[var(--surface)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={mediaType === "video" ? "amber" : "cyan"} className="normal-case tracking-normal">
              {mediaType}
            </Badge>
            <Badge tone={getStatusTone(status)} className="normal-case tracking-normal">
              {t(`marketing.posts.status.${status}`, status)}
            </Badge>
            {platforms.length ? (
              platforms.map((platform) => (
                <Badge key={`${item.id}-${platform}`} tone="slate" className="normal-case tracking-normal">
                  {platformLabels[platform] || platform}
                </Badge>
              ))
            ) : (
              <Badge tone="slate" className="normal-case tracking-normal">
                {t("marketing.socialHistory.noPlatforms")}
              </Badge>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm font-black text-[var(--text)]">
            <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--muted)]">#{item.id}</span>
            {/* min-w-0: without it this flex item's min size is the caption's max-content
                width, which defeats truncate and stretches the whole card. */}
            <span className="min-w-0 truncate">{caption || t("marketing.socialHistory.untitled")}</span>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{t("marketing.socialHistory.mediaType")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{mediaType}</div>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{t("marketing.socialHistory.scheduledAt")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{scheduledAt || t("marketing.socialHistory.notAvailable")}</div>
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{t("marketing.socialHistory.publishedAt")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text)]">{publishedAt || t("marketing.socialHistory.notAvailable")}</div>
            </div>
          </div>

          {status === "failed" && errorMessage ? (
            <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-100">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-rose-200">{t("marketing.socialHistory.error")}</div>
              <div className="mt-1 break-words leading-6">{errorMessage}</div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2 lg:items-end">
          <Badge tone={getStatusTone(status)} className="normal-case tracking-normal">
            {t(`marketing.posts.status.${status}`, status)}
          </Badge>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {mediaType === "video" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-100">
                <Video className="h-3.5 w-3.5" />
                {t("marketing.socialHistory.video")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                <ImageIcon className="h-3.5 w-3.5" />
                {t("marketing.socialHistory.image")}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function SocialPosts() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getSocialPublisherPosts({ limit: 20 });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err?.message || t("marketing.socialHistory.loadFailed");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const history = useMemo(() => {
    return [...items]
      .sort((a, b) => {
        const aTime = new Date(a.created_at || a.updated_at || a.scheduled_at || a.published_at || 0).getTime();
        const bTime = new Date(b.created_at || b.updated_at || b.scheduled_at || b.published_at || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 20);
  }, [items]);

  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <Clock3 className="h-3.5 w-3.5" />
                {t("marketing.socialHistory.eyebrow")}
              </div>
              <h1 className="m1-display">{t("marketing.socialHistory.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">{t("marketing.socialHistory.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="slate">{t("marketing.socialHistory.count", { count: history.length })}</Badge>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface)]"
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("marketing.socialHistory.refresh")}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {PUBLISHER_PLATFORMS.map((platform) => (
            <PublisherPlatformCard key={platform.id} platform={platform} />
          ))}
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
          {loading ? (
            <div className="grid min-h-[220px] place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
              <div className="space-y-3">
                <RefreshCcw className="mx-auto h-5 w-5 animate-spin text-primary" />
                <div className="text-sm font-semibold text-[var(--muted)]">{t("marketing.socialHistory.loading")}</div>
              </div>
            </div>
          ) : history.length === 0 ? (
            <div className="grid min-h-[240px] place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
              <div className="max-w-md space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                  <Clock3 className="h-6 w-6" />
                </div>
                <div className="text-lg font-black text-[var(--text)]">{t("marketing.socialHistory.emptyTitle")}</div>
                <p className="text-sm leading-6 text-[var(--muted)]">{t("marketing.socialHistory.emptyDescription")}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {history.map((item) => (
                <HistoryRow key={String(item.id)} item={item} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
