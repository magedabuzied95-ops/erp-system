import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Clock3,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldBan,
  Sparkles,
  ThumbsUp,
  UserRound,
  ShoppingBag,
} from "lucide-react";

const clean = (value = "") => String(value ?? "").trim();

const absoluteTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "—";
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
};

const postKey = (item = {}) => {
  const source = item || {};
  return clean(
    source.conversation_id ||
      source.session_id ||
      source.post_id ||
      source.id ||
      source.comment_id ||
      `${source.platform || "social"}:${source.post_id || source.id || source.comment_id || ""}`
  );
};

const commentKey = (item = {}) => {
  const source = item || {};
  return clean(
    source.comment_id ||
      source.id ||
      source.external_message_id ||
      source.provider_message_id ||
      `${source.platform || "social"}:${source.created_at || ""}:${source.message_text || source.customer_message || source.text || ""}`
  );
};

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) {
    return { label: "Instagram", className: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
  }
  return { label: "Facebook", className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100" };
};

const getAttachmentImage = (post = {}) => {
  const attachments = Array.isArray(post.attachments?.data)
    ? post.attachments.data
    : Array.isArray(post.attachments)
      ? post.attachments
      : Array.isArray(post.attachment?.data)
        ? post.attachment.data
        : Array.isArray(post.attachment)
          ? post.attachment
          : [];
  for (const attachment of attachments) {
    const image =
      attachment?.media?.image?.src ||
      attachment?.media?.image_url ||
      attachment?.media?.source ||
      attachment?.subattachments?.data?.[0]?.media?.image?.src ||
      attachment?.subattachments?.data?.[0]?.media?.image_url ||
      attachment?.subattachments?.[0]?.media?.image?.src ||
      attachment?.subattachments?.[0]?.media?.image_url ||
      "";
    if (clean(image)) return clean(image);
  }
  return "";
};

const getPostImage = (post = {}) =>
  clean(
    post.post_full_picture ||
      post.attachment_image ||
      post.post_thumbnail ||
      post.full_picture ||
      post.product_image_url ||
      post.product_image ||
      post.thumbnail_url ||
      post.image_url ||
      post.image ||
      getAttachmentImage(post)
  );

const getPostCaption = (post = {}) =>
  clean(post.post_caption || post.post_message || post.last_message || post.post_text || post.message || "");

const getLastCommentText = (post = {}) => clean(post.last_comment_text || post.last_message || "");

const getCommentText = (comment = {}) =>
  clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || "");

const classifyComment = (comment = {}) => clean(comment.classification_label || comment.reply_status || comment.auto_reply_mode || "pending");

const labelText = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "lead_price") return "Price";
  if (key === "lead_size") return "Size";
  if (key === "lead_shipping") return "Shipping";
  if (key === "lead_details") return "Question";
  if (key === "lead_inbox") return "Lead";
  if (key === "human_review") return "Review";
  if (key === "ignore" || key === "engagement_only") return "Spam";
  if (key === "sent") return "Replied";
  if (key === "failed") return "Failed";
  if (key === "pending") return "Pending";
  return value ? value.replace(/_/g, " ") : "—";
};

const summaryBucketLabel = (comment = {}) => {
  const classification = clean(comment.classification_label || "").toLowerCase();
  const text = getCommentText(comment);
  const haystack = `${classification} ${text}`.toLowerCase();
  if (classification === "lead_price" || /(price|سعر|ثمن|كام|بكام)/i.test(haystack)) return "price";
  if (classification === "lead_size" || /(size|مقاس|المقاس)/i.test(haystack)) return "size";
  if (classification === "lead_shipping" || /(shipping|شحن|توصيل)/i.test(haystack)) return "shipping";
  if (classification === "lead_details" || /(details|تفاصيل|معلومات)/i.test(haystack)) return "details";
  if (classification === "lead_inbox" || /(جاهز|buy|order|عاوز|عايزة|اريد|أريد|طلب)/i.test(haystack)) return "ready";
  if (classification === "ignore" || classification === "engagement_only") return "spam";
  return "question";
};

const getCommentTags = (comment = {}) => {
  const tags = new Set();
  const bucket = summaryBucketLabel(comment);
  if (bucket === "price") tags.add("Price");
  if (bucket === "size") tags.add("Size");
  if (bucket === "shipping") tags.add("Shipping");
  if (bucket === "details" || bucket === "question") tags.add("Question");
  if (bucket === "ready") tags.add("Lead");
  if (bucket === "spam") tags.add("Spam");
  if (clean(comment.classification_label || "").toLowerCase() === "human_review") tags.add("Review");
  if (clean(comment.classification_label || "").toLowerCase() === "lead_inbox") tags.add("Lead");
  return Array.from(tags).slice(0, 4);
};

const templatePreviewText = (template = {}, context = {}) => {
  const raw = clean(template.template || template.text || "");
  if (!raw) return "";
  return raw.replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = (leftKey || rightKey || "").toLowerCase();
    return clean(context[key] ?? context[key.replace(/_([a-z])/g, (_m, letter) => letter.toUpperCase())] ?? "");
  });
};

const selectFirst = (...values) => values.map((value) => clean(value)).find(Boolean) || "";

function SocialCommentsWorkspace({
  items = [],
  loading = false,
  error = "",
  selectedPost = null,
  selectedThread = { post: null, comments: [], loading: false, error: "" },
  selectedTemplate = { template: null, loading: false, error: "" },
  globalSettings = {
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
  },
  onRefresh,
  onSelectPost,
  onGlobalSettingsChange,
  onSaveGlobalSettings,
  onTemplateChange,
  onSaveTemplate,
  onCommentAction,
  selectedPostId = "",
  actionLoading = "",
}) {
  const posts = useMemo(
    () =>
      [...(Array.isArray(items) ? items.filter(Boolean) : [])].sort(
        (left, right) =>
          new Date(right.last_activity_at || right.last_comment_at || right.last_message_at || right.updated_at || right.created_at || 0).getTime() -
          new Date(left.last_activity_at || left.last_comment_at || left.last_message_at || left.updated_at || left.created_at || 0).getTime()
      ),
    [items]
  );

  const activePost = selectedPost || posts[0] || null;
  const activePostKey = clean(selectedPostId || postKey(activePost));
  const activeThread = selectedThread || { post: null, comments: [], loading: false, error: "" };
  const comments = Array.isArray(activeThread.comments) ? activeThread.comments.filter(Boolean) : [];
  const activeComment = comments[0] || null;
  const activePostDetails = activeThread.post || activePost || null;
  const activeTemplate = selectedTemplate?.template || null;

  const [replyDraft, setReplyDraft] = useState("");

  const dashboard = useMemo(() => {
    const totalComments = posts.reduce((sum, post) => sum + Number(post.comments_count || 0), 0);
    const newComments = posts.reduce((sum, post) => sum + Number(post.new_comments_count || 0), 0);
    const needsReply = posts.filter((post) => Number(post.new_comments_count || 0) > 0 || clean(post.reply_status || post.auto_reply_mode || post.session_status).toLowerCase() !== "sent").length;
    const replied = posts.filter((post) => clean(post.reply_status || post.auto_reply_mode || post.session_status).toLowerCase() === "sent").length;
    const autoReplyOn = posts.filter((post) => Boolean(post.auto_reply_enabled || post.template_enabled || post.generic_enabled)).length;
    return { totalComments, newComments, needsReply, replied, autoReplyOn };
  }, [posts]);

  const aiSummary = useMemo(() => {
    const buckets = { price: 0, size: 0, shipping: 0, details: 0, ready: 0, spam: 0, question: 0 };
    for (const comment of comments) {
      buckets[summaryBucketLabel(comment)] += 1;
    }
    const entries = Object.entries(buckets).sort((left, right) => right[1] - left[1]);
    const mostFrequentQuestion = entries.find(([, value]) => value > 0)?.[0] || "question";
    return {
      mostFrequentQuestion,
      priceQuestions: buckets.price,
      sizeQuestions: buckets.size,
      readyCustomers: buckets.ready,
      questionCount: buckets.question,
      spamCount: buckets.spam,
    };
  }, [comments]);

  const activePostImage = getPostImage(activePostDetails);
  const activePostCaption = getPostCaption(activePostDetails);
  const activePostLink = selectFirst(
    activePostDetails?.post_permalink,
    activePostDetails?.post_permalink_url,
    activePostDetails?.permalink_url,
    activePostDetails?.post_url
  );
  const activePlatform = platformMeta(activePostDetails?.platform || activePost?.platform || "");
  const activeTemplateEnabled = Boolean(activeTemplate?.enabled);
  const suggestedReply = templatePreviewText(
    activeTemplate || { template: globalSettings.generic_template || "" },
    {
      customer_name: selectFirst(activeComment?.commenter_name, activeComment?.customer_name, "Customer"),
      product_name: selectFirst(activePostDetails?.product_name, activePostDetails?.name, ""),
      price: selectFirst(activePostDetails?.product_price, activePostDetails?.price, ""),
      sale_price: selectFirst(activePostDetails?.product_sale_price, activePostDetails?.sale_price, ""),
      sizes: selectFirst(activePostDetails?.product_sizes, activePostDetails?.sizes, ""),
      colors: selectFirst(activePostDetails?.product_colors, activePostDetails?.colors, ""),
      product_link: selectFirst(activePostDetails?.product_storefront_url, activePostDetails?.product_link, activePostDetails?.product_url, ""),
      post_link: activePostLink,
      store_address: selectFirst(activePostDetails?.store_address, ""),
      shipping_time: selectFirst(activePostDetails?.shipping_time, ""),
    }
  );

  useEffect(() => {
    setReplyDraft(suggestedReply || "");
  }, [selectedPostId, suggestedReply]);

  const renderCommentAction = (comment, action) => {
    if (!onCommentAction) return;
    onCommentAction(comment, action);
  };

  const firstMatchingComment = (predicate) => comments.find(predicate) || activeComment || null;

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] text-white shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="grid h-full min-h-0 w-full min-w-0 gap-3 p-3 min-[1024px]:grid-cols-[320px_minmax(0,1fr)] min-[1280px]:grid-cols-[320px_minmax(0,1fr)_360px]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Social Comments</div>
              <div className="mt-1 text-sm font-black text-white">Posts</div>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-slate-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {!posts.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
                لا توجد منشورات بعد
              </div>
            ) : null}

            <div className="space-y-2">
              {posts.map((post) => {
                const key = postKey(post);
                const active = activePostKey === key;
                const meta = platformMeta(post.platform);
                const thumb = getPostImage(post);
                return (
                  <article
                    key={key}
                    role={onSelectPost ? "button" : undefined}
                    tabIndex={onSelectPost ? 0 : undefined}
                    onClick={onSelectPost ? () => onSelectPost(post, key) : undefined}
                    onKeyDown={
                      onSelectPost
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") onSelectPost(post, key);
                          }
                        : undefined
                    }
                    className={`rounded-2xl border p-3 transition ${
                      active
                        ? "border-cyan-300/40 bg-cyan-300/10 ring-1 ring-cyan-300/20"
                        : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-400">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-black text-white">{getPostCaption(post) || "Post"}</div>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${meta.className}`}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{Number(post.comments_count || 0)} comments</span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{Number(post.new_comments_count || 0)} new</span>
                          {Number(post.new_comments_count || 0) > 0 ? (
                            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">Needs reply</span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-[11px] font-medium text-slate-400">
                          <span className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {absoluteTime(post.last_activity_at || post.last_comment_at || post.last_message_at || post.updated_at || post.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/50">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-white/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Post Workspace
                  </div>
                  <h2 className="mt-1 line-clamp-2 text-lg font-black text-white">{activePostCaption || "اختر منشورًا من القائمة"}</h2>
                </div>
                {activePostLink ? (
                  <a
                    href={activePostLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100"
                  >
                    Open Post
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/70">
                  <div className="flex h-[260px] items-center justify-center overflow-hidden bg-slate-900 min-[1600px]:h-[320px]">
                    {activePostImage ? (
                      <img src={activePostImage} alt="" className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                            <Sparkles className="h-6 w-6 text-cyan-100" />
                          </span>
                          <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">No preview image</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">{activePlatform.label} Post</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-slate-200">{activePostCaption || "لا يوجد وصف للمنشور"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePlatform.className}`}>
                          {activePlatform.label}
                        </span>
                        {activePostLink ? (
                          <a
                            href={activePostLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200"
                          >
                            Open
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {activePostDetails?.product_name || activePostDetails?.product_price || activePostDetails?.product_sale_price || activePostDetails?.product_sizes || activePostDetails?.product_colors ? (
                      <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">ERP Product Card</div>
                            <div className="mt-1 text-sm font-black text-white">{selectFirst(activePostDetails?.product_name, "Linked product")}</div>
                          </div>
                          {activePostDetails?.product_link || activePostDetails?.product_storefront_url ? (
                            <a
                              href={selectFirst(activePostDetails?.product_link, activePostDetails?.product_storefront_url)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100"
                            >
                              Product link
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <InfoChip label="Price" value={selectFirst(activePostDetails?.product_price, activePostDetails?.price, "—")} />
                          <InfoChip label="Sale" value={selectFirst(activePostDetails?.product_sale_price, activePostDetails?.sale_price, "—")} />
                          <InfoChip label="Sizes" value={selectFirst(activePostDetails?.product_sizes, activePostDetails?.sizes, "—")} />
                          <InfoChip label="Colors" value={selectFirst(activePostDetails?.product_colors, activePostDetails?.colors, "—")} />
                          <InfoChip label="Stock" value={selectFirst(activePostDetails?.product_stock, activePostDetails?.stock, "—")} />
                          <InfoChip label="Variants" value={selectFirst(activePostDetails?.product_variant_count, activePostDetails?.variant_count, "—")} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Comments Timeline</div>
                      <div className="mt-1 text-sm font-black text-white">{comments.length} comments</div>
                    </div>
                    {activeThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : null}
                  </div>

                  {activeThread.error ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{activeThread.error}</div>
                  ) : null}

                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {!comments.length && !activeThread.loading ? (
                      <div className="grid min-h-[18rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                        لا توجد تعليقات لعرضها الآن
                      </div>
                    ) : null}

                    {comments.map((comment) => {
                      const key = commentKey(comment);
                      const status = clean(classifyComment(comment));
                      const avatar = selectFirst(
                        comment.commenter_profile_picture_url,
                        comment.customer_avatar_url,
                        comment.avatar_url,
                        comment.profile_pic
                      );
                      const name = selectFirst(comment.customer_name, comment.commenter_name, comment.from_name, "Customer");
                      const text = getCommentText(comment) || "بدون نص";
                      const tags = getCommentTags(comment);
                      const actionBusy = actionLoading === key;
                      return (
                        <article key={key || `${comment.created_at || ""}:${name}`} className="rounded-[22px] border border-white/10 bg-slate-950/65 p-3">
                          <div className="flex items-start gap-3">
                            {avatar ? (
                              <img src={avatar} alt={name} className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
                            ) : (
                              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-slate-300 ring-1 ring-white/10">
                                <UserRound className="h-5 w-5" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-white">{name}</div>
                                  <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {absoluteTime(comment.created_at)}
                                  </div>
                                </div>
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                                    status === "sent"
                                      ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                      : status === "failed"
                                        ? "border-rose-300/20 bg-rose-400/10 text-rose-100"
                                        : "border-white/10 bg-white/[0.04] text-slate-300"
                                  }`}
                                >
                                  {labelText(status)}
                                </span>
                              </div>

                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{text}</div>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                                      tag === "Price"
                                        ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                                        : tag === "Size"
                                          ? "border-violet-300/20 bg-violet-400/10 text-violet-100"
                                          : tag === "Shipping"
                                            ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
                                            : tag === "Lead"
                                              ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                              : "border-white/10 bg-white/[0.04] text-slate-300"
                                    }`}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "reply")}
                                  disabled={!onCommentAction || actionBusy}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
                                >
                                  {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  Reply
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "private_message")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                  Private Message
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "lead")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                                >
                                  <ShoppingBag className="h-4 w-4" />
                                  Lead
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "ignore")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-300 disabled:opacity-50"
                                >
                                  <ShieldBan className="h-4 w-4" />
                                  Ignore
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Reply Composer</div>
                        <div className="mt-1 text-sm font-black text-white">Draft a reply for the selected post</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setReplyDraft(suggestedReply || "")}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Use suggested
                        </button>
                        <button
                          type="button"
                          onClick={() => navigator?.clipboard?.writeText?.(replyDraft || "").catch(() => {})}
                          disabled={!replyDraft}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                          Copy
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                      placeholder="Reply draft"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!activeComment || !onCommentAction) return;
                          onCommentAction(activeComment, "reply");
                        }}
                        disabled={!activeComment || !onCommentAction}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Reply now
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!activeComment || !onCommentAction) return;
                          onCommentAction(activeComment, "private_message");
                        }}
                        disabled={!activeComment || !onCommentAction}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        <MessageCircle className="h-4 w-4" />
                        Private Message
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!replyDraft) return;
                          navigator?.clipboard?.writeText?.(replyDraft).catch(() => {});
                        }}
                        disabled={!replyDraft}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        <MessageSquareText className="h-4 w-4" />
                        Copy draft
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 p-3 min-[1024px]:col-span-2 min-[1280px]:col-span-1">
                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">AI Assistant</div>
                  <div className="mt-2 space-y-2 text-sm text-slate-200">
                    <SidebarRow label="Most Asked Question" value={labelText(aiSummary.mostFrequentQuestion)} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                    <SidebarRow label="Suggested Reply" value={suggestedReply || "No suggestion yet."} icon={<MessageSquareText className="h-4 w-4 text-emerald-100" />} />
                    <SidebarRow label="Lead Intent" value={`${aiSummary.readyCustomers} ready / ${aiSummary.priceQuestions} price / ${aiSummary.sizeQuestions} size`} icon={<ThumbsUp className="h-4 w-4 text-violet-100" />} />
                    <SidebarRow label="Customer Summary" value={selectFirst(activeComment?.customer_name, activeComment?.commenter_name, activePostDetails?.customer_name, "Customer")} icon={<UserRound className="h-4 w-4 text-amber-100" />} />
                    <SidebarRow label="Auto Reply Status" value={globalSettings.generic_enabled ? "Global ON" : "Global OFF"} icon={<Bot className="h-4 w-4 text-sky-100" />} />
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Global Template</div>
                      <div className="mt-1 text-sm font-black text-white">Generic reply template</div>
                    </div>
                    <button
                      type="button"
                      onClick={onSaveGlobalSettings}
                      disabled={!onSaveGlobalSettings}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label="Enabled"
                      active={globalSettings.generic_enabled}
                      onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                    />
                    <TogglePill
                      label={`Like ${globalSettings.generic_like_enabled ? "ON" : "OFF"}`}
                      active={globalSettings.generic_like_enabled}
                      onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                    />
                    <TogglePill
                      label={`Reply ${globalSettings.generic_reply_enabled ? "ON" : "OFF"}`}
                      active={globalSettings.generic_reply_enabled}
                      onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                    />
                  </div>

                  <select
                    value={globalSettings.mode || "manual_approval"}
                    onChange={(event) => onGlobalSettingsChange?.((current) => ({ ...current, mode: event.target.value }))}
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="off">Off</option>
                    <option value="draft">Draft only</option>
                    <option value="manual_approval">Manual Approval</option>
                    <option value="full_auto">Full Auto</option>
                  </select>

                  <textarea
                    value={globalSettings.generic_template || ""}
                    onChange={(event) => onGlobalSettingsChange?.((current) => ({ ...current, generic_template: event.target.value }))}
                    rows={4}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder="Global auto reply template"
                  />
                  <div className="mt-2 text-[11px] font-medium text-slate-400">OFF by default. Full Auto requires explicit admin enablement.</div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Post Template</div>
                      <div className="mt-1 text-sm font-black text-white">Template specific to this post</div>
                    </div>
                    <button
                      type="button"
                      onClick={onSaveTemplate}
                      disabled={!onSaveTemplate}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label={activeTemplateEnabled ? "Enabled" : "Disabled"}
                      active={activeTemplateEnabled}
                      onClick={() =>
                        onTemplateChange?.((current) => ({
                          ...current,
                          template: { ...(current.template || {}), enabled: !activeTemplateEnabled },
                        }))
                      }
                    />
                    <TogglePill
                      label={`Like ${activeTemplate?.like_enabled !== false ? "ON" : "OFF"}`}
                      active={activeTemplate?.like_enabled !== false}
                      onClick={() =>
                        onTemplateChange?.((current) => ({
                          ...current,
                          template: { ...(current.template || {}), like_enabled: !(current.template?.like_enabled !== false) },
                        }))
                      }
                    />
                    <TogglePill
                      label={`Reply ${activeTemplate?.reply_enabled !== false ? "ON" : "OFF"}`}
                      active={activeTemplate?.reply_enabled !== false}
                      onClick={() =>
                        onTemplateChange?.((current) => ({
                          ...current,
                          template: { ...(current.template || {}), reply_enabled: !(current.template?.reply_enabled !== false) },
                        }))
                      }
                    />
                  </div>

                  <select
                    value={activeTemplate?.mode || "manual_approval"}
                    onChange={(event) =>
                      onTemplateChange?.((current) => ({
                        ...current,
                        template: { ...(current.template || {}), mode: event.target.value },
                      }))
                    }
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="off">Off</option>
                    <option value="draft">Draft only</option>
                    <option value="manual_approval">Manual Approval</option>
                    <option value="full_auto">Full Auto</option>
                  </select>

                  <textarea
                    value={activeTemplate?.template || ""}
                    onChange={(event) =>
                      onTemplateChange?.((current) => ({
                        ...current,
                        template: { ...(current.template || {}), template: event.target.value },
                      }))
                    }
                    rows={5}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder="Template text using {customer_name}, {product_name}, {price}, {sale_price}, {sizes}, {colors}, {product_link}, {post_link}, {store_address}, {shipping_time}"
                  />

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Preview</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {suggestedReply || "No template text yet."}
                    </div>
                  </div>

                  {selectedTemplate?.loading ? <div className="mt-3 text-xs text-slate-500">جارٍ تحميل القالب...</div> : null}
                  {selectedTemplate?.error ? <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{selectedTemplate.error}</div> : null}
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Quick Actions</div>
                  <div className="mt-3 grid gap-2">
                    <QuickActionButton
                      label="Reply All Price Questions"
                      onClick={() => renderCommentAction(firstMatchingComment((comment) => getCommentTags(comment).includes("Price")), "reply")}
                      disabled={!onCommentAction}
                    />
                    <QuickActionButton
                      label="Reply All Size Questions"
                      onClick={() => renderCommentAction(firstMatchingComment((comment) => getCommentTags(comment).includes("Size")), "reply")}
                      disabled={!onCommentAction}
                    />
                    <QuickActionButton
                      label="Create Leads"
                      onClick={() => renderCommentAction(firstMatchingComment((comment) => getCommentTags(comment).includes("Lead")), "lead")}
                      disabled={!onCommentAction}
                    />
                    <QuickActionButton
                      label="Send Product"
                      onClick={() => renderCommentAction(firstMatchingComment(() => true), "private_message")}
                      disabled={!onCommentAction}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function SidebarRow({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-slate-200 ring-1 ring-white/10">{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
          <div className="mt-1 text-sm font-semibold leading-6 text-slate-100">{value}</div>
        </div>
      </div>
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value || "—"}</div>
    </div>
  );
}

function TogglePill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
        active ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

function QuickActionButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-left text-xs font-black text-slate-200 transition hover:border-cyan-300/20 hover:bg-white/[0.06] disabled:opacity-40"
    >
      <span>{label}</span>
      <ArrowUpRight className="h-4 w-4" />
    </button>
  );
}

export default memo(SocialCommentsWorkspace);
