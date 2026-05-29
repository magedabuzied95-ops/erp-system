import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Image as ImageIcon, Megaphone, Plus, RefreshCcw, Search, Send, Trash2, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  createMarketingPost,
  deleteMarketingPost,
  generateProductMarketingPost,
  getMarketingPosts,
  publishMarketingPost,
  publishStoryEverywhere,
  scheduleMarketingPost,
  scheduleStoryEverywhere,
  updateMarketingPost,
} from "../services/marketingApi";
import PostEditorModal from "../components/PostEditorModal";
import { hasPermission } from "../../permissions/lib/rbacStore";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const uniqueImages = (post = {}) =>
  Array.from(
    new Set(
      [post.image_url, ...(Array.isArray(post.media_urls) ? post.media_urls : [])]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

const getPlatformPostId = (post = {}) => String(post.platform_post_id || post.external_post_id || "").trim();

const getPublishToastMessage = (post = {}, t = (key, options = {}) => options.defaultValue || key) => {
  const results = post.platform_publish_results || {};
  const facebookPublished = results.facebook?.status === "published";
  const instagramPublished = results.instagram?.status === "published";

  if (facebookPublished && instagramPublished) return { type: "success", message: t("marketing.posts.publishedBoth") };
  if (facebookPublished && results.instagram) return { type: "warning", message: t("marketing.posts.facebookPublishedInstagramFailed") };
  if (instagramPublished && results.facebook) return { type: "warning", message: t("marketing.posts.instagramPublishedFacebookFailed") };
  if (post.status === "failed") return { type: "error", message: t("marketing.posts.metaPublishFailed", { message: post.error_message || t("marketing.posts.publishFailed") }) };
  return { type: "success", message: t("marketing.posts.metaPublished", { id: getPlatformPostId(post) }) };
};

const getFacebookPostUrl = (post = {}) => {
  const id = getPlatformPostId(post);
  if (!id) return "";
  return `https://www.facebook.com/${encodeURIComponent(id)}`;
};

const storyToast = (story = {}, t = (key, options = {}) => options.defaultValue || key) => {
  const results = story.story_publish_results || {};
  const instagram = results.instagram?.status;
  const facebook = results.facebook?.status;
  const whatsapp = results.whatsapp?.status;
  if (instagram === "published" && facebook === "published") return t("marketing.posts.storyPublished");
  if (instagram === "published" || facebook === "published") return t("marketing.posts.storyPartial");
  if (whatsapp === "skipped") return story.story_error_message || t("marketing.posts.storyFailedWhatsappSkipped");
  return story.story_error_message || t("marketing.posts.storyFailed");
};

const Badge = ({ children, tone = "slate" }) => {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    slate: "border-white/10 bg-white/5 text-slate-200",
  };
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>{children}</span>;
};

export default function SocialPosts() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPost, setEditorPost] = useState(null);
  const canCreate = hasPermission("marketing.create");
  const canUpdate = hasPermission("marketing.update");
  const canDelete = hasPermission("marketing.delete");
  const canPublish = hasPermission("marketing.publish");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMarketingPosts({
        search,
        status: status === "all" ? "" : status,
        channel: channel === "all" ? "" : channel,
      });
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || t("marketing.posts.loadFailed"));
      toast.error(err?.message || t("marketing.posts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [search, status, channel]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => posts, [posts]);

  const openCreate = () => {
    if (!canCreate) return;
    setEditorPost({
      title: "",
      caption: "",
      hashtags: "#fashion #new_arrival",
      image_url: "",
      channel: "facebook",
      status: "draft",
    });
    setEditorOpen(true);
  };

  const openEdit = (post) => {
    setEditorPost(post);
    setEditorOpen(true);
  };

  const savePost = async (payload) => {
    if (editorPost?.id ? !canUpdate : !canCreate) {
      toast.error(t("marketing.common.permissionCreate"));
      return;
    }

    setSaving(true);
    try {
      if (editorPost?.id) {
        await updateMarketingPost(editorPost.id, payload);
      } else {
        await createMarketingPost({ ...payload, status: "draft" });
      }
      toast.success(t("marketing.posts.saved"));
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(Number(err?.status || err?.responseBody?.status) === 403 ? t("marketing.common.permissionCreate") : err?.message || t("marketing.posts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const publishPost = async (payload) => {
    if (!canPublish) {
      toast.error(t("marketing.common.permissionPublish"));
      return;
    }

    setSaving(true);
    try {
      const saved = editorPost?.id ? await updateMarketingPost(editorPost.id, payload) : await createMarketingPost({ ...payload, status: "draft" });
      const published = await publishMarketingPost(saved.id);
      const toastMessage = getPublishToastMessage(published, t);
      if (toastMessage.type === "error") toast.error(toastMessage.message);
      else if (toastMessage.type === "warning") toast(toastMessage.message);
      else toast.success(toastMessage.message);
      if (published?.status === "failed") {
        await load();
        return;
      }
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.posts.publishFailed"));
    } finally {
      setSaving(false);
    }
  };

  const schedulePost = async (payload, scheduledAt) => {
    if (!canUpdate) {
      toast.error(t("marketing.common.permissionUpdate"));
      return;
    }

    setSaving(true);
    try {
      const saved = editorPost?.id ? await updateMarketingPost(editorPost.id, payload) : await createMarketingPost({ ...payload, status: "draft" });
      await scheduleMarketingPost(saved.id, { scheduled_at: scheduledAt });
      toast.success(t("marketing.posts.scheduled"));
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.posts.scheduleFailed"));
    } finally {
      setSaving(false);
    }
  };

  const publishStory = async (post) => {
    if (!canPublish) return toast.error(t("marketing.common.permissionPublish"));
    try {
      const result = await publishStoryEverywhere(post.id);
      if (result.story_status === "failed") toast.error(storyToast(result, t));
      else toast.success(storyToast(result, t));
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.posts.storyFailed"));
    }
  };

  const scheduleStory = async (post) => {
    if (!canUpdate) return toast.error(t("marketing.common.permissionUpdate"));
    const scheduledAt = window.prompt(t("marketing.posts.storySchedulePrompt"), new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16));
    if (!scheduledAt) return;
    try {
      await scheduleStoryEverywhere(post.id, { scheduled_at: scheduledAt });
      toast.success(t("marketing.posts.storyScheduled"));
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.posts.storyScheduleFailed"));
    }
  };

  const generateFromProduct = async (productId) => {
    if (!canCreate) {
      toast.error(t("marketing.common.permissionCreate"));
      return;
    }

    setSaving(true);
    try {
      const generated = await generateProductMarketingPost(productId);
      setEditorPost(generated);
      setEditorOpen(true);
    } catch (err) {
      toast.error(Number(err?.status || err?.responseBody?.status) === 403 ? t("marketing.common.permissionCreate") : err?.message || t("marketing.posts.generateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (id) => {
    if (!canDelete) return;
    if (!window.confirm(t("marketing.posts.deleteConfirm"))) return;
    try {
      await deleteMarketingPost(id);
      toast.success(t("marketing.posts.deleted"));
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.posts.deleteFailed"));
    }
  };

  const copyCaption = async (caption) => {
    try {
      await navigator.clipboard.writeText(caption || "");
      toast.success(t("marketing.posts.captionCopied"));
    } catch {
      toast.error(t("marketing.posts.copyFailed"));
    }
  };

  const getTone = (value) => {
    const statusValue = String(value || "").toLowerCase();
    if (statusValue === "published") return "emerald";
    if (statusValue === "scheduled") return "cyan";
    if (statusValue === "failed") return "rose";
    if (statusValue === "draft") return "slate";
    return "amber";
  };

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <Megaphone className="h-3.5 w-3.5" />
                {t("marketing.posts.eyebrow")}
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">{t("marketing.posts.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">{t("marketing.posts.subtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canCreate ? (
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
                  <Plus className="h-4 w-4" />
                  {t("marketing.posts.new")}
                </button>
              ) : null}
              <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("common.refresh")}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("marketing.posts.searchPlaceholder")} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 py-3 ps-11 pe-4 text-sm text-white outline-none" />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
              <option value="all">{t("marketing.posts.filters.allStatuses")}</option>
              <option value="draft">{t("marketing.posts.status.draft")}</option>
              <option value="scheduled">{t("marketing.posts.status.scheduled")}</option>
              <option value="published">{t("marketing.posts.status.published")}</option>
              <option value="partial_success">{t("marketing.posts.status.partialSuccess")}</option>
              <option value="failed">{t("marketing.posts.status.failed")}</option>
            </select>
            <select value={channel} onChange={(event) => setChannel(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
              <option value="all">{t("marketing.posts.filters.allChannels")}</option>
              <option value="facebook">{t("marketing.social.platforms.facebook")}</option>
              <option value="instagram">{t("marketing.social.platforms.instagram")}</option>
              <option value="whatsapp">{t("marketing.social.platforms.whatsapp")}</option>
            </select>
            {canCreate ? (
              <button onClick={() => generateFromProduct(window.prompt(t("marketing.posts.enterProductId")) || "")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
                <ImageIcon className="h-4 w-4" />
                {t("marketing.posts.generateFromProduct")}
              </button>
            ) : null}
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-start text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.post")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.preview")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.channel")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.status")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.platformId")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.posts.headers.scheduled")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold text-end">{t("marketing.posts.headers.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">{t("marketing.posts.loading")}</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">{t("marketing.posts.empty")}</td>
                  </tr>
                ) : (
                  filtered.map((post) => (
                    <tr key={String(post.id)} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="font-semibold text-white">{post.title || t("marketing.posts.untitled")}</div>
                        <div className="mt-2 line-clamp-2 max-w-[28rem] whitespace-pre-wrap text-sm text-slate-400">{post.caption || ""}</div>
                        <div className="mt-2 text-xs text-slate-500">{post.template_name || post.campaign_name || post.product_name || "-"}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4">
                        {(() => {
                          const images = uniqueImages(post);
                          return images.length ? (
                            <div className="relative h-16 w-20">
                              {images.slice(0, 3).map((url, index) => (
                                <img
                                  key={url}
                                  src={url}
                                  alt={`${post.title || t("marketing.posts.headers.preview")} ${index + 1}`}
                                  className="absolute h-16 w-16 rounded-2xl border border-white/10 object-cover shadow-lg shadow-black/20"
                                  style={{ left: `${index * 10}px`, zIndex: 3 - index }}
                                />
                              ))}
                              {images.length > 3 ? (
                                <div className="absolute bottom-1 right-0 z-10 rounded-full border border-white/10 bg-slate-950/90 px-2 py-1 text-[11px] font-black text-white">
                                  +{images.length - 3}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-white/10 text-slate-500">
                              <ImageIcon className="h-4 w-4" />
                            </div>
                          );
                        })()}
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{post.channel || "-"}</td>
                      <td className="border-b border-white/5 px-3 py-4"><Badge tone={getTone(post.status)}>{post.status}</Badge></td>
                      <td className="border-b border-white/5 px-3 py-4">
                        {getPlatformPostId(post) ? (
                          <div className="max-w-[15rem] space-y-1 font-mono text-xs text-cyan-200">
                            {post.platform_publish_results?.facebook?.platform_post_id ? (
                              <div className="truncate" title={post.platform_publish_results.facebook.platform_post_id}>fb: {post.platform_publish_results.facebook.platform_post_id}</div>
                            ) : null}
                            {post.platform_publish_results?.instagram?.platform_post_id ? (
                              <div className="truncate" title={post.platform_publish_results.instagram.platform_post_id}>ig: {post.platform_publish_results.instagram.platform_post_id}</div>
                            ) : null}
                            {!post.platform_publish_results?.facebook?.platform_post_id && !post.platform_publish_results?.instagram?.platform_post_id ? (
                              <div className="truncate" title={getPlatformPostId(post)}>{getPlatformPostId(post)}</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{formatDateTime(post.scheduled_at)}</td>
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canUpdate ? <button onClick={() => openEdit(post)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">{t("common.edit")}</button> : null}
                          <button onClick={() => copyCaption(post.caption)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
                            <Copy className="me-1 inline-block h-3.5 w-3.5" />
                            {t("common.copy")}
                          </button>
                          {canPublish ? (
                            <button onClick={async () => {
                              try {
                                const published = await publishMarketingPost(post.id);
                                const toastMessage = getPublishToastMessage(published, t);
                                if (toastMessage.type === "error") toast.error(toastMessage.message);
                                else if (toastMessage.type === "warning") toast(toastMessage.message);
                                else toast.success(toastMessage.message);
                                await load();
                              } catch (err) {
                                toast.error(err?.message || t("marketing.posts.publishFailed"));
                              }
                            }} className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                              <Send className="me-1 inline-block h-3.5 w-3.5" />
                              {t("marketing.posts.publish")}
                            </button>
                          ) : null}
                          {canPublish ? (
                            <button onClick={() => publishStory(post)} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-100">
                              <Zap className="me-1 inline-block h-3.5 w-3.5" />
                              {t("marketing.posts.generateFastStory")}
                            </button>
                          ) : null}
                          {canUpdate ? (
                            <button onClick={() => scheduleStory(post)} className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                              <CalendarClock className="me-1 inline-block h-3.5 w-3.5" />
                              {t("marketing.posts.scheduleStory")}
                            </button>
                          ) : null}
                          {getPlatformPostId(post) ? (
                            <a
                              href={getFacebookPostUrl(post)}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100"
                            >
                              <ExternalLink className="me-1 inline-block h-3.5 w-3.5" />
                              {t("marketing.posts.openOnFacebook")}
                            </a>
                          ) : null}
                          {canDelete ? (
                            <button onClick={() => deletePost(post.id)} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                              <Trash2 className="me-1 inline-block h-3.5 w-3.5" />
                              {t("common.delete")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editorOpen ? (
        <PostEditorModal
          open={editorOpen}
          post={editorPost}
          onClose={() => setEditorOpen(false)}
          onSaveDraft={(editorPost?.id ? canUpdate : canCreate) ? savePost : null}
          onPublish={canPublish ? publishPost : null}
          onSchedule={canUpdate ? schedulePost : null}
          saving={saving}
          title={t("marketing.posts.editorTitle")}
        />
      ) : null}
    </div>
  );
}
