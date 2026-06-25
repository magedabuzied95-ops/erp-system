import { createPortal } from "react-dom";
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
  { key: "facebook", labelKey: "marketing.social.platforms.facebook", icon: Share2, tone: "blue" },
  { key: "instagram", labelKey: "marketing.social.platforms.instagram", icon: Camera, tone: "pink" },
  {
    key: "tiktok",
    labelKey: "marketing.social.platforms.tiktok",
    icon: ShieldAlert,
    tone: "slate",
    disabled: true,
    subtitleKey: "marketing.socialPublisher.tiktokComingSoon",
    helperKey: "marketing.socialPublisher.connectTikTokLater",
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
  const [createSource, setCreateSource] = useState("device");
  const [previewOpen, setPreviewOpen] = useState(false);
  const mediaInputRef = useRef(null);
  const canCreate = hasPermission("marketing.create");
  const canPublish = hasPermission("marketing.publish");
  const previewTitle = caption.trim() || "Your caption will appear here";
  const previewSubtitle = mediaFile ? `${mediaType.toUpperCase()} ready` : "No media selected";

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
    setCreateSource("device");
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
    toast.error(t("marketing.socialPublisher.tiktokNotConnected"));
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
      toast.error(t("marketing.common.permissionPublish"));
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error(t("marketing.socialPublisher.selectAtLeastOnePlatform"));
      return;
    }

    setSaving(true);
    try {
      const created = await createSocialPublisherPost(buildPayload());
      const published = await publishSocialPublisherPost(created.id);
      toast.success(published?.message || t("marketing.socialPublisher.publishedSuccessfully"));
      resetComposer();
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.publishFailed"));
      await loadPosts();
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!canCreate) {
      toast.error(t("marketing.common.permissionCreate"));
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error(t("marketing.socialPublisher.selectAtLeastOnePlatform"));
      return;
    }
    if (!scheduledAt) {
      toast.error(t("marketing.socialPublisher.chooseScheduleTime"));
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      payload.set("status", "scheduled");
      const saved = await createSocialPublisherPost(payload);
      toast.success(t("marketing.socialPublisher.postScheduled"));
      resetComposer();
      await loadPosts();
      return saved;
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.scheduleFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handlePublishFromHistory = async (post) => {
    if (!canPublish) {
      toast.error(t("marketing.common.permissionPublish"));
      return;
    }
    const platformsWithNoTiktok = safeArray(post.platforms).filter((platform) => String(platform || "").trim().toLowerCase() !== "tiktok");
    if (safeArray(post.platforms).length !== platformsWithNoTiktok.length) {
      toast.error(t("marketing.socialPublisher.tiktokNotConnected"));
      return;
    }
    setPublishingId(post.id);
    try {
      const result = await publishSocialPublisherPost(post.id);
      toast.success(result?.message || t("marketing.socialPublisher.publishedSuccessfully"));
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.publishFailed"));
    } finally {
      setPublishingId(null);
    }
  };

  const renderPreviewCard = (platformName, accentClass, platformHint) => (
    <article className={`min-h-[560px] rounded-[2rem] border ${accentClass} bg-slate-950/70 p-5 shadow-xl shadow-black/20`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-black text-white">{platformName}</div>
          <div className="text-xs text-slate-400">{platformHint}</div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
          Preview
        </span>
      </div>
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/40">
        <div className="aspect-[4/5] bg-gradient-to-br from-slate-900 via-slate-950 to-black">
          {mediaPreview ? (
            mediaType === "video" ? (
              <video src={mediaPreview} controls className="h-full w-full object-cover bg-black" />
            ) : (
              <img src={mediaPreview} alt={`${platformName} preview media`} className="h-full w-full object-cover bg-black" />
            )
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">
              <div className="space-y-2">
                <ImageIcon className="mx-auto h-10 w-10 text-slate-600" />
                <div className="text-sm font-semibold">Media preview will show here</div>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4 border-t border-white/10 p-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-white">M1 Store</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Publishing account</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              {platformName}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{previewTitle}</p>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-white">1.2K likes</span>
              <span>84 comments</span>
              <span>21 shares</span>
            </div>
            <span className="text-slate-500">{previewSubtitle}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Page: M1 Store</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Platforms: {selectedPlatforms.length ? selectedPlatforms.join(", ") : "none"}</span>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_32%),linear-gradient(180deg,#07111f_0%,#050816_100%)] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-32 pt-5 md:px-6 md:pb-10 lg:px-8 lg:pb-12">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/25 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">
                <Wand2 className="h-3.5 w-3.5" />
                {t("marketing.socialPublisher.eyebrow")}
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">{t("marketing.socialPublisher.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                {t("marketing.socialPublisher.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{t("marketing.social.platforms.facebook")}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{t("marketing.social.platforms.instagram")}</span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-amber-100">{t("marketing.socialPublisher.tiktokComingSoon")}</span>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
                <Upload className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black">{t("marketing.socialPublisher.uploadTitle")}</h2>
                <p className="text-sm text-slate-400">{t("marketing.socialPublisher.uploadHint")}</p>
              </div>
            </div>

            <div className="space-y-5 pb-28 md:pb-6">
              <section className="space-y-3 rounded-[1.9rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-white">Create Post From</div>
                    <div className="text-xs text-slate-400">Choose how you want to start this post.</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setCreateSource("device")}
                    className={[
                      "rounded-[1.5rem] border p-4 text-start transition",
                      createSource === "device"
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-100 shadow-lg shadow-amber-400/10"
                        : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-white/20 hover:bg-white/[0.05]",
                    ].join(" ")}
                  >
                    <div className="text-sm font-black text-white">Upload From Device</div>
                    <div className="mt-2 text-xs text-slate-400">Active now</div>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-[1.5rem] border border-white/5 bg-white/[0.03] p-4 text-start text-slate-500 opacity-70"
                  >
                    <div className="text-sm font-black">Product Catalog</div>
                    <div className="mt-2 text-xs text-slate-500">Coming Soon</div>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-[1.5rem] border border-white/5 bg-white/[0.03] p-4 text-start text-slate-500 opacity-70"
                  >
                    <div className="text-sm font-black">AI Marketing</div>
                    <div className="mt-2 text-xs text-slate-500">Coming Soon</div>
                  </button>
                </div>
              </section>

              <label className="block cursor-pointer rounded-[2rem] border border-dashed border-amber-400/25 bg-black/20 p-5 transition hover:border-amber-400/45 hover:bg-black/25">
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaChange}
                  className="hidden"
                />
                <div className="flex min-h-[280px] items-center justify-center text-center">
                  {mediaPreview ? (
                    mediaType === "video" ? (
                      <video src={mediaPreview} controls className="max-h-[360px] w-full rounded-[1.75rem] bg-black object-contain shadow-2xl shadow-black/30" />
                    ) : (
                      <img src={mediaPreview} alt="Selected media preview" className="max-h-[360px] w-full rounded-[1.75rem] bg-black object-contain shadow-2xl shadow-black/30" />
                    )
                  ) : (
                    <div className="space-y-3 px-4">
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-amber-400/20 bg-amber-400/10 text-amber-100">
                        <ImageIcon className="h-9 w-9" />
                      </div>
                      <div>
                        <div className="text-lg font-bold text-white">{t("marketing.socialPublisher.uploadMediaTitle")}</div>
                        <div className="mt-1 text-sm text-slate-400">{t("marketing.socialPublisher.uploadMediaHint")}</div>
                      </div>
                    </div>
                  )}
                </div>
              </label>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <label className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-200">{t("marketing.socialPublisher.caption")}</span>
                    <span className="text-xs text-slate-500">{caption.length} chars</span>
                  </div>
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={7}
                    placeholder="Write your post caption..."
                    className="min-h-[170px] w-full rounded-[1.75rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400/40 focus:ring-2 focus:ring-amber-400/10"
                  />
                </label>

                <div className="space-y-3">
                  <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <Send className="h-4 w-4 text-amber-200" />
                      {t("marketing.socialPublisher.platforms")}
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
                                <span className="block text-sm font-semibold">{t(platform.labelKey)}</span>
                                {platform.disabled ? <span className="block text-xs text-slate-400">{t(platform.helperKey)}</span> : null}
                              </span>
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                              {platform.disabled ? t(platform.subtitleKey) : checked ? "Selected" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">{t("marketing.socialPublisher.schedule")}</span>
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

                <div className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">TikTok</span>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                    {t("marketing.socialPublisher.connectTikTokLater")}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/15"
                >
                  <ImageIcon className="h-4 w-4" />
                  {t("marketing.socialPublisher.preview")}
                </button>
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={saving || !canCreate || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  {t("marketing.socialPublisher.schedule")}
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("marketing.socialPublisher.publishNow")}
                </button>
              </div>

              <div className="sticky bottom-0 z-20 mt-2 grid grid-cols-2 gap-2 border-t border-white/10 bg-[#07111f]/96 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-4 backdrop-blur md:hidden">
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={saving || !canCreate || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  {t("marketing.socialPublisher.schedule")}
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("marketing.socialPublisher.publishNow")}
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
                  <h2 className="text-lg font-black">{t("marketing.socialPublisher.history")}</h2>
                  <p className="text-sm text-slate-400">{t("marketing.socialPublisher.historySubtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadPosts}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="space-y-3 break-words xl:max-h-[340px] xl:overflow-y-auto xl:pr-1">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                  Loading history...
                </div>
              ) : historyPosts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                  {t("marketing.socialPublisher.noHistory")}
                </div>
              ) : (
                historyPosts.slice(0, 20).map((post) => {
                  const previewLabel = post.media_type === "video" ? "Video" : "Image";
                  const isBusy = publishingId === post.id;
                  const canPublishAgain = post.status === "draft" || post.status === "failed" || post.status === "scheduled" || post.status === "partial_success";
                  return (
                    <article key={post.id} className="rounded-3xl border border-white/10 bg-slate-950/50 p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-300">
                          {post.media_url ? (
                            post.media_type === "video" ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />
                          ) : (
                            <ImageIcon className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                              {previewLabel}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusStyles[post.status] || statusStyles.draft}`}>
                              {statusLabel(post.status)}
                            </span>
                          </div>
                          <p className="line-clamp-2 break-words text-sm leading-6 text-slate-100">{post.caption || "No caption yet"}</p>
                          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                            {safeArray(post.platforms).map((platform) => (
                              <span key={platform} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 break-all">
                                {platform}
                              </span>
                            ))}
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Created {formatDateTime(post.created_at)}</span>
                          </div>
                          {post.error_message ? (
                            <div className="flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 break-words">
                              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>{post.error_message}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/5 pt-3">
                        <div className="min-w-0 text-xs text-slate-500">{post.scheduled_at ? `Scheduled ${formatDateTime(post.scheduled_at)}` : post.published_at ? `Published ${formatDateTime(post.published_at)}` : "Draft"}</div>
                        {canPublishAgain ? (
                          <button
                            type="button"
                            onClick={() => handlePublishFromHistory(post)}
                            disabled={isBusy || !canPublish}
                            className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-3 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {t("marketing.socialPublisher.publishNow")}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      {previewOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-4"
              role="presentation"
              onClick={() => setPreviewOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Preview post"
                className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-[#07111f] text-white shadow-2xl shadow-black/60 md:h-[92vh] md:rounded-[2rem] md:border md:border-white/10"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
                  <div className="min-w-0">
                    <div className="text-sm font-black uppercase tracking-[0.22em] text-amber-100">{t("marketing.socialPublisher.preview")}</div>
                    <div className="text-xs text-slate-400">{t("marketing.socialPublisher.previewSubtitle")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-4">
                      <div className="text-sm font-black text-white">Publishing Account</div>
                      <div className="space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-slate-400">Facebook</span>
                          <span className="font-semibold text-white">M1 Store</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-slate-400">Instagram</span>
                          <span className="font-semibold text-white">M1 Store</span>
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Post Details</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3">
                            <span>Media</span>
                            <span className="font-semibold text-white">{mediaFile ? mediaType : "none"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Platforms</span>
                            <span className="font-semibold text-white">{selectedPlatforms.length ? selectedPlatforms.join(", ") : "-"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Status</span>
                            <span className="font-semibold text-white">Draft</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        {renderPreviewCard(
                          t("marketing.socialPublisher.facebookPreview"),
                          "border-[#1877F2]/20",
                          t("marketing.socialPublisher.facebookPreviewHint")
                        )}
                        {renderPreviewCard(
                          t("marketing.socialPublisher.instagramPreview"),
                          "border-fuchsia-400/20",
                          t("marketing.socialPublisher.instagramPreviewHint")
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 border-t border-white/10 bg-[#07111f]/98 px-4 py-4 backdrop-blur md:px-6">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={handleSchedule}
                      disabled={saving || !canCreate || !selectedPlatforms.length}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                      {t("marketing.socialPublisher.schedule")}
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishNow}
                      disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {t("marketing.socialPublisher.publishNow")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(false)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
