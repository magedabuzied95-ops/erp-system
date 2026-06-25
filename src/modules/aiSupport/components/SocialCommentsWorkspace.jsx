import { memo, useMemo } from "react";
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

const postKey = (item = {}) =>
  clean(
    item.conversation_id ||
      item.session_id ||
      item.post_id ||
      item.id ||
      item.comment_id ||
      `${item.platform || "social"}:${item.post_id || item.id || item.comment_id || ""}`
  );

const commentKey = (item = {}) =>
  clean(
    item.comment_id ||
      item.id ||
      item.external_message_id ||
      item.provider_message_id ||
      `${item.platform || "social"}:${item.created_at || ""}:${item.message_text || item.customer_message || item.text || ""}`
  );

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) {
    return { label: "Instagram", tone: "rose", className: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
  }
  return { label: "Facebook", tone: "cyan", className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100" };
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
  clean(
    post.post_caption ||
      post.post_message ||
      post.last_message ||
      post.post_text ||
      post.message ||
      ""
  );

const getLastCommentText = (post = {}) => clean(post.last_comment_text || post.last_message || "");

const classifyComment = (comment = {}) => clean(comment.classification_label || comment.reply_status || comment.auto_reply_mode || "pending");

const labelText = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "lead_price") return "سعر";
  if (key === "lead_size") return "مقاس";
  if (key === "lead_shipping") return "شحن";
  if (key === "lead_details") return "تفاصيل";
  if (key === "lead_inbox") return "جاهز للشراء";
  if (key === "human_review") return "مراجعة";
  if (key === "ignore" || key === "engagement_only") return "تجاهل";
  if (key === "sent") return "تم الرد";
  if (key === "failed") return "فشل";
  return value ? value.replace(/_/g, " ") : "—";
};

const summaryBucketLabel = (comment = {}) => {
  const classification = clean(comment.classification_label || "").toLowerCase();
  const text = clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || "");
  const haystack = `${classification} ${text}`.toLowerCase();
  if (classification === "lead_price" || /(price|سعر|بكام|كام|ثمن)/i.test(haystack)) return "price";
  if (classification === "lead_size" || /(size|مقاس|المقاس)/i.test(haystack)) return "size";
  if (classification === "lead_shipping" || /(shipping|شحن|توصيل)/i.test(haystack)) return "shipping";
  if (classification === "lead_details" || /(details|تفاصيل|معلومات)/i.test(haystack)) return "details";
  if (classification === "lead_inbox" || /(جاهز|buy|order|عاوز|عايزة|اريد|أريد|طلب)/i.test(haystack)) return "ready";
  return "other";
};

const templatePreviewText = (template = {}, context = {}) => {
  const raw = clean(template.template || template.text || "");
  if (!raw) return "";
  return raw.replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = (leftKey || rightKey || "").toLowerCase();
    return clean(context[key] ?? context[key.replace(/_([a-z])/g, (_m, letter) => letter.toUpperCase())] ?? "");
  });
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

const getCommentBucket = (comment = {}) => {
  const classification = clean(comment.classification_label || comment.reply_status || comment.auto_reply_mode || "").toLowerCase();
  const textValue = clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || "");
  const haystack = `${classification} ${textValue}`.toLowerCase();
  if (classification === "lead_price" || /(price|سعر|ثمن|بكام|كم)/i.test(haystack)) return "Price";
  if (classification === "lead_size" || /(size|مقاس|المقاس)/i.test(haystack)) return "Size";
  if (classification === "lead_shipping" || /(shipping|شحن|توصيل)/i.test(haystack)) return "Shipping";
  if (classification === "lead_details" || /(details|تفاصيل|معلومات)/i.test(haystack)) return "Question";
  if (classification === "lead_inbox" || /(جاهز|buy|order|عاوز|أريد|طلب)/i.test(haystack)) return "Lead";
  if (classification === "ignore" || classification === "engagement_only") return "Spam";
  return "Question";
};

const getCommentTags = (comment = {}) => {
  const tags = new Set();
  const bucket = getCommentBucket(comment);
  if (bucket) tags.add(bucket);
  const classification = clean(comment.classification_label || "").toLowerCase();
  if (classification === "human_review") tags.add("Question");
  if (classification === "lead_inbox") tags.add("Lead");
  if (classification === "ignore") tags.add("Spam");
  if (/(price|سعر|ثمن|بكام|كم)/i.test(clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || ""))) tags.add("Price");
  if (/(size|مقاس|المقاس)/i.test(clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || ""))) tags.add("Size");
  if (/(shipping|شحن|توصيل)/i.test(clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || ""))) tags.add("Shipping");
  return Array.from(tags).slice(0, 4);
};

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
      [...(Array.isArray(items) ? items : [])].sort(
        (left, right) =>
          new Date(right.last_activity_at || right.last_comment_at || right.last_message_at || right.updated_at || right.created_at || 0).getTime() -
          new Date(left.last_activity_at || left.last_comment_at || left.last_message_at || left.updated_at || left.created_at || 0).getTime()
      ),
    [items]
  );

  const activePost = selectedPost || posts[0] || null;
  const activePostKey = clean(selectedPostId || postKey(activePost));
  const activeThread = selectedThread || { post: null, comments: [], loading: false, error: "" };
  const activeTemplate = selectedTemplate?.template || null;
  const comments = Array.isArray(activeThread.comments) ? activeThread.comments : [];

  const dashboard = useMemo(() => {
    const totalComments = posts.reduce((sum, post) => sum + Number(post.comments_count || 0), 0);
    const newComments = posts.reduce((sum, post) => sum + Number(post.new_comments_count || 0), 0);
    const needsReply = posts.filter((post) => Number(post.new_comments_count || 0) > 0 || clean(post.reply_status || post.auto_reply_mode || post.session_status).toLowerCase() !== "sent").length;
    const replied = posts.filter((post) => clean(post.reply_status || post.auto_reply_mode || post.session_status).toLowerCase() === "sent").length;
    const autoReplyOn = posts.filter((post) => Boolean(post.auto_reply_enabled || post.template_enabled || post.generic_enabled)).length;
    return { totalComments, newComments, needsReply, replied, autoReplyOn };
  }, [posts]);

  const aiSummary = useMemo(() => {
    const buckets = { price: 0, size: 0, shipping: 0, details: 0, ready: 0, other: 0 };
    for (const comment of comments) {
      buckets[summaryBucketLabel(comment)] += 1;
    }
    const entries = Object.entries(buckets).sort((left, right) => right[1] - left[1]);
    const mostFrequentQuestion = entries.find(([, value]) => value > 0)?.[0] || "other";
    const priceQuestions = buckets.price;
    const sizeQuestions = buckets.size;
    const readyCustomers = buckets.ready;
    return { mostFrequentQuestion, priceQuestions, sizeQuestions, readyCustomers, buckets };
  }, [comments]);

  const postContext = {
    customer_name: clean(comments[0]?.commenter_name || comments[0]?.customer_name || "Customer"),
    product_name: clean(activePost?.product_name || ""),
    price: clean(activePost?.product_price || ""),
    sale_price: clean(activePost?.product_sale_price || ""),
    sizes: clean(activePost?.product_sizes || ""),
    colors: clean(activePost?.product_colors || ""),
    product_link: clean(activePost?.product_storefront_url || activePost?.product_link || ""),
    post_link: clean(activePost?.post_permalink || activePost?.post_permalink_url || activePost?.permalink_url || activePost?.post_url || ""),
    store_address: clean(activePost?.store_address || ""),
    shipping_time: clean(activePost?.shipping_time || ""),
  };

  const suggestionTemplate = activeTemplate || { template: globalSettings.generic_template || "" };
  const suggestedReply = templatePreviewText(suggestionTemplate, postContext);
  const templateUsed = activeTemplate?.enabled
    ? "Post template"
    : globalSettings.generic_enabled
      ? "Generic template"
      : "Manual reply";

  const renderCommentAction = (comment, action) => {
    if (!onCommentAction) return;
    onCommentAction(comment, action);
  };

  return (
    <section className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">
            <MessageSquareText className="h-3.5 w-3.5" />
            AI Social Media Center
          </div>
          <div className="mt-1 text-[18px] font-black text-white">Social Comments</div>
          <div className="mt-0.5 text-xs text-slate-400">Post-based workspace for comments, auto replies, and summaries.</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          تحديث
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 md:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Total</div>
          <div className="mt-1 text-lg font-black text-white">{dashboard.totalComments}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">New</div>
          <div className="mt-1 text-lg font-black text-cyan-100">{dashboard.newComments}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Needs reply</div>
          <div className="mt-1 text-lg font-black text-amber-100">{dashboard.needsReply}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Replied</div>
          <div className="mt-1 text-lg font-black text-violet-100">{dashboard.replied}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Auto reply</div>
          <div className="mt-1 text-base font-black text-emerald-100">{globalSettings.generic_enabled ? "ON" : "OFF"}</div>
        </div>
      </div>

      <div className="mt-3 grid min-h-0 gap-2 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,360px)]">
        <aside className="min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/55 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Posts</div>
              <div className="mt-1 text-sm font-black text-white">{posts.length} منشور</div>
            </div>
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-[11px] font-black text-slate-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            ) : null}
          </div>

          <div className="mt-2.5 max-h-[34rem] space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-19rem)]">
            {!posts.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
                لا توجد منشورات متاحة حاليًا
              </div>
            ) : null}
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
                    active ? "border-cyan-300/40 bg-cyan-300/10 ring-1 ring-cyan-300/20" : "border-white/10 bg-white/[0.04] hover:border-cyan-300/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-400">
                          <div className="flex flex-col items-center gap-1">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                              <ImageIcon className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">No image</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-black text-white">{getPostCaption(post) || "Post"}</div>
                          <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{getLastCommentText(post) || "بدون تعليق أخير"}</div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.className}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{Number(post.comments_count || 0)} comments</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{Number(post.new_comments_count || 0)} new</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{clean(post.reply_status || post.auto_reply_mode || post.session_status || "manual").replace(/_/g, " ")}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-400">
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
        </aside>

        <main className="min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.16)]">
          {activePost ? (
            <div className="flex min-h-0 h-full flex-col gap-2.5">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70">
                <div className="max-h-[24rem] w-full overflow-hidden bg-slate-900">
                  <div className="aspect-[16/9] w-full">
                    {getPostImage(activePost) ? (
                      <img src={getPostImage(activePost)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-500">
                        <div className="flex flex-col items-center gap-3">
                          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                            <Sparkles className="h-6 w-6 text-cyan-100" />
                          </span>
                          <span className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">No preview image</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">
                        {clean(activePost.platform).toLowerCase().includes("instagram") ? "Instagram Post" : "Facebook Post"}
                      </div>
                      <h2 className="mt-1 line-clamp-3 text-lg font-black text-white">{getPostCaption(activePost) || "Post"}</h2>
                    </div>
                    {clean(activePost.post_permalink || activePost.post_permalink_url || activePost.permalink_url || activePost.post_url) ? (
                      <a
                        href={clean(activePost.post_permalink || activePost.post_permalink_url || activePost.permalink_url || activePost.post_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100"
                      >
                        فتح البوست
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Platform" value={platformMeta(activePost.platform).label} />
                    <InfoCard label="Comments" value={Number(activePost.comments_count || 0)} />
                    <InfoCard label="New" value={Number(activePost.new_comments_count || 0)} />
                    <InfoCard label="Last activity" value={absoluteTime(activePost.last_activity_at || activePost.last_comment_at || activePost.last_message_at || activePost.updated_at || activePost.created_at)} />
                    <InfoCard label="Last comment" value={getLastCommentText(activePost) || "—"} />
                    <InfoCard label="Auto reply" value={clean(activePost.reply_status || activePost.auto_reply_mode || activePost.session_status || "manual").replace(/_/g, " ")} />
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
                <section className="min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/55 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Comments Timeline</div>
                      <div className="mt-1 text-sm font-black text-white">{comments.length} تعليق</div>
                    </div>
                    {activeThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : null}
                  </div>
                  {activeThread.error ? (
                    <div className="mt-3 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{activeThread.error}</div>
                  ) : null}
                  <div className="mt-2.5 max-h-[24rem] space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-24rem)]">
                    {!comments.length && !activeThread.loading ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
                        لا توجد تعليقات سوشيال حاليًا
                      </div>
                    ) : null}
                    {comments.map((comment) => {
                      const key = commentKey(comment);
                      const status = clean(classifyComment(comment));
                      const avatar = clean(comment.commenter_profile_picture_url || comment.customer_avatar_url || comment.avatar_url || comment.profile_pic || "");
                      const name = clean(comment.customer_name || comment.commenter_name || comment.from_name || "Customer");
                      const text = clean(comment.customer_message || comment.message_text || comment.original_comment_text || comment.text || comment.message || "بدون نص");
                      const tags = getCommentTags(comment);
                      const actionBusy = actionLoading === key;
                      return (
                        <article key={key || `${comment.created_at || ""}:${name}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
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
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${status === "sent" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : status === "failed" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>
                                  {labelText(status)}
                                </span>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{text}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {tags.map((tag) => (
                                  <span key={tag} className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                                    tag === "Price"
                                      ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                                      : tag === "Size"
                                        ? "border-violet-300/20 bg-violet-400/10 text-violet-100"
                                        : tag === "Shipping"
                                          ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
                                          : tag === "Lead"
                                            ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                            : "border-white/10 bg-white/[0.04] text-slate-300"
                                  }`}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "reply")}
                                  disabled={!onCommentAction || actionBusy}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                                >
                                  {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  رد
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "private_message")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                  رسالة خاصة
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "lead")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                                >
                                  <ShoppingBag className="h-4 w-4" />
                                  إنشاء Lead
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renderCommentAction(comment, "ignore")}
                                  disabled={!onCommentAction}
                                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-300 disabled:opacity-50"
                                >
                                  <ShieldBan className="h-4 w-4" />
                                  تجاهل
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <aside className="space-y-3">
                  <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">AI Assistant</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-200">
                      <SummaryLine label="Most asked question" value={labelText(aiSummary.mostFrequentQuestion)} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                      <SummaryLine label="Suggested reply" value={suggestedReply || "No suggestion yet."} icon={<MessageSquareText className="h-4 w-4 text-emerald-100" />} />
                      <SummaryLine label="Lead intent" value={`${aiSummary.readyCustomers} ready / ${aiSummary.priceQuestions} price / ${aiSummary.sizeQuestions} size`} icon={<ThumbsUp className="h-4 w-4 text-violet-100" />} />
                      <SummaryLine label="Template used" value={templateUsed} icon={<Send className="h-4 w-4 text-amber-100" />} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!suggestedReply) return;
                          navigator?.clipboard?.writeText?.(suggestedReply).catch(() => {});
                        }}
                        disabled={!suggestedReply}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                      >
                        <MessageSquareText className="h-4 w-4" />
                        Copy suggested reply
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const firstComment = comments[0];
                          if (firstComment && onCommentAction) {
                            onCommentAction(firstComment, "reply");
                          }
                        }}
                        disabled={!comments.length || !onCommentAction}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Send to top comment
                      </button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Global Auto Reply</div>
                        <div className="mt-1 text-sm font-black text-white">Like + Reply system</div>
                      </div>
                      <button
                        type="button"
                        onClick={onSaveGlobalSettings}
                        disabled={!onSaveGlobalSettings}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${globalSettings.generic_enabled ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        {globalSettings.generic_enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${globalSettings.generic_like_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        Like {globalSettings.generic_like_enabled ? "ON" : "OFF"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onGlobalSettingsChange?.((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${globalSettings.generic_reply_enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        Reply {globalSettings.generic_reply_enabled ? "ON" : "OFF"}
                      </button>
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
                      placeholder="Generic auto reply template"
                    />
                    <div className="mt-2 text-[11px] font-semibold text-slate-400">
                      OFF by default · Full Auto requires explicit admin enablement
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Post Template</div>
                        <div className="mt-1 text-sm font-black text-white">Specific template for this post</div>
                      </div>
                      <button
                        type="button"
                        onClick={onSaveTemplate}
                        disabled={!onSaveTemplate}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onTemplateChange?.((current) => ({ ...current, template: { ...(current.template || {}), enabled: !Boolean(current.template?.enabled) } }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${activeTemplate?.enabled ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        {activeTemplate?.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTemplateChange?.((current) => ({ ...current, template: { ...(current.template || {}), like_enabled: !(current.template?.like_enabled ?? true) } }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${activeTemplate?.like_enabled !== false ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        Like {activeTemplate?.like_enabled !== false ? "ON" : "OFF"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTemplateChange?.((current) => ({ ...current, template: { ...(current.template || {}), reply_enabled: !(current.template?.reply_enabled ?? true) } }))}
                        className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${activeTemplate?.reply_enabled !== false ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "border border-white/10 bg-white/[0.04] text-slate-200"}`}
                      >
                        Reply {activeTemplate?.reply_enabled !== false ? "ON" : "OFF"}
                      </button>
                    </div>
                    <select
                      value={clean(activeTemplate?.mode || globalSettings.mode || "manual_approval")}
                      onChange={(event) => onTemplateChange?.((current) => ({ ...current, template: { ...(current.template || {}), mode: event.target.value } }))}
                      className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="draft">Draft only</option>
                      <option value="manual_approval">Manual Approval</option>
                      <option value="full_auto">Full Auto</option>
                    </select>
                    <textarea
                      value={clean(activeTemplate?.template || "")}
                      onChange={(event) => onTemplateChange?.((current) => ({ ...current, template: { ...(current.template || {}), template: event.target.value } }))}
                      rows={5}
                      className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                      placeholder="Use {customer_name}, {product_name}, {price}, {sale_price}, {sizes}, {colors}, {product_link}, {post_link}, {store_address}, {shipping_time}"
                    />
                    <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Preview</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                        {suggestedReply || "No template text yet."}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">AI Summary</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-200">
                      <SummaryLine label="أكثر سؤال متكرر" value={labelText(aiSummary.mostFrequentQuestion)} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                      <SummaryLine label="عدد أسئلة السعر" value={aiSummary.priceQuestions} icon={<MessageSquareText className="h-4 w-4 text-emerald-100" />} />
                      <SummaryLine label="عدد أسئلة المقاس" value={aiSummary.sizeQuestions} icon={<MessageCircle className="h-4 w-4 text-amber-100" />} />
                      <SummaryLine label="عدد الجاهزين للشراء" value={aiSummary.readyCustomers} icon={<ThumbsUp className="h-4 w-4 text-violet-100" />} />
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[18rem] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
              لا توجد تعليقات سوشيال حاليًا
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{String(value ?? "—") || "—"}</div>
    </div>
  );
}

function SummaryLine({ label, value, icon }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
        <div className="mt-1 text-sm font-black text-white">{String(value ?? "—") || "—"}</div>
      </div>
    </div>
  );
}

export default memo(SocialCommentsWorkspace);
