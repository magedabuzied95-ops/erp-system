/**
 * "Came from this post" — the card pinned above a DM transcript in the AI Inbox.
 *
 * The comment automation likes the comment, replies to it publicly, then opens a DM and sends the
 * product cards. The operator answers in that DM. Before this the DM said nothing about where the
 * customer came from: the post preview existed only on the comment thread, which is a different
 * conversation on a different channel. So an operator reading "عندكم منه ٤٢؟" had no idea what
 * "منه" was.
 *
 * It shows whether or not the post has a product linked to it. The unlinked post is the case that
 * needs it most: the automation greets those commenters without naming a product, precisely because
 * there is none to name, so the post itself is the only context there is.
 *
 * It also folds away. Pinned to the top of a phone-sized transcript it eats real estate an operator
 * mid-conversation no longer needs, so the whole card is a toggle: tap it and it tucks into a pill
 * on the leading edge, tap the pill and it comes back. The choice is remembered per viewer, so it
 * survives switching threads — it is a preference, not thread state, which is why it lives in
 * localStorage and not in the conversation.
 *
 * Both surfaces render it — /admin/ai-inbox on the dark panel, /inbox on the white PWA sheet — off
 * one `conversationOriginPost` read, so they cannot drift apart.
 */
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, MessageSquareText } from "lucide-react";

import { resolveChatMediaUrl } from "../../../shared/lib/imageUrls";
import { transcriptDayLabel } from "../lib/conversationHelpers";

const COLLAPSED_STORAGE_KEY = "m1.aiInbox.originPost.collapsed";

// Site data can be blocked or cleared, and a private window throws on read. A forgotten preference
// is a shrug; a transcript that will not render because storage said no is not.
const readCollapsedPreference = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeCollapsedPreference = (collapsed) => {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* nothing to do: the card still folds, it just forgets on the next thread */
  }
};

const SKINS = {
  desktop: {
    shell: "rounded-3xl border border-white/10 bg-slate-950/90 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur",
    pill: "rounded-full border border-white/10 bg-slate-950/90 py-1 pe-3 ps-1 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur",
    thumb: "ring-1 ring-white/10",
    thumbFallback: "border border-white/10 bg-white/[0.06] text-slate-400",
    eyebrow: "text-cyan-100",
    title: "text-white",
    muted: "text-slate-400",
    link: "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    quote: "border-t border-white/10 text-slate-100",
    quoteName: "text-slate-400",
    chevron: "text-slate-400",
  },
  pwa: {
    shell: "rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)]",
    pill: "rounded-full border border-slate-200 bg-white py-1 pe-3 ps-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)]",
    thumb: "ring-1 ring-slate-200",
    thumbFallback: "bg-slate-100 text-slate-400",
    eyebrow: "text-cyan-700",
    title: "text-slate-900",
    muted: "text-slate-500",
    link: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    quote: "border-t border-slate-200 text-slate-900",
    quoteName: "text-slate-500",
    chevron: "text-slate-400",
  },
};

function OriginPostCard({ post = null, variant = "desktop" }) {
  const { t } = useTranslation();
  // A Meta CDN thumbnail is signed and expires, so the image can 404 on an old thread. The card
  // falls back to its icon tile rather than leaving a broken frame above every reply.
  const [imageFailed, setImageFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      writeCollapsedPreference(!current);
      return !current;
    });
  }, []);

  const onToggleKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    },
    [toggle]
  );

  if (!post) return null;

  const skin = SKINS[variant] || SKINS.desktop;
  const image = imageFailed ? "" : resolveChatMediaUrl(post.image);
  const caption = post.caption || t("aiSupport.inbox.originPost.empty");
  // The run row stores the post's time as the ISO string Meta sent. Printed raw it reads as
  // "2026-09-19T10:19:06.000Z" above the chat; through the transcript's own labeller it reads as
  // "اليوم" on the store's clock, like every other date in the thread.
  const postDate = transcriptDayLabel(post.createdTime);

  const thumbnail = (size) =>
    image ? (
      <img
        src={image}
        alt=""
        loading="lazy"
        onError={() => setImageFailed(true)}
        className={`${size} shrink-0 rounded-2xl object-cover ${skin.thumb}`}
      />
    ) : (
      <span className={`grid ${size} shrink-0 place-items-center rounded-2xl ${skin.thumbFallback}`}>
        <MessageSquareText className="h-1/3 w-1/3" />
      </span>
    );

  // Folded: a pill on the leading edge, nothing else. It keeps the thumbnail so the operator can
  // still tell at a glance which post the thread came from without unfolding it.
  if (collapsed) {
    return (
      <div className="sticky top-2 z-20 flex justify-start">
        <button
          type="button"
          onClick={toggle}
          title={t("aiSupport.inbox.originPost.expand")}
          aria-label={t("aiSupport.inbox.originPost.expand")}
          aria-expanded="false"
          className={`inline-flex max-w-[70%] items-center gap-2 ${skin.pill}`}
        >
          {thumbnail("h-8 w-8")}
          <span className={`truncate text-[11px] font-black uppercase tracking-[0.12em] ${skin.eyebrow}`}>
            {t("aiSupport.inbox.originPost.title")}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${skin.chevron}`} />
        </button>
      </div>
    );
  }

  return (
    // A div with a button role, not a <button>: the card holds the "open post" anchor, and an
    // anchor may not live inside a button.
    <div
      role="button"
      tabIndex={0}
      aria-expanded="true"
      aria-label={t("aiSupport.inbox.originPost.collapse")}
      onClick={toggle}
      onKeyDown={onToggleKeyDown}
      className={`sticky top-2 z-20 cursor-pointer ${skin.shell}`}
    >
      <div className="flex items-start gap-3">
        {thumbnail("h-20 w-20")}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${skin.eyebrow}`}>
              {t("aiSupport.inbox.originPost.title")}
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 rotate-180 ${skin.chevron}`} aria-hidden="true" />
          </div>
          <div dir="auto" className={`mt-1 line-clamp-2 text-[15px] font-black leading-6 ${skin.title}`}>
            {caption}
          </div>
          {postDate ? <div className={`mt-1 text-[11px] font-medium ${skin.muted}`}>{postDate}</div> : null}
          {post.url ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={post.url}
                target="_blank"
                rel="noreferrer"
                // Opening the post must not also fold the card away behind the new tab.
                onClick={(event) => event.stopPropagation()}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-xl px-3 text-[11px] font-black ${skin.link}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("aiSupport.inbox.originPost.openPost")}
              </a>
            </div>
          ) : null}
        </div>
      </div>
      {post.commentText ? (
        <div className={`mt-2 px-1 pt-2 ${skin.quote}`}>
          <div className="flex items-start gap-1.5">
            <MessageSquareText className={`mt-0.5 h-3 w-3 shrink-0 ${skin.quoteName}`} />
            <p dir="auto" className="min-w-0 text-[12.5px] leading-5">
              {post.commenterName ? <span className={`font-black ${skin.quoteName}`}>{post.commenterName}: </span> : null}
              {post.commentText}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(OriginPostCard);
