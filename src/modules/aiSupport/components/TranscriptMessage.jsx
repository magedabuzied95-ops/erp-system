import { memo, useMemo } from "react";
import { Bot, ExternalLink, MessageSquareText, Sparkles, UserCheck } from "lucide-react";

import ProductCardMessage from "./ProductCardMessage";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const staffSenderLabel = (message = {}) => {
  const source = clean(`${message.source_path || ""} ${message.insert_source || ""} ${message.message_type || ""}`).toLowerCase();
  if (source.includes("automation") || source.includes("system")) return "النظام";
  return "أنا";
};

const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const attachmentType = (attachment = {}) => clean(attachment.type || attachment.media_type || attachment.message_type || "").toLowerCase();
const attachmentUrl = (attachment = {}) => clean(attachment.url || attachment.image_url || attachment.media_url || attachment.attachment_url || attachment.file_url || "");

const imageUrlsForMessage = (message = {}) =>
  [
    message.image_url,
    !["audio", "voice", "ptt", "video", "document", "file"].includes(clean(message.message_type).toLowerCase()) ? message.media_url : "",
    message.attachment_url,
    message.file_url,
    message.preview_url,
    message.thumbnail_url,
    ...asArray(message.visual_attachments)
      .filter((attachment) => !["audio", "voice", "ptt", "video", "document", "file"].includes(attachmentType(attachment)))
      .map((attachment) => attachmentUrl(attachment)),
  ]
    .map((value) => clean(value))
    .filter(Boolean);

const typedMediaUrls = (message = {}, types = []) =>
  [
    ...(types.includes(clean(message.message_type).toLowerCase()) ? [message.media_url, message.attachment_url, message.file_url] : []),
    ...asArray(message.visual_attachments)
      .filter((attachment) => types.includes(attachmentType(attachment)))
      .map((attachment) => attachmentUrl(attachment)),
  ]
    .map((value) => clean(value))
    .filter(Boolean);

const commentThreadPostTitle = (message = {}) =>
  clean(
    message.post_message ||
      message.post_title ||
      message.post_caption ||
      message.post_name ||
      message.post_text ||
      message.post_body ||
      message.caption ||
      message.conversationMetadata?.post_message ||
      message.conversationMetadata?.post_caption ||
      message.conversationMetadata?.post_title ||
      message.conversationMetadata?.post_body ||
      ""
  );

const commentThreadPostTime = (message = {}) =>
  clean(
    message.post_created_time ||
      message.comment_created_time ||
      message.created_time ||
      message.post_time ||
      message.post_date ||
      message.conversationMetadata?.post_created_time ||
      message.conversationMetadata?.comment_created_time ||
      message.conversationMetadata?.post_time ||
      message.conversationMetadata?.post_date ||
      ""
  );

function LinkifiedText({ text = "", className = "" }) {
  const value = String(text || "");
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p dir="auto" className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        return (
          <a key={`${index}-${part}`} href={part} target="_blank" rel="noopener noreferrer" className="font-black text-cyan-100 underline decoration-cyan-300/50 underline-offset-4 hover:text-cyan-50">
            {part}
          </a>
        );
      })}
    </p>
  );
}

function TranscriptMessage({
  row = null,
  variant = "desktop",
  onOpenCorrection,
  onReplyComment,
  onPrivateMessage,
  channelLabel = "",
}) {
  const safeRow = row || {};
  const message = safeRow.message || {};
  const cards = asArray(safeRow.cards);
  const mediaUrls = useMemo(() => imageUrlsForMessage(message).slice(0, 4), [message]);
  const audioUrls = useMemo(() => typedMediaUrls(message, ["audio", "voice", "ptt"]).slice(0, 4), [message]);
  const videoUrls = useMemo(() => typedMediaUrls(message, ["video"]).slice(0, 4), [message]);
  const documentUrls = useMemo(() => typedMediaUrls(message, ["document", "file"]).slice(0, 4), [message]);
  const createdAt = safeRow.createdAt || absoluteTime(message.created_at);
  const isCommentMessage =
    safeRow.kind === "comment" ||
    clean(message.message_type).toLowerCase() === "comment_inbound" ||
    (clean(message.thread_kind).toLowerCase() === "comment" && ["customer", "user", "client"].includes(clean(message.sender_type).toLowerCase()));
  const postUrl = clean(
    safeRow.postUrl ||
      message.post_permalink ||
      message.permalink_url ||
      message.post_url ||
      message.metadata?.post_permalink ||
      message.metadata?.permalink_url ||
      message.channel_metadata?.post_permalink ||
      message.channel_metadata?.permalink_url ||
      message.conversationMetadata?.post_permalink_url ||
      message.conversationMetadata?.post_permalink ||
      message.conversationMetadata?.comment_url ||
      message.conversationMetadata?.permalink_url
  );
  const postTitle = commentThreadPostTitle(message) || clean(message.post_permalink_url || message.metadata?.post_message || message.metadata?.post_caption || message.conversationMetadata?.post_message || message.conversationMetadata?.post_caption || "");
  const postTime = commentThreadPostTime(message);
  const sourceLabel = clean(message.channel_label || channelLabel || (clean(message.channel).includes("instagram") ? "Instagram Comment" : "Facebook Comment")) || (clean(message.channel).includes("instagram") ? "Instagram Comment" : "Facebook Comment");
  const commentLabel = clean(message.channel_label || channelLabel || (clean(message.channel).includes("instagram") ? "Instagram Comment" : "Facebook Comment")) || (clean(message.channel).includes("instagram") ? "Instagram Comment" : "Facebook Comment");
  const commenterName = clean(message.commenter_name || message.customer_name || message.sender_name || message.from_name || message.author_name || "");
  if (!safeRow.visible) return null;

  if (variant === "pwa") {
    if (safeRow.kind === "product_card") {
      return (
        <div className="flex justify-start">
          <div className="w-[82%] max-w-sm space-y-1.5">
            <div className="px-1 text-left text-[10px] font-medium text-slate-500">{createdAt}</div>
            <ProductCardMessage message={message} cards={cards} />
          </div>
        </div>
      );
    }

    if (safeRow.kind === "customer") {
      return (
        <div className="flex justify-end">
          <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-emerald-50 px-3 py-2 shadow-sm ring-1 ring-emerald-100">
            <div className="mb-1 text-right text-[10px] font-medium text-emerald-700/70">{createdAt}</div>
            <div className="text-slate-900">
              <LinkifiedText text={message.customer_message} className="text-slate-900" />
              {message.delivery_status === "failed" ? <span className="text-[11px] text-rose-500"> · Failed</span> : null}
              {message.delivery_status === "failed" && message.delivery_error ? (
                <p className="mt-1 text-[11px] leading-4 text-rose-200">{message.delivery_error}</p>
              ) : null}
              {mediaUrls.length ? (
                <div className="mt-2 grid gap-2">
                  {mediaUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Attachment" className="aspect-video w-full rounded-xl object-cover" loading="lazy" decoding="async" /></a>)}
                </div>
              ) : null}
              {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-2 w-full" />)}
              {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-2 max-h-72 w-full rounded-xl" />)}
              {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700">فتح الملف</a>)}
            </div>
          </div>
        </div>
      );
    }

    if (safeRow.kind === "ai") {
      return (
        <div className="flex justify-start">
          <div className="max-w-[82%] rounded-[20px] rounded-bl-md bg-sky-50 px-3 py-2 shadow-sm ring-1 ring-sky-100">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-sky-700">
              <Bot className="h-3.5 w-3.5" />
              AI
            </div>
            <LinkifiedText text={message.ai_answer} className="text-[14px] leading-5.5 text-slate-800" />
          </div>
        </div>
      );
    }

    if (safeRow.kind === "staff") {
      return (
        <div className="flex justify-start">
          <div className={`max-w-[82%] rounded-[20px] rounded-bl-md px-3 py-2 shadow-sm ${message.delivery_status === "failed" ? "bg-rose-950 text-rose-50 ring-1 ring-rose-200" : "bg-slate-900 text-white"}`}>
            <div className={`mb-1 text-[10px] font-medium ${message.delivery_status === "failed" ? "text-rose-200" : "text-slate-300"}`}>
              {message.message_type === "internal_note" ? "ملاحظة داخلية" : staffSenderLabel(message)} · {createdAt}
            </div>
            <LinkifiedText text={message.staff_message} className={`text-[14px] leading-5.5 ${message.delivery_status === "failed" ? "text-rose-50" : "text-white"}`} />
            {message.delivery_status === "failed" && message.delivery_error ? (
              <p className="mt-1 text-[11px] leading-4 text-rose-200">{message.delivery_error}</p>
            ) : null}
          </div>
        </div>
      );
    }

    if (isCommentMessage) {
      return (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-3xl rounded-tl-sm border border-amber-300/20 bg-amber-300/10 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">
              <MessageSquareText className="h-3.5 w-3.5" />
              <span>{commenterName || commentLabel}</span>
              <span className="text-slate-400">/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={message.customer_message || message.message_text || message.text || message.body} className="mt-3 text-[16px] leading-8 text-white" />
            <div className="mt-3 flex flex-wrap gap-2">
              {message.comment_id && onReplyComment ? (
                <button
                  type="button"
                  onClick={() => onReplyComment(message)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100"
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  رد على التعليق
                </button>
              ) : null}
              {message.commenter_id && onPrivateMessage ? (
                <button
                  type="button"
                  onClick={() => onPrivateMessage(message)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="space-y-2" style={{ contentVisibility: "auto", containIntrinsicBlockSize: "180px" }}>
      {safeRow.kind === "product_card" ? (
        <div className="flex justify-end">
          <div className="max-w-[88%]">
            <ProductCardMessage message={message} cards={cards} />
          </div>
        </div>
      ) : null}
      {safeRow.kind === "customer" ? (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-3xl rounded-tl-sm border border-white/10 bg-white/[0.06] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
              <span>العميل</span>
              <span>/</span>
              <span>{channelLabel}</span>
              <span>/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={message.customer_message} className="mt-3 text-[16px] leading-8 text-white" />
            {mediaUrls.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {mediaUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
                    <img src={url} alt="Attachment" className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            ) : null}
            {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-3 w-full" />)}
            {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-3 max-h-80 w-full rounded-2xl border border-white/10 bg-slate-950/80" />)}
            {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-black text-cyan-100">فتح الملف</a>)}
          </div>
        </div>
      ) : null}
      {safeRow.kind === "ai" ? (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-3xl rounded-tr-sm border border-cyan-300/15 bg-cyan-300/10 p-5 shadow-[0_10px_30px_rgba(8,145,178,0.14)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">
              <Bot className="h-3.5 w-3.5" />
              <span>{message.message_type === "comment_suggestion" ? "مسودة" : "AI"}</span>
              {message.message_type === "comment_suggestion" ? <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-100">Draft reply</span> : null}
              <span className="text-slate-500">{createdAt}</span>
              <span className="text-slate-500">conf {Number(message.confidence || 0).toFixed(2)}</span>
              {message.message_type !== "comment_suggestion" ? (
                <button
                  type="button"
                  onClick={() => onOpenCorrection?.(message)}
                  className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 text-[10px] font-black text-slate-100"
                >
                  <Sparkles className="h-3 w-3" />
                  تصحيح الرد
                </button>
              ) : null}
            </div>
            <LinkifiedText text={message.ai_answer} className="mt-3 text-[16px] leading-8 text-white" />
            {message.suggested_products?.length ? <div className="mt-3"><ProductCardMessage message={message} cards={message.suggested_products} /></div> : null}
            {message.visual_attachments?.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {message.visual_attachments.slice(0, 4).map((attachment, index) => {
                  const url = clean(attachment?.url || attachment?.image_url || attachment?.attachment_url || "");
                  if (!url) return null;
                  return (
                    <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
                      <img src={url} alt="Attachment" className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
                    </a>
                  );
                })}
              </div>
            ) : null}
            {mediaUrls.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {mediaUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
                    <img src={url} alt="Attachment" className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {safeRow.kind === "staff" ? (
        <div className="flex justify-end">
          <div className={`max-w-[88%] rounded-3xl rounded-tr-sm p-5 shadow-[0_10px_30px_rgba(16,185,129,0.12)] ${message.message_type === "automation_error" ? "border border-rose-300/20 bg-rose-400/10" : "border border-emerald-300/15 bg-emerald-400/10"}`}>
            <div className={`flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] ${message.message_type === "automation_error" ? "text-rose-100" : "text-emerald-100"}`}>
              <UserCheck className="h-3.5 w-3.5" />
              <span>{staffSenderLabel(message)}</span>
              {message.staff_user_name && message.staff_user_name !== "أنا" ? <span className="text-slate-400">{message.staff_user_name}</span> : null}
              {message.message_type ? (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${message.message_type === "automation_error" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : message.message_type === "comment_like" ? "border-white/10 bg-white/[0.055] text-slate-100" : message.message_type === "comment_private_reply" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : "border-violet-300/20 bg-violet-400/10 text-violet-100"}`}>
                  {message.message_type}
                </span>
              ) : null}
              <span className="text-slate-500">{createdAt}</span>
              {message.delivery_status ? <span className={message.delivery_status === "failed" ? "text-rose-200" : message.delivery_status === "sending" ? "text-amber-200" : "text-emerald-200"}>{message.delivery_status}</span> : null}
            </div>
            <LinkifiedText text={message.staff_message} className="mt-3 text-[16px] leading-8 text-white" />
            {mediaUrls.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {mediaUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
                    <img src={url} alt="Attachment" className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            ) : null}
            {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-3 w-full" />)}
            {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-3 max-h-80 w-full rounded-2xl border border-white/10 bg-slate-950/80" />)}
            {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-black text-cyan-100">فتح الملف</a>)}
            {message.delivery_error ? <p className="mt-2 text-xs font-bold text-rose-200">{message.delivery_error}</p> : null}
          </div>
        </div>
      ) : null}
      {isCommentMessage ? (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-3xl rounded-tl-sm border border-amber-300/20 bg-amber-300/10 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">
              <MessageSquareText className="h-3.5 w-3.5" />
              <span>{commenterName || commentLabel}</span>
              <span className="text-slate-400">/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={message.customer_message || message.message_text || message.text || message.body} className="mt-3 text-[16px] leading-8 text-white" />
            <div className="mt-3 flex flex-wrap gap-2">
              {message.comment_id && onReplyComment ? (
                <button
                  type="button"
                  onClick={() => onReplyComment(message)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-[11px] font-black text-violet-100"
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  رد على التعليق
                </button>
              ) : null}
              {message.commenter_id && onPrivateMessage ? (
                <button
                  type="button"
                  onClick={() => onPrivateMessage(message)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(TranscriptMessage, (prev, next) => prev.row === next.row && prev.variant === next.variant && prev.onOpenCorrection === next.onOpenCorrection && prev.channelLabel === next.channelLabel);

