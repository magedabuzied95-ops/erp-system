import { memo, useCallback, useMemo, useRef } from "react";
import { Clock3, ExternalLink, Image as ImageIcon, MessageSquareText, Play, RefreshCw, User } from "lucide-react";
import { VirtualList } from "../../../shared/components/VirtualList";
import { CommentTimelineCard } from "./socialCommentTimeline.jsx";

const clean = (value = "") => String(value ?? "").trim();
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
const sortValuePost = (item = {}) =>
  new Date(
    item.display_created_at ||
      item.displayCreatedAt ||
      item.post_created_time ||
      item.postCreatedTime ||
      item.published_at ||
      item.publishedAt ||
      item.created_time ||
      item.created_at ||
      item.real_comment_created_time ||
      item.last_activity_at ||
      0
  ).getTime() || 0;

const getPostVisibleTime = (item = {}) =>
  clean(
    item.post_created_time ||
      item.postCreatedTime ||
      item.real_comment_created_time ||
      item.realCommentCreatedTime ||
      item.comment_created_time ||
      item.commentCreatedTime ||
      ""
  );

const postMedia = (item = {}) => {
  const metadata = item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {};
  const mediaType = clean(item.media_type || item.post_type || item.type || metadata.media_type || metadata.post_type).toLowerCase();
  const permalink = clean(item.permalink_url || item.post_permalink_url || item.post_permalink || item.post_url || metadata.permalink_url).toLowerCase();
  const isVideo = mediaType.includes("video") || mediaType.includes("reel") || permalink.includes("/reel/") || permalink.includes("/videos/");
  const thumbnail = clean(
    item.thumbnail_url ||
      item.thumbnailUrl ||
      item.displayImage ||
      item.cover_image_url ||
      item.post_image_url ||
      item.post_full_picture ||
      item.full_picture ||
      item.picture ||
      item.image_url ||
      metadata.thumbnail_url ||
      metadata.post_image_url ||
      metadata.post_full_picture ||
      metadata.full_picture ||
      metadata.picture ||
      metadata.image_url
  );
  const videoUrl = clean(item.video_url || item.source_url || metadata.video_url || metadata.source_url || (isVideo ? item.media_url || metadata.media_url : ""));
  return { isVideo, thumbnail, videoUrl };
};

const socialCommentItemKey = (item = {}) =>
  clean(item.id || item.conversation_id || item.comment_id || item.post_id || `${item.platform || "social"}:${item.post_id || item.comment_id || ""}`);

const socialCommentItemsEqual = (left = {}, right = {}) =>
  clean(left.id) === clean(right.id) &&
  clean(left.post_id) === clean(right.post_id) &&
  clean(left.external_comment_id) === clean(right.external_comment_id) &&
  clean(left.customer_name) === clean(right.customer_name) &&
  clean(left.customer_avatar_url) === clean(right.customer_avatar_url) &&
  clean(left.message_preview) === clean(right.message_preview) &&
  clean(left.last_activity_at) === clean(right.last_activity_at) &&
  clean(left.status) === clean(right.status) &&
  clean(left.reply_status) === clean(right.reply_status) &&
  clean(left.auto_reply_mode) === clean(right.auto_reply_mode) &&
  clean(left.session_status) === clean(right.session_status) &&
  clean(left.replyStatus) === clean(right.replyStatus) &&
  clean(left.autoReplyMode) === clean(right.autoReplyMode) &&
  clean(left.sessionStatus) === clean(right.sessionStatus) &&
  clean(left.public_reply_status) === clean(right.public_reply_status) &&
  clean(left.dm_status) === clean(right.dm_status) &&
  clean(left.like_status) === clean(right.like_status) &&
  clean(left.automation_status) === clean(right.automation_status) &&
  clean(left.product_id) === clean(right.product_id) &&
  clean(left.product_name) === clean(right.product_name) &&
  Boolean(left.unread) === Boolean(right.unread);

const SocialCommentsPanelPostRow = memo(function SocialCommentsPanelPostRow({ item = {}, active = false, onSelectItem, onPrefetchItem }) {
  const platform = platformMeta(item.platform);
  const itemKey = socialCommentItemKey(item);
  const title = clean(item.post_message || item.post_caption || item.last_message || item.last_comment_text || "Post");
  const subtitle = clean(item.last_comment_text || item.last_message || item.post_caption || item.post_message || "");
  const media = postMedia(item);
  const handleSelect = useCallback(() => onSelectItem?.(item, itemKey), [item, itemKey, onSelectItem]);
  const hoverTimerRef = useRef(null);
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" || event.key === " ") onSelectItem?.(item, itemKey);
    },
    [item, itemKey, onSelectItem]
  );
  const schedulePrefetch = useCallback(() => {
    if (!onPrefetchItem) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => onPrefetchItem?.(item, itemKey), 300);
  }, [item, itemKey, onPrefetchItem]);
  const clearPrefetch = useCallback(() => {
    if (!hoverTimerRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  return (
    <article
      role={onSelectItem ? "button" : undefined}
      tabIndex={onSelectItem ? 0 : undefined}
      onClick={onSelectItem ? handleSelect : undefined}
      onKeyDown={onSelectItem ? handleKeyDown : undefined}
      onMouseEnter={onPrefetchItem ? schedulePrefetch : undefined}
      onMouseLeave={onPrefetchItem ? clearPrefetch : undefined}
      onFocus={onPrefetchItem ? schedulePrefetch : undefined}
      onBlur={onPrefetchItem ? clearPrefetch : undefined}
      className={`rounded-2xl border p-3 transition shadow-[0_8px_24px_rgba(15,23,42,0.05)] ${
        active ? "border-slate-300 ring-1 ring-slate-200" : "border-slate-200 hover:border-slate-300"
      }`}
      style={{ minHeight: "176px" }}
    >
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {media.thumbnail ? (
            <img src={media.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : media.videoUrl ? (
            <video src={media.videoUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
          ) : (
            <span className="grid h-full w-full place-items-center text-slate-300">
              <ImageIcon className="h-6 w-6" />
            </span>
          )}
          {media.isVideo ? (
            <span className="absolute inset-0 grid place-items-center bg-slate-950/15">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-900 shadow-sm">
                <Play className="h-4 w-4 fill-current" />
              </span>
            </span>
          ) : null}
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
              {(() => {
                const time = getPostVisibleTime(item);
                return time ? absoluteTime(time) : "Unknown";
              })()}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
});

const SocialCommentsPanelCommentRow = memo(function SocialCommentsPanelCommentRow({
  item = {},
  active = false,
  onSelectItem,
  onPrefetchItem,
  fallbackPlatform = "facebook",
}) {
  const itemKey = socialCommentItemKey(item);
  const permalink = clean(item.post_permalink);
  const handleSelect = useCallback(() => onSelectItem?.(item, itemKey), [item, itemKey, onSelectItem]);
  const hoverTimerRef = useRef(null);
  const schedulePrefetch = useCallback(() => {
    if (!onPrefetchItem) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => onPrefetchItem?.(item, itemKey), 300);
  }, [item, itemKey, onPrefetchItem]);
  const clearPrefetch = useCallback(() => {
    if (!hoverTimerRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);
  return (
    <CommentTimelineCard
      comment={item}
      selected={active}
      onSelect={onSelectItem ? handleSelect : undefined}
      onMouseEnter={onPrefetchItem ? schedulePrefetch : undefined}
      onMouseLeave={onPrefetchItem ? clearPrefetch : undefined}
      onFocus={onPrefetchItem ? schedulePrefetch : undefined}
      onBlur={onPrefetchItem ? clearPrefetch : undefined}
      fallbackPlatform={fallbackPlatform}
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
});

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
  onPrefetchItem,
}) {
  const filters = mode === "posts" ? POST_FILTERS : COMMENT_FILTERS;
  const handleFilterChange = useCallback((itemKey) => onFilterChange?.(itemKey), [onFilterChange]);
  const handleRefresh = useCallback(() => onRefresh?.(), [onRefresh]);
  const handleLoadMore = useCallback(() => onLoadMore?.(), [onLoadMore]);
  const handleSelectItem = useCallback((item, itemKey) => onSelectItem?.(item, itemKey), [onSelectItem]);
  const filteredItems = useMemo(
    () =>
      [...items]
        .filter((item) => (mode === "posts" ? postMatches(item, filter) : commentMatches(item, filter)))
        .sort((a, b) => (mode === "posts" ? sortValuePost(b) - sortValuePost(a) : sortValueComment(b) - sortValueComment(a))),
    [filter, items, mode]
  );
  const useVirtualRows = filteredItems.length > 50;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
            <MessageSquareText className="h-4 w-4" />
            {mode === "posts" ? "Social Posts" : "Social Comments"}
          </div>
          <div className="mt-1 text-sm font-black text-slate-900">
            {mode === "posts" ? "Facebook & Instagram posts and reels" : "Latest comments in the system"}
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
            onClick={handleRefresh}
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
              onClick={() => handleFilterChange(item.key)}
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
                  if (mode === "posts") {
                    return <SocialCommentsPanelPostRow item={item} active={clean(selectedItemId) === socialCommentItemKey(item)} onSelectItem={handleSelectItem} onPrefetchItem={onPrefetchItem} />;
                  }
                  return <SocialCommentsPanelCommentRow item={item} active={clean(selectedItemId) === socialCommentItemKey(item)} onSelectItem={handleSelectItem} onPrefetchItem={onPrefetchItem} fallbackPlatform={item.platform || "facebook"} />;
                }}
              />
            ) : filteredItems.slice(0, 50).map((item) => {
              if (mode === "posts") {
                return <SocialCommentsPanelPostRow key={socialCommentItemKey(item)} item={item} active={clean(selectedItemId) === socialCommentItemKey(item)} onSelectItem={handleSelectItem} onPrefetchItem={onPrefetchItem} />;
              }
              return <SocialCommentsPanelCommentRow key={socialCommentItemKey(item)} item={item} active={clean(selectedItemId) === socialCommentItemKey(item)} onSelectItem={handleSelectItem} onPrefetchItem={onPrefetchItem} fallbackPlatform={item.platform || "facebook"} />;
            })}
            {onLoadMore && nextCursor ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={handleLoadMore}
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
