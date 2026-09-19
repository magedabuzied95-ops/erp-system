/**
 * "Came from this post" — the card pinned above a DM transcript in the AI Inbox.
 *
 * The comment automation likes the comment, replies to it publicly, then opens a DM and sends the
 * product cards. The operator answers in that DM. Until now the DM said nothing about where the
 * customer came from: the post preview existed only on the comment thread, which is a different
 * conversation on a different channel, and inside a single automation bubble that scrolls away.
 * So an operator reading "عندكم منه ٤٢؟" had no idea what "منه" was.
 *
 * This card sticks to the top of the transcript for the whole thread and answers that, whether or
 * not the post has a product linked to it. The unlinked post is the case that needs it most: the
 * automation greets those commenters without naming a product, precisely because there is none to
 * name, so the post itself is the only context there is.
 *
 * Both surfaces render it — /admin/ai-inbox on the dark panel, /inbox on the white PWA sheet — off
 * one `conversationOriginPost` read, so they cannot drift apart.
 */
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, MessageSquareText } from "lucide-react";

import { resolveChatMediaUrl } from "../../../shared/lib/imageUrls";
import { transcriptDayLabel } from "../lib/conversationHelpers";

const SKINS = {
  desktop: {
    shell: "sticky top-2 z-10 rounded-3xl border border-white/10 bg-slate-950/90 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur",
    thumb: "ring-1 ring-white/10",
    thumbFallback: "border border-white/10 bg-white/[0.06] text-slate-400",
    eyebrow: "text-cyan-100",
    title: "text-white",
    muted: "text-slate-400",
    link: "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    quote: "border-t border-white/10 text-slate-100",
    quoteName: "text-slate-400",
  },
  pwa: {
    shell: "sticky top-2 z-10 rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)]",
    thumb: "ring-1 ring-slate-200",
    thumbFallback: "bg-slate-100 text-slate-400",
    eyebrow: "text-cyan-700",
    title: "text-slate-900",
    muted: "text-slate-500",
    link: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    quote: "border-t border-slate-200 text-slate-900",
    quoteName: "text-slate-500",
  },
};

function OriginPostCard({ post = null, variant = "desktop" }) {
  const { t } = useTranslation();
  // A Meta CDN thumbnail is signed and expires, so the image can 404 on an old thread. The card
  // falls back to its icon tile rather than leaving a broken frame above every reply.
  const [imageFailed, setImageFailed] = useState(false);
  if (!post) return null;

  const skin = SKINS[variant] || SKINS.desktop;
  const image = imageFailed ? "" : resolveChatMediaUrl(post.image);
  const caption = post.caption || t("aiSupport.inbox.originPost.empty");
  // The run row stores the post's time as the ISO string Meta sent. Printed raw it reads as
  // "2026-09-19T10:19:06.000Z" above the chat; through the transcript's own labeller it reads as
  // "اليوم" on the store's clock, like every other date in the thread.
  const postDate = transcriptDayLabel(post.createdTime);

  return (
    <div className={skin.shell}>
      <div className="flex items-start gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={`h-20 w-20 shrink-0 rounded-2xl object-cover ${skin.thumb}`}
          />
        ) : (
          <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-2xl ${skin.thumbFallback}`}>
            <MessageSquareText className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${skin.eyebrow}`}>
            {t("aiSupport.inbox.originPost.title")}
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
