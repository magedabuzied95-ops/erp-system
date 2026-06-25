import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Camera,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  Send,
  Share2,
  ShieldAlert,
  Upload,
  Video,
  Wand2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  createSocialPublisherPost,
  getSocialPublisherPosts,
  publishSocialPublisherPost,
} from "../services/marketingApi";
import { hasPermission } from "../../permissions/lib/rbacStore";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const platformOptions = [
  { key: "facebook", label: "Facebook", icon: Share2, tone: "blue" },
  { key: "instagram", label: "Instagram", icon: Camera, tone: "pink" },
  {
    key: "tiktok",
    label: "TikTok",
    icon: ShieldAlert,
    tone: "slate",
    disabled: true,
    subtitle: "Coming Soon",
    helper: "Connect TikTok لاحقًا",
  },
];

const statusStyles = {
  draft: "border-white/10 bg-white/5 text-slate-200",
  scheduled: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  published: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  partial_success: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
};

const statusLabel = (value) => {
  const normalized = String(value || "draft").toLowerCase();
  if (normalized === "scheduled") return "Scheduled";
  if (normalized === "published") return "Published";
  if (normalized === "partial_success") return "Partial success";
  if (normalized === "failed") return "Failed";
  return "Draft";
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

export default function SocialMediaPublisher() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState(null);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState([]);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: false, tiktok: false });
  const mediaInputRef = useRef(null);
  const canCreate = hasPermission("marketing.create");
  const canPublish = hasPermission("marketing.publish");

  const selectedPlatforms = useMemo(
    () => platformOptions.filter((platform) => platforms[platform.key] && platform.key !== "tiktok").map((platform) => platform.key),
    [platforms]
  );

  const hasDisabledTikTok = Boolean(platforms.tiktok);

  const historyPosts = useMemo(
    () =>
      [...posts]
        .sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at || a.scheduled_at || a.published_at || 0).getTime();
          const bTime = new Date(b.created_at || b.updated_at || b.scheduled_at || b.published_at || 0).getTime();
          return bTime - aTime;
        })
        .slice(0, 20),
    [posts]
  );

  const loadPosts = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getSocialPublisherPosts({ limit: 20 });
      setPosts(safeArray(data));
    } catch (err) {
      const message = err?.message || "Failed to load social media publisher history";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  useEffect(() => {
    if (!mediaFile) {
      setMediaPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(mediaFile);
    setMediaPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [mediaFile]);

  const resetComposer = () => {
    setCaption("");
    setScheduledAt("");
    setMediaFile(null);
    setMediaType("image");
    setPlatforms({ facebook: true, instagram: false, tiktok: false });
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const handleMediaChange = (event) => {
    const file = event.target.files?.[0] || null;
    setMediaFile(file);
    setMediaType(file?.type?.startsWith("video/") ? "video" : "image");
  };

  const togglePlatform = (key) => {
    if (key === "tiktok") return;
    setPlatforms((current) => ({ ...current, [key]: !current[key] }));
  };

  const blockTikTokPayload = () => {
    if (!hasDisabledTikTok) return false;
    toast.error("TikTok publishing is not connected yet.");
    return true;
  };

  const buildPayload = () => {
    const formData = new FormData();
    formData.append("caption", caption);
    formData.append("platforms", JSON.stringify(selectedPlatforms));
    formData.append("media_type", mediaType);
    if (scheduledAt) {
      formData.append("scheduled_at", scheduledAt);
    }
    if (mediaFile) {
      formData.append("media", mediaFile);
    }
    return formData;
  };

  const handlePublishNow = async () => {
    if (!canCreate || !canPublish) {
      toast.error("You do not have permission to publish");
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error("Select at least one platform");
      return;
    }

    setSaving(true);
    try {
      const created = await createSocialPublisherPost(buildPayload());
      const published = await publishSocialPublisherPost(created.id);
      toast.success(published?.message || "Published successfully");
      resetComposer();
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || "Failed to publish post");
      await loadPosts();
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!canCreate) {
      toast.error("You do not have permission to create marketing posts");
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error("Select at least one platform");
      return;
    }
    if (!scheduledAt) {
      toast.error("Choose a schedule time");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      payload.set("status", "scheduled");
      const saved = await createSocialPublisherPost(payload);
      toast.success("Post scheduled");
      resetComposer();
      await loadPosts();
      return saved;
    } catch (err) {
      toast.error(err?.message || "Failed to schedule post");
    } finally {
      setSaving(false);
    }
  };

  const handlePublishFromHistory = async (post) => {
    if (!canPublish) {
      toast.error("You do not have permission to publish");
      return;
    }
    const platformsWithNoTiktok = safeArray(post.platforms).filter((platform) => String(platform || "").trim().toLowerCase() !== "tiktok");
    if (safeArray(post.platforms).length !== platformsWithNoTiktok.length) {
      toast.error("TikTok publishing is not connected yet.");
      return;
    }
    setPublishingId(post.id);
    try {
      const result = await publishSocialPublisherPost(post.id);
      toast.success(result?.message || "Published successfully");
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || "Failed to publish post");
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_32%),linear-gradient(180deg,#07111f_0%,#050816_100%)] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/25 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">
                <Wand2 className="h-3.5 w-3.5" />
                Marketing
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Social Media Publisher</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Publish manually to Facebook and Instagram, with TikTok marked as coming soon.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Facebook</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Instagram</span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-amber-100">TikTok Coming Soon</span>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black">Create a post</h2>
                <p className="text-sm text-slate-400">Upload media, write a caption, choose platforms, then publish or schedule.</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block rounded-3xl border border-dashed border-white/15 bg-black/20 p-4 transition hover:border-amber-400/30">
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaChange}
                  className="hidden"
                />
                <div className="flex min-h-40 items-center justify-center gap-4 text-center">
                  {mediaPreview ? (
                    mediaType === "video" ? (
                      <video src={mediaPreview} controls className="max-h-60 w-full max-w-2xl rounded-2xl object-contain bg-black" />
                    ) : (
                      <img src={mediaPreview} alt="Selected media preview" className="max-h-60 w-full max-w-2xl rounded-2xl object-contain bg-black" />
                    )
                  ) : (
                    <div className="space-y-2 text-slate-300">
                      <ImageIcon className="mx-auto h-10 w-10 text-amber-200" />
                      <div className="text-sm font-semibold">Upload image or video</div>
                      <div className="text-xs text-slate-500">Click to select media from your device</div>
                    </div>
                  )}
                </div>
              </label>

              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">Caption</span>
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={10}
                    placeholder="Write your post caption..."
                    className="min-h-56 w-full rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400/40"
                  />
                </label>

                <div className="space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <Send className="h-4 w-4 text-amber-200" />
                      Platforms
                    </div>
                    <div className="space-y-3">
                      {platformOptions.map((platform) => {
                        const Icon = platform.icon;
                        const checked = Boolean(platforms[platform.key]);
                        return (
                          <button
                            key={platform.key}
                            type="button"
                            disabled={Boolean(platform.disabled)}
                            onClick={() => togglePlatform(platform.key)}
                            className={[
                              "flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-start transition",
                              platform.disabled
                                ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-500"
                                : checked
                                  ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                  : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]",
                            ].join(" ")}
                          >
                            <span className="flex min-w-0 flex-1 items-start gap-2">
                              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                              <span className="min-w-0 space-y-0.5">
                                <span className="block text-sm font-semibold">{platform.label}</span>
                                {platform.disabled ? <span className="block text-xs text-slate-400">{platform.helper}</span> : null}
                              </span>
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                              {platform.disabled ? platform.subtitle : checked ? "Selected" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <Video className="h-4 w-4 text-amber-200" />
                      Media details
                    </div>
                    <div className="space-y-2 text-sm text-slate-300">
                      <div className="flex items-center justify-between">
                        <span>Type</span>
                        <span className="font-semibold text-white">{mediaFile ? mediaType : "none"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Platforms</span>
                        <span className="font-semibold text-white">{selectedPlatforms.length ? selectedPlatforms.join(", ") : "-"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Status</span>
                        <span className="font-semibold text-white">Draft</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">Schedule</span>
                  <div className="relative">
                    <CalendarClock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-amber-400/40"
                    />
                  </div>
                </label>

              </div>

              <div className="sticky bottom-0 z-20 mt-2 grid grid-cols-2 gap-2 border-t border-white/10 bg-[#07111f]/96 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-4 backdrop-blur md:static md:flex md:items-center md:justify-end md:gap-3 md:bg-transparent md:px-0 md:pb-0 md:pt-4">
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={saving || !canCreate || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  Schedule
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publish Now
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-100">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black">{t("marketing.socialHistory.title")}</h2>
                  <p className="text-sm text-slate-400">{t("marketing.socialHistory.subtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadPosts}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("marketing.socialHistory.refresh")}
              </button>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                  {t("marketing.socialHistory.loading")}
                </div>
              ) : historyPosts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                  {t("marketing.socialHistory.emptyDescription")}
                </div>
              ) : (
                historyPosts.map((post) => {
                  const previewLabel = post.media_type === "video" ? t("marketing.socialHistory.video") : t("marketing.socialHistory.image");
                  const isBusy = publishingId === post.id;
                  const canPublishAgain = post.status === "draft" || post.status === "failed" || post.status === "scheduled" || post.status === "partial_success";
                  return (
                    <article key={post.id} className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 gap-3">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300">
                            {post.media_url ? (
                              post.media_type === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />
                            ) : (
                              <ImageIcon className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                {previewLabel}
                              </span>
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusStyles[post.status] || statusStyles.draft}`}>
                                {statusLabel(post.status)}
                              </span>
                            </div>
                            <p className="line-clamp-3 text-sm leading-6 text-slate-100">{post.caption || t("marketing.socialHistory.untitled")}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                              {safeArray(post.platforms).map((platform) => (
                                <span key={platform} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                                  {platform}
                                </span>
                              ))}
                              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                                Created {formatDateTime(post.created_at)}
                              </span>
                              {post.scheduled_at ? <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Scheduled {formatDateTime(post.scheduled_at)}</span> : null}
                              {post.published_at ? <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Published {formatDateTime(post.published_at)}</span> : null}
                            </div>
                            {post.error_message ? (
                              <div className="flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{post.error_message}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                          {canPublishAgain ? (
                            <button
                              type="button"
                              onClick={() => handlePublishFromHistory(post)}
                              disabled={isBusy || !canPublish}
                              className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-3 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              Publish
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
