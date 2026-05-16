import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Image as ImageIcon, Megaphone, Plus, RefreshCcw, Search, Send, Trash2, Zap } from "lucide-react";
import toast from "react-hot-toast";

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

const getPublishToastMessage = (post = {}) => {
  const results = post.platform_publish_results || {};
  const facebookPublished = results.facebook?.status === "published";
  const instagramPublished = results.instagram?.status === "published";

  if (facebookPublished && instagramPublished) return { type: "success", message: "Published to Facebook and Instagram" };
  if (facebookPublished && results.instagram) return { type: "warning", message: "Facebook published, Instagram failed" };
  if (instagramPublished && results.facebook) return { type: "warning", message: "Instagram published, Facebook failed" };
  if (post.status === "failed") return { type: "error", message: `Meta publish failed: ${post.error_message || "Publish failed"}` };
  return { type: "success", message: `Meta published successfully: ${getPlatformPostId(post)}` };
};

const getFacebookPostUrl = (post = {}) => {
  const id = getPlatformPostId(post);
  if (!id) return "";
  return `https://www.facebook.com/${encodeURIComponent(id)}`;
};

const storyToast = (story = {}) => {
  const results = story.story_publish_results || {};
  const instagram = results.instagram?.status;
  const facebook = results.facebook?.status;
  const whatsapp = results.whatsapp?.status;
  if (instagram === "published" && facebook === "published") return "Story published to Instagram and Facebook";
  if (instagram === "published" || facebook === "published") return "Story partially published";
  if (whatsapp === "skipped") return story.story_error_message || "Story publish failed; WhatsApp skipped";
  return story.story_error_message || "Story publish failed";
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
      setError(err?.message || "Failed to load marketing posts");
      toast.error(err?.message || "Failed to load marketing posts");
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
      toast.error("You do not have permission to create marketing posts.");
      return;
    }

    setSaving(true);
    try {
      if (editorPost?.id) {
        await updateMarketingPost(editorPost.id, payload);
      } else {
        await createMarketingPost({ ...payload, status: "draft" });
      }
      toast.success("Post saved");
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(Number(err?.status || err?.responseBody?.status) === 403 ? "You do not have permission to create marketing posts." : err?.message || "Failed to save post");
    } finally {
      setSaving(false);
    }
  };

  const publishPost = async (payload) => {
    if (!canPublish) {
      toast.error("You do not have permission to publish marketing posts.");
      return;
    }

    setSaving(true);
    try {
      const saved = editorPost?.id ? await updateMarketingPost(editorPost.id, payload) : await createMarketingPost({ ...payload, status: "draft" });
      const published = await publishMarketingPost(saved.id);
      const toastMessage = getPublishToastMessage(published);
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
      toast.error(err?.message || "Failed to publish post");
    } finally {
      setSaving(false);
    }
  };

  const schedulePost = async (payload, scheduledAt) => {
    if (!canUpdate) {
      toast.error("You do not have permission to update marketing posts.");
      return;
    }

    setSaving(true);
    try {
      const saved = editorPost?.id ? await updateMarketingPost(editorPost.id, payload) : await createMarketingPost({ ...payload, status: "draft" });
      await scheduleMarketingPost(saved.id, { scheduled_at: scheduledAt });
      toast.success("Post scheduled");
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to schedule post");
    } finally {
      setSaving(false);
    }
  };

  const publishStory = async (post) => {
    if (!canPublish) return toast.error("You do not have permission to publish marketing posts.");
    try {
      const result = await publishStoryEverywhere(post.id);
      if (result.story_status === "failed") toast.error(storyToast(result));
      else toast.success(storyToast(result));
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to publish story");
    }
  };

  const scheduleStory = async (post) => {
    if (!canUpdate) return toast.error("You do not have permission to update marketing posts.");
    const scheduledAt = window.prompt("Schedule story date/time (YYYY-MM-DDTHH:mm)", new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16));
    if (!scheduledAt) return;
    try {
      await scheduleStoryEverywhere(post.id, { scheduled_at: scheduledAt });
      toast.success("Story scheduled");
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to schedule story");
    }
  };

  const generateFromProduct = async (productId) => {
    if (!canCreate) {
      toast.error("You do not have permission to create marketing posts.");
      return;
    }

    setSaving(true);
    try {
      const generated = await generateProductMarketingPost(productId);
      setEditorPost(generated);
      setEditorOpen(true);
    } catch (err) {
      toast.error(Number(err?.status || err?.responseBody?.status) === 403 ? "You do not have permission to create marketing posts." : err?.message || "Failed to generate post");
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (id) => {
    if (!canDelete) return;
    if (!window.confirm("Delete this marketing post?")) return;
    try {
      await deleteMarketingPost(id);
      toast.success("Post deleted");
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to delete post");
    }
  };

  const copyCaption = async (caption) => {
    try {
      await navigator.clipboard.writeText(caption || "");
      toast.success("Caption copied");
    } catch {
      toast.error("Copy failed");
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
                Social posts
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Create, schedule, and publish social content</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">Generate posts from products or manage drafts manually with clean mobile-first editing.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canCreate ? (
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
                  <Plus className="h-4 w-4" />
                  New post
                </button>
              ) : null}
              <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or caption..." className="w-full rounded-2xl border border-white/10 bg-slate-950/80 py-3 pl-11 pr-4 text-sm text-white outline-none" />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="partial_success">Partial success</option>
              <option value="failed">Failed</option>
            </select>
            <select value={channel} onChange={(event) => setChannel(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
              <option value="all">All channels</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            {canCreate ? (
              <button onClick={() => generateFromProduct(window.prompt("Enter product ID to generate marketing post") || "")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
                <ImageIcon className="h-4 w-4" />
                Generate from product
              </button>
            ) : null}
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Post</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Preview</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Channel</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Status</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Platform ID</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">Scheduled</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">Loading posts...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">No marketing posts found.</td>
                  </tr>
                ) : (
                  filtered.map((post) => (
                    <tr key={String(post.id)} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="font-semibold text-white">{post.title || "Untitled post"}</div>
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
                                  alt={`${post.title || "Post preview"} ${index + 1}`}
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
                          {canUpdate ? <button onClick={() => openEdit(post)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">Edit</button> : null}
                          <button onClick={() => copyCaption(post.caption)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
                            <Copy className="mr-1 inline-block h-3.5 w-3.5" />
                            Copy
                          </button>
                          {canPublish ? (
                            <button onClick={async () => {
                              try {
                                const published = await publishMarketingPost(post.id);
                                const toastMessage = getPublishToastMessage(published);
                                if (toastMessage.type === "error") toast.error(toastMessage.message);
                                else if (toastMessage.type === "warning") toast(toastMessage.message);
                                else toast.success(toastMessage.message);
                                await load();
                              } catch (err) {
                                toast.error(err?.message || "Failed to publish post");
                              }
                            }} className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                              <Send className="mr-1 inline-block h-3.5 w-3.5" />
                              Publish
                            </button>
                          ) : null}
                          {canPublish ? (
                            <button onClick={() => publishStory(post)} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-100">
                              <Zap className="mr-1 inline-block h-3.5 w-3.5" />
                              Generate Fast Story
                            </button>
                          ) : null}
                          {canUpdate ? (
                            <button onClick={() => scheduleStory(post)} className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                              <CalendarClock className="mr-1 inline-block h-3.5 w-3.5" />
                              Schedule Story
                            </button>
                          ) : null}
                          {getPlatformPostId(post) ? (
                            <a
                              href={getFacebookPostUrl(post)}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100"
                            >
                              <ExternalLink className="mr-1 inline-block h-3.5 w-3.5" />
                              Open on Facebook
                            </a>
                          ) : null}
                          {canDelete ? (
                            <button onClick={() => deletePost(post.id)} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                              <Trash2 className="mr-1 inline-block h-3.5 w-3.5" />
                              Delete
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
          title="Social post editor"
        />
      ) : null}
    </div>
  );
}
