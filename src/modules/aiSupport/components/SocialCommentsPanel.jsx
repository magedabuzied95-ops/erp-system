import { memo, useMemo } from "react";
import { ExternalLink, MessageSquareText, RefreshCw, User } from "lucide-react";

const clean = (value = "") => String(value ?? "").trim();

const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
};

const COMMENT_FILTERS = [
  { key: "all", label: "الكل" },
  { key: "lead_price", label: "سعر" },
  { key: "lead_size", label: "مقاس" },
  { key: "lead_shipping", label: "شحن" },
  { key: "lead_details", label: "تفاصيل" },
  { key: "lead_inbox", label: "Inbox" },
  { key: "ignore", label: "تجاهل" },
  { key: "human_review", label: "مراجعة" },
];

const POST_FILTERS = [
  { key: "all", label: "الكل" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "replied", label: "Replied" },
  { key: "auto_reply_on", label: "Auto Reply" },
];

const COMMENT_LABELS = {
  all: "الكل",
  lead_price: "سعر",
  lead_size: "مقاس",
  lead_shipping: "شحن",
  lead_details: "تفاصيل",
  lead_inbox: "Inbox",
  ignore: "تجاهل",
  human_review: "مراجعة",
};

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key === "instagram" || key === "instagram_comment") {
    return {
      label: "Instagram",
      className: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    };
  }
  return {
    label: "Facebook",
    className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  };
};

const toneClass = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "lead_price") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
  if (key === "lead_size") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  if (key === "lead_shipping") return "border-cyan-300/20 bg-cyan-400/10 text-cyan-100";
  if (key === "lead_details") return "border-violet-300/20 bg-violet-400/10 text-violet-100";
  if (key === "lead_inbox") return "border-slate-300/20 bg-slate-400/10 text-slate-100";
  if (key === "human_review") return "border-rose-300/20 bg-rose-400/10 text-rose-100";
  if (key === "engagement_only" || key === "ignore") return "border-white/10 bg-white/[0.055] text-slate-200";
  return "border-white/10 bg-white/[0.055] text-slate-200";
};

const commentMatches = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  const label = clean(item.classification_label).toLowerCase();
  if (filter === "ignore") return ["ignore", "engagement_only"].includes(label);
  if (filter === "human_review") return label === "human_review";
  return label === filter;
};

const postMatches = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  const platform = clean(item.platform).toLowerCase();
  if (filter === "facebook") return platform === "facebook" || platform === "facebook_comment";
  if (filter === "instagram") return platform === "instagram" || platform === "instagram_comment";
  if (filter === "needs_reply") return Number(item.new_comments_count || 0) > 0 || clean(item.reply_status || item.auto_reply_mode).toLowerCase() !== "sent";
  if (filter === "replied") return clean(item.reply_status || item.auto_reply_mode || item.session_status).toLowerCase() === "sent";
  if (filter === "auto_reply_on") return Boolean(item.auto_reply_enabled || item.template_enabled || item.generic_enabled);
  return true;
};

const sortValueComment = (item = {}) => new Date(item.created_at || 0).getTime() || 0;
const sortValuePost = (item = {}) => new Date(item.last_activity_at || item.last_comment_at || item.last_message_at || item.updated_at || item.created_at || 0).getTime() || 0;

function SocialCommentsPanel({
  items = [],
  loading = false,
  error = "",
  filter = "all",
  debugInfo = null,
  mode = "comments",
  selectedItemId = "",
  onSelectItem,
  onFilterChange,
  onRefresh,
}) {
  const filters = mode === "posts" ? POST_FILTERS : COMMENT_FILTERS;
  const filteredItems = useMemo(
    () =>
      [...items]
        .filter((item) => (mode === "posts" ? postMatches(item, filter) : commentMatches(item, filter)))
        .sort((a, b) => (mode === "posts" ? sortValuePost(b) - sortValuePost(a) : sortValueComment(b) - sortValueComment(a))),
    [filter, items, mode]
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">
            <MessageSquareText className="h-4 w-4" />
            {mode === "posts" ? "منشورات التعليقات" : "تعليقات السوشيال"}
          </div>
          <div className="mt-1 text-sm font-black text-white">
            {mode === "posts" ? "آخر المنشورات المرتبطة بالتعليقات" : "آخر التعليقات المخزنة في نظام المتابعة"}
          </div>
          {debugInfo ? (
            <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-400">
              {debugInfo.request_url ? <span className="mr-2">URL: {debugInfo.request_url}</span> : null}
              {debugInfo.tenant_id ? <span className="mr-2">tenant: {debugInfo.tenant_id}</span> : null}
              {typeof debugInfo.status !== "undefined" ? <span className="mr-2">status: {String(debugInfo.status)}</span> : null}
              {typeof debugInfo.count !== "undefined" ? <span>count: {String(debugInfo.count)}</span> : null}
              {debugInfo.error ? <span className="block text-rose-200">error: {debugInfo.error}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
          <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] font-black text-slate-200">
            {filteredItems.length}/{items.length}
          </span>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {filters.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilterChange?.(item.key)}
              className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black transition ${
                active ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1">
        {loading && !items.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
            {mode === "posts" ? "جارٍ تحميل منشورات التعليقات..." : "جارٍ تحميل تعليقات السوشيال..."}
          </div>
        ) : null}

        {!loading && filteredItems.length ? (
          <div className="space-y-2">
            {filteredItems.slice(0, 50).map((item) => {
              const platform = platformMeta(item.platform);
              const itemKey = clean(item.id || item.conversation_id || item.comment_id || item.post_id || `${item.platform || "social"}:${item.post_id || item.comment_id || ""}`);
              const active = clean(selectedItemId) === itemKey;

              if (mode === "posts") {
                const title = clean(item.post_message || item.post_caption || item.last_message || item.last_comment_text || "منشور بدون نص");
                const subtitle = clean(item.last_comment_text || item.last_message || item.post_caption || item.post_message || "");
                const thumb = clean(item.post_full_picture || item.full_picture || item.product_image_url || item.product_image || item.thumbnail_url || item.image_url);
                return (
                  <article
                    key={itemKey}
                    role={onSelectItem ? "button" : undefined}
                    tabIndex={onSelectItem ? 0 : undefined}
                    onClick={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                    onKeyDown={onSelectItem ? (event) => { if (event.key === "Enter" || event.key === " ") onSelectItem(item, itemKey); } : undefined}
                    className={`rounded-2xl border bg-slate-950/60 p-3 transition ${active ? "border-cyan-300/40 ring-1 ring-cyan-300/20" : "border-white/10 hover:border-cyan-300/20 hover:bg-slate-950/70"}`}
                  >
                    <div className="flex gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-white">{title}</div>
                            <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{subtitle || "بدون وصف"}</div>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${platform.className}`}>
                            <User className="h-3.5 w-3.5" />
                            {platform.label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                            {Number(item.comments_count || 0)} comments
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                            {Number(item.new_comments_count || 0)} new
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${toneClass(item.auto_reply_mode || item.session_status || "human_review")}`}>
                            {clean(item.auto_reply_mode || item.session_status || item.reply_status || "manual").replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-400">
                      {subtitle ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">آخر تعليق: {subtitle}</span> : null}
                      {item.last_activity_at ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">{absoluteTime(item.last_activity_at)}</span> : null}
                      {item.post_permalink || item.post_permalink_url || item.permalink_url || item.post_url ? (
                        <a
                          href={clean(item.post_permalink || item.post_permalink_url || item.permalink_url || item.post_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-100"
                        >
                          فتح البوست
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              }

              const label = COMMENT_LABELS[clean(item.classification_label).toLowerCase()] || clean(item.classification_label) || "غير مصنف";
              const permalink = clean(item.post_permalink);
              const commentText = clean(item.original_comment_text || "");
              return (
                <article
                  key={itemKey}
                  role={onSelectItem ? "button" : undefined}
                  tabIndex={onSelectItem ? 0 : undefined}
                  onClick={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                  onKeyDown={onSelectItem ? (event) => { if (event.key === "Enter" || event.key === " ") onSelectItem(item, itemKey); } : undefined}
                  className={`rounded-2xl border bg-slate-950/60 p-3 transition ${active ? "border-cyan-300/40 ring-1 ring-cyan-300/20" : "border-white/10 hover:border-cyan-300/20 hover:bg-slate-950/70"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${platform.className}`}>
                        <User className="h-3.5 w-3.5" />
                        {platform.label}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${toneClass(item.classification_label)}`}>
                        {label}
                      </span>
                    </div>
                    {item.action_taken ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                        {clean(item.action_taken)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-white">{clean(item.commenter_name) || "مستخدم مجهول"}</div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{commentText || "بدون نص"}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-400">
                    {permalink ? (
                      <a
                        href={permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-100"
                      >
                        فتح المنشور
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {item.created_at ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">{absoluteTime(item.created_at)}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !loading ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
            {mode === "posts" ? "لا توجد منشورات مطابقة للمرشح الحالي." : "لا توجد تعليقات سوشيال مطابقة للمرشح الحالي."}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default memo(SocialCommentsPanel);
