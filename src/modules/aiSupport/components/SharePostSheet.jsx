/**
 * "Share post" — the sheet TikTok's DM screen opens from its "Share post" chip:
 * our own posts in a grid, one tap sends one into the conversation.
 *
 * It has to open at once, so nothing here waits on a platform. The server keeps
 * each source's list cached (inboxSharePostsService.js), and this module keeps
 * the last answer per source for the session too: a reopen paints from memory
 * and the request only refreshes it underneath.
 *
 * The sheet only names the post it sends (source + id). How it reaches the
 * customer is decided server-side per channel — the hint line says which.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, Heart, Loader2, RefreshCw, Star, X } from "lucide-react";

import { api } from "../../../shared/api/api";

const clean = (value = "") => String(value ?? "").trim();
const SOURCES = ["instagram", "facebook", "tiktok"];

const sessionCache = new Map();

const sharePostSourceForChannel = (channel = "") => {
  const value = clean(channel).toLowerCase();
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("messenger") || value === "facebook") return "facebook";
  return "instagram";
};

const deliveryHintKey = (channel = "", source = "") => {
  const value = clean(channel).toLowerCase();
  if (value.includes("whatsapp")) return "whatsapp";
  if (value.includes("telegram")) return "telegram";
  if (value.includes("instagram") && source === "instagram") return "native";
  return "link";
};

const compactCount = (value = 0) => {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(number);
};

function PostTile({ post, onSend, onToggleFavorite, t }) {
  const [failed, setFailed] = useState(false);
  const count = post.views || post.likes;
  return (
    <div className="relative aspect-[9/14] overflow-hidden bg-slate-200 dark:bg-white/10" data-share-post-tile={post.id}>
      <button
        type="button"
        onClick={() => onSend(post)}
        className="absolute inset-0 block h-full w-full"
        style={{ background: "transparent" }}
        aria-label={clean(post.caption).slice(0, 80) || t("aiSupport.inbox.sharePost.button")}
      >
        {failed ? (
          <span className="grid h-full w-full place-items-center text-slate-400">
            <Clapperboard className="h-6 w-6" />
          </span>
        ) : (
          <img
            src={post.thumbnail_url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition duration-200 hover:scale-[1.03]"
          />
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
        {count ? (
          <span dir="ltr" className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-slate-50 drop-shadow">
            <Heart className="h-3.5 w-3.5" />
            {compactCount(count)}
          </span>
        ) : null}
        {post.kind === "reel" ? (
          <Clapperboard className="pointer-events-none absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-slate-50 drop-shadow" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => onToggleFavorite(post)}
        aria-label={t(post.favorite ? "aiSupport.inbox.sharePost.removeFavorite" : "aiSupport.inbox.sharePost.addFavorite")}
        aria-pressed={Boolean(post.favorite)}
        className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full backdrop-blur-sm"
        style={{ background: "rgba(0, 0, 0, 0.35)" }}
      >
        <Star className={`h-4 w-4 ${post.favorite ? "fill-amber-400 text-amber-400" : "text-slate-50"}`} />
      </button>
    </div>
  );
}

function SharePostSheet({ open, onClose, onShare, channel = "", headers }) {
  const { t } = useTranslation();
  const [source, setSource] = useState(() => sharePostSourceForChannel(channel));
  const [tab, setTab] = useState("all");
  const [state, setState] = useState(() => sessionCache.get(sharePostSourceForChannel(channel)) || { posts: [], error: "", stale: false });
  const [loading, setLoading] = useState(false);
  // The source on screen — a slow Facebook answer must not land on the
  // Instagram grid the operator switched to meanwhile.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Each open starts on the conversation's own platform.
  useEffect(() => {
    if (open) setSource(sharePostSourceForChannel(channel));
  }, [open, channel]);

  const load = useCallback(async (targetSource, { refresh = false } = {}) => {
    const cached = sessionCache.get(targetSource);
    if (cached) setState(cached);
    else setState({ posts: [], error: "", stale: false });
    setLoading(true);
    try {
      const payload = await api.get(
        `/ai-inbox/share-posts?source=${encodeURIComponent(targetSource)}${refresh ? "&refresh=1" : ""}`,
        { headers, suppressErrorStatuses: [400, 409, 500, 502, 503] }
      );
      const next = { posts: Array.isArray(payload?.posts) ? payload.posts : [], error: clean(payload?.error), stale: Boolean(payload?.stale) };
      sessionCache.set(targetSource, next);
      setState((current) => (sourceRef.current === targetSource ? next : current));
    } catch (error) {
      setState((current) => ({ ...current, error: clean(error?.message) || "error" }));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (open) void load(source);
  }, [open, source, load]);

  const toggleFavorite = useCallback(async (post) => {
    const favorite = !post.favorite;
    const apply = (value) => {
      setState((current) => {
        const next = { ...current, posts: current.posts.map((item) => (item.id === post.id ? { ...item, favorite: value } : item)) };
        sessionCache.set(post.source || source, next);
        return next;
      });
    };
    apply(favorite);
    try {
      await api.post("/ai-inbox/share-posts/favorite", { source: post.source || source, post_id: post.id, favorite }, { headers });
    } catch {
      apply(!favorite);
    }
  }, [headers, source]);

  const send = useCallback((post) => {
    onClose?.();
    void onShare?.(post);
  }, [onClose, onShare]);

  const visible = useMemo(
    () => (tab === "favorites" ? state.posts.filter((post) => post.favorite) : state.posts),
    [state.posts, tab]
  );

  if (!open) return null;
  const hint = deliveryHintKey(channel, source);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" data-share-post-sheet="true">
      {/* Accent fills are inline: the inbox paints every <button> with its own
          background, which beats a Tailwind bg-* class on these. */}
      <button
        type="button"
        aria-label={t("aiSupport.inbox.sharePost.close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(15, 23, 42, 0.5)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("aiSupport.inbox.sharePost.title")}
        className="relative flex max-h-[82vh] w-full flex-col overflow-hidden rounded-t-[26px] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(15,23,42,0.3)] dark:bg-[#151715] sm:max-h-[78vh] sm:max-w-[560px] sm:rounded-[22px]"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 dark:bg-white/20 sm:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2.5">
          <button
            type="button"
            onClick={() => void load(source, { refresh: true })}
            disabled={loading}
            aria-label={t("aiSupport.inbox.sharePost.refresh")}
            title={t("aiSupport.inbox.sharePost.refresh")}
            className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10"
            style={{ background: "transparent" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <h2 className="text-[17px] font-black text-slate-900 dark:text-slate-50">{t("aiSupport.inbox.sharePost.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiSupport.inbox.sharePost.close")}
            className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
            style={{ background: "transparent" }}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex shrink-0 justify-center gap-1.5 px-4 pb-2">
          {SOURCES.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              aria-pressed={source === key}
              data-share-post-source={key}
              className="rounded-full px-3 py-1.5 text-[12px] font-bold transition"
              style={source === key
                ? { background: "var(--text, #25231f)", color: "var(--surface, #ffffff)" }
                : { background: "var(--surface-soft, #f7f7f5)", color: "var(--muted, #716e67)" }}
            >
              {t(`aiSupport.inbox.sharePost.source.${key}`)}
            </button>
          ))}
        </div>

        <div className="grid shrink-0 grid-cols-2 border-b border-slate-200 dark:border-white/10">
          {[["favorites", "aiSupport.inbox.sharePost.favorites"], ["all", "aiSupport.inbox.sharePost.ourPosts"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className="relative py-2.5 text-[14px] font-black transition"
              style={{ background: "transparent", color: tab === key ? "var(--text, #25231f)" : "var(--muted, #716e67)" }}
            >
              {t(label)}
              {tab === key ? <span className="absolute inset-x-6 bottom-0 h-[3px] rounded-full" style={{ background: "var(--text, #25231f)" }} /> : null}
            </button>
          ))}
        </div>

        <p className="shrink-0 px-4 py-1.5 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {t(`aiSupport.inbox.sharePost.delivery.${hint}`)}
        </p>

        <div className="min-h-[220px] flex-1 overflow-y-auto overscroll-contain">
          {visible.length ? (
            <div className="grid grid-cols-3 gap-[2px]">
              {visible.map((post) => (
                <PostTile key={`${post.source}:${post.id}`} post={post} onSend={send} onToggleFavorite={toggleFavorite} t={t} />
              ))}
            </div>
          ) : loading ? (
            <div className="grid grid-cols-3 gap-[2px]" aria-busy="true">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="aspect-[9/14] animate-pulse bg-slate-200 dark:bg-white/10" />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[220px] place-items-center px-6 text-center text-[13px] font-semibold text-slate-500 dark:text-slate-400">
              {state.error && tab !== "favorites"
                ? t("aiSupport.inbox.sharePost.loadFailed", { error: state.error })
                : t(tab === "favorites" ? "aiSupport.inbox.sharePost.favoritesEmpty" : "aiSupport.inbox.sharePost.empty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(SharePostSheet);
