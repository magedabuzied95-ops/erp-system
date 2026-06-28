import { memo, useEffect, useMemo } from "react";
import { Clock3, ExternalLink, MessageSquareText, RefreshCw, User } from "lucide-react";
import { VirtualList } from "../../../shared/components/VirtualList";
import { CommentTimelineCard } from "./socialCommentTimeline.jsx";

const clean = (value = "") => String(value ?? "").trim();
const DEBUG_SOCIAL_PERF = false;

const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
};

const COMMENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "lead_price", label: "Price" },
  { key: "lead_size", label: "Size" },
  { key: "lead_shipping", label: "Shipping" },
  { key: "lead_details", label: "Details" },
  { key: "lead_inbox", label: "Inbox" },
  { key: "ignore", label: "Ignore" },
  { key: "human_review", label: "Human Review" },
];

const POST_FILTERS = [
  { key: "all", label: "All" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "needs_reply", label: "Needs Reply" },
  { key: "replied", label: "Replied" },
  { key: "auto_reply_on", label: "Auto Reply" },
];

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) {
    return {
      label: "Instagram",
      className: "border-[#FBCFE8] bg-[#FFF1F2] text-[#E1306C]",
    };
  }
  return {
    label: "Facebook",
    className: "border-[#BFDBFE] bg-[#EAF2FF] text-[#1877F2]",
  };
};

const toneClass = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "lead_price") return "border-[#BFDBFE] bg-[#EAF2FF] text-[#1877F2]";
  if (key === "lead_size") return "border-[#E9D5FF] bg-[#F5F3FF] text-[#7C3AED]";
  if (key === "lead_shipping") return "border-[#BBF7D0] bg-[#ECFDF5] text-[#059669]";
  if (key === "lead_details") return "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]";
  if (key === "lead_inbox") return "border-slate-200 bg-slate-100 text-slate-600";
  if (key === "human_review") return "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]";
  if (key === "engagement_only" || key === "ignore") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-slate-200 bg-slate-50 text-slate-600";
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
const sortValuePost = (item = {}) => new Date(item.real_comment_created_time || 0).getTime() || 0;

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
  onLoadMore,
  nextCursor = "",
  loadingMore = false,
}) {
  const filters = mode === "posts" ? POST_FILTERS : COMMENT_FILTERS;
  const filteredItems = useMemo(
    () =>
      [...items]
        .filter((item) => (mode === "posts" ? postMatches(item, filter) : commentMatches(item, filter)))
        .sort((a, b) => (mode === "posts" ? sortValuePost(b) - sortValuePost(a) : sortValueComment(b) - sortValueComment(a))),
    [filter, items, mode]
  );
  const useVirtualRows = filteredItems.length > 50;

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF) return;
    console.log("[SocialCommentsPanel][rendered-rows]", {
      mode,
      total: filteredItems.length,
      rendered: useVirtualRows ? Math.min(filteredItems.length, 18) : filteredItems.length,
    });
  }, [filteredItems.length, mode, useVirtualRows]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
            <MessageSquareText className="h-4 w-4" />
            {mode === "posts" ? "Social Posts" : "Social Comments"}
          </div>
          <div className="mt-1 text-sm font-black text-slate-900">
            {mode === "posts" ? "Latest posts with comment activity" : "Latest comments in the system"}
          </div>
          {debugInfo ? (
            <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-400">
              {debugInfo.request_url ? <span className="mr-2">URL: {debugInfo.request_url}</span> : null}
              {debugInfo.tenant_id ? <span className="mr-2">tenant: {debugInfo.tenant_id}</span> : null}
              {typeof debugInfo.status !== "undefined" ? <span className="mr-2">status: {String(debugInfo.status)}</span> : null}
              {typeof debugInfo.count !== "undefined" ? <span>count: {String(debugInfo.count)}</span> : null}
              {debugInfo.error ? <span className="block text-rose-600">error: {debugInfo.error}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-900 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-black text-slate-600">
            {filteredItems.length}/{items.length}
          </span>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {filters.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilterChange?.(item.key)}
              className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black transition ${
                active ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1">
        {loading && !items.length ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            {mode === "posts" ? "Loading social posts..." : "Loading social comments..."}
          </div>
        ) : null}

        {!loading && filteredItems.length ? (
          <div className="space-y-2">
            {useVirtualRows ? (
              <VirtualList
                items={filteredItems}
                estimateSize={mode === "posts" ? 190 : 180}
                overscan={8}
                className="max-h-[26rem]"
                itemKey={(item, index) => clean(item.id || item.conversation_id || item.comment_id || item.post_id || index)}
                renderItem={(item) => {
                  const platform = platformMeta(item.platform);
                  const itemKey = clean(item.id || item.conversation_id || item.comment_id || item.post_id || `${item.platform || "social"}:${item.post_id || item.comment_id || ""}`);
                  const active = clean(selectedItemId) === itemKey;
                  if (mode === "posts") {
                    const title = clean(item.post_message || item.post_caption || item.last_message || item.last_comment_text || "Post");
                    const subtitle = clean(item.last_comment_text || item.last_message || item.post_caption || item.post_message || "");
                    const thumb = clean(item.thumbnail_url || "");
                    return (
                      <article
                        role={onSelectItem ? "button" : undefined}
                        tabIndex={onSelectItem ? 0 : undefined}
                        onClick={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                        onKeyDown={
                          onSelectItem
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") onSelectItem(item, itemKey);
                              }
                            : undefined
                        }
                        className={`rounded-2xl border p-3 transition shadow-[0_8px_24px_rgba(15,23,42,0.05)] ${
                          active ? "border-slate-300 ring-1 ring-slate-200" : "border-slate-200 hover:border-slate-300"
                        }`}
                        style={{ minHeight: "176px" }}
                      >
                        <div className="flex gap-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm font-black leading-6 text-slate-900">{title}</div>
                                <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{subtitle || "No description"}</div>
                              </div>
                              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${platform.className}`}>
                                <User className="h-3.5 w-3.5" />
                                {platform.label}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{Number(item.comments_count || 0)} comments</span>
                              <span className={`rounded-full border px-2.5 py-1 ${item.new_comments_count > 0 ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" : "border-slate-200 bg-white text-slate-600"}`}>{Number(item.new_comments_count || 0)} new</span>
                              <span className={`rounded-full border px-2.5 py-1 ${toneClass(item.auto_reply_mode || item.session_status || "human_review")}`}>{clean(item.auto_reply_mode || item.session_status || item.reply_status || "manual").replace(/_/g, " ")}</span>
                              {item.needsReply ? <span className="rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-1 text-[#C2410C]">Needs reply</span> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
                              {subtitle ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">{" "}{subtitle}</span> : null}
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
                                <Clock3 className="h-3.5 w-3.5" />
                                {item.real_comment_created_time ? absoluteTime(item.real_comment_created_time) : "Unknown"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  }
                  const permalink = clean(item.post_permalink);
                  return (
                    <CommentTimelineCard
                      comment={item}
                      selected={active}
                      onSelect={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                      fallbackPlatform={item.platform || "facebook"}
                    >
                      {permalink ? (
                        <a
                          href={permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700"
                        >
                          Open comment
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </CommentTimelineCard>
                  );
                }}
              />
            ) : filteredItems.slice(0, 50).map((item) => {
              const platform = platformMeta(item.platform);
              const itemKey = clean(item.id || item.conversation_id || item.comment_id || item.post_id || `${item.platform || "social"}:${item.post_id || item.comment_id || ""}`);
              const active = clean(selectedItemId) === itemKey;

              if (mode === "posts") {
                const title = clean(item.post_message || item.post_caption || item.last_message || item.last_comment_text || "Post");
                const subtitle = clean(item.last_comment_text || item.last_message || item.post_caption || item.post_message || "");
                const thumb = clean(item.thumbnail_url || "");
                return (
                  <article
                    key={itemKey}
                    role={onSelectItem ? "button" : undefined}
                    tabIndex={onSelectItem ? 0 : undefined}
                    onClick={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                    onKeyDown={
                      onSelectItem
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") onSelectItem(item, itemKey);
                          }
                        : undefined
                    }
                    className={`rounded-2xl border p-3 transition shadow-[0_8px_24px_rgba(15,23,42,0.05)] ${
                      active ? "border-slate-300 ring-1 ring-slate-200" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-black leading-6 text-slate-900">{title}</div>
                            <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{subtitle || "No description"}</div>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${platform.className}`}>
                            <User className="h-3.5 w-3.5" />
                            {platform.label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{Number(item.comments_count || 0)} comments</span>
                          <span className={`rounded-full border px-2.5 py-1 ${item.new_comments_count > 0 ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" : "border-slate-200 bg-white text-slate-600"}`}>{Number(item.new_comments_count || 0)} new</span>
                          <span className={`rounded-full border px-2.5 py-1 ${toneClass(item.auto_reply_mode || item.session_status || "human_review")}`}>{clean(item.auto_reply_mode || item.session_status || item.reply_status || "manual").replace(/_/g, " ")}</span>
                          {item.needsReply ? <span className="rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-1 text-[#C2410C]">Needs reply</span> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-500">
                          {subtitle ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">{" "}{subtitle}</span> : null}
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
                            <Clock3 className="h-3.5 w-3.5" />
                            {item.real_comment_created_time ? absoluteTime(item.real_comment_created_time) : "Unknown"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }

              const permalink = clean(item.post_permalink);
              return (
                <CommentTimelineCard
                  key={itemKey}
                  comment={item}
                  selected={active}
                  onSelect={onSelectItem ? () => onSelectItem(item, itemKey) : undefined}
                  fallbackPlatform={item.platform || "facebook"}
                >
                  {permalink ? (
                    <a
                      href={permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700"
                    >
                      Open comment
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </CommentTimelineCard>
              );
            })}
            {onLoadMore && nextCursor ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-900 disabled:opacity-50"
                >
                  {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        ) : !loading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            {mode === "posts" ? "No matching posts." : "No matching comments."}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default memo(SocialCommentsPanel);
