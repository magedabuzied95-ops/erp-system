import { ArrowDownCircle, CheckCheck, Copy, Forward, Loader2, MessageCircle, MoreVertical, Pencil, Reply, Trash2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { portalChatMessagePreview, isPortalChatAudioMessage, portalChatTextParts } from "./portalChatUtils";
import PortalChatAttachment from "./PortalChatAttachment";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const reactionCounts = (reactions = []) => Object.entries((Array.isArray(reactions) ? reactions : []).reduce((counts, reaction) => {
  const emoji = String(reaction?.emoji || "").trim();
  if (emoji) counts[emoji] = (counts[emoji] || 0) + 1;
  return counts;
}, {}));

const DEFAULT_BACKGROUND = {
  backgroundColor: "#0b141a",
  backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0), linear-gradient(135deg, rgba(20,184,166,0.035), transparent 35%, rgba(15,23,42,0.18))",
  backgroundSize: "18px 18px, 100% 100%",
};

function PortalChatMessageText({ body = "" }) {
  return (
    <div className="whitespace-pre-wrap break-words" dir="auto">
      {portalChatTextParts(body).map((part, index) =>
        part.type === "link" ? (
          <a
            key={`${part.href}-${index}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="select-text font-semibold text-[#53bdeb] underline decoration-[#53bdeb]/45 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-[#53bdeb] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#53bdeb]"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            onTouchEnd={(event) => event.stopPropagation()}
          >
            {part.text}
          </a>
        ) : (
          <span key={`text-${index}`}>{part.text}</span>
        )
      )}
    </div>
  );
}

const messageDayKey = (value) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : "";
};

const messageDayLabel = (value, labels = {}) => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = messageDayKey(date);
  if (key === messageDayKey(today)) return labels.today || "اليوم";
  if (key === messageDayKey(yesterday)) return labels.yesterday || "أمس";
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export default function PortalChatMessageList({
  messages = [],
  loading = false,
  labels = {},
  outgoingSenderType = "employee",
  outgoingLabel = "أنت",
  incomingLabel = "الإدارة",
  timeFormatter = (value) => value || "",
  messagesRef,
  onScroll,
  showJump = false,
  onJumpToBottom,
  typingLabel = "",
  onImageClick,
  onReply,
  onForward,
  onReact,
  onEdit,
  onDelete,
  onBeginSwipe,
  onMoveSwipe,
  onEndSwipe,
  firstUnreadIndex = -1,
  messageIdPrefix = "portal-chat-message",
  className = "",
  style,
}) {
  const [activeMessage, setActiveMessage] = useState(null);
  const [actionAnchor, setActionAnchor] = useState(null);
  const backgroundStyle = style || DEFAULT_BACKGROUND;

  const scrollToMessage = (messageId) => {
    if (!messageId) return;
    document.getElementById(`${messageIdPrefix}-${messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const closeActions = () => {
    setActiveMessage(null);
    setActionAnchor(null);
  };
  const openActions = (message, node) => {
    const rect = node?.getBoundingClientRect?.();
    const viewportWidth = window.innerWidth || 360;
    const viewportHeight = window.innerHeight || 640;
    const menuWidth = Math.min(264, viewportWidth - 24);
    const menuHeight = 315;
    const left = Math.max(12, Math.min((rect?.left || 12), viewportWidth - menuWidth - 12));
    const top = (rect?.bottom || 80) + menuHeight + 12 < viewportHeight
      ? (rect?.bottom || 80) + 8
      : Math.max(12, (rect?.top || viewportHeight) - menuHeight - 8);
    setActionAnchor({ left, top, width: menuWidth });
    setActiveMessage(message);
  };
  const actionSheet = activeMessage && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[140]" dir="rtl" role="dialog" aria-modal="true" aria-label={labels.messageActions || "إجراءات الرسالة"}>
      <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={closeActions} aria-label={labels.close || "إغلاق"} />
      <div className="absolute overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#24292d]/95 p-2 text-white shadow-2xl backdrop-blur-xl" style={actionAnchor || undefined}>
        {onReact ? (
          <div className="mb-2 flex items-center justify-between gap-1 rounded-2xl bg-[#111b21] px-2 py-2 shadow-inner" dir="ltr">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => { onReact(activeMessage, emoji); closeActions(); }} className="grid h-9 w-9 place-items-center rounded-full text-[23px] transition hover:-translate-y-1 hover:bg-white/10 active:scale-90" aria-label={`${labels.react || "تفاعل"} ${emoji}`}>{emoji}</button>
            ))}
          </div>
        ) : null}
        <div className="mb-1 truncate rounded-xl bg-black/15 px-3 py-2 text-xs font-semibold text-slate-300" dir="auto">{portalChatMessagePreview(activeMessage, labels)}</div>
        <div className="grid text-[15px] font-bold">
          {onReply ? <button type="button" onClick={() => { onReply(activeMessage); closeActions(); }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-start hover:bg-white/10"><Reply className="h-[18px] w-[18px]" />{labels.reply || "رد"}</button> : null}
          {onForward ? <button type="button" onClick={() => { onForward(activeMessage); closeActions(); }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-start hover:bg-white/10"><Forward className="h-[18px] w-[18px]" />{labels.forward || "إعادة توجيه"}</button> : null}
          {activeMessage.body ? <button type="button" onClick={() => { navigator.clipboard?.writeText?.(activeMessage.body); closeActions(); }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-start hover:bg-white/10"><Copy className="h-[18px] w-[18px]" />{labels.copy || "نسخ"}</button> : null}
          {activeMessage.sender_type === outgoingSenderType && activeMessage.body && onEdit ? <button type="button" onClick={() => { onEdit(activeMessage); closeActions(); }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-start hover:bg-white/10"><Pencil className="h-[18px] w-[18px]" />{labels.edit || "تعديل"}</button> : null}
          {activeMessage.sender_type === outgoingSenderType && onDelete ? <button type="button" onClick={() => { onDelete(activeMessage); closeActions(); }} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-start text-red-300 hover:bg-white/10"><Trash2 className="h-[18px] w-[18px]" />{labels.delete || "حذف لدى الجميع"}</button> : null}
        </div>
      </div>
    </div>, document.body
  ) : null;

  return (
    <>
    <div
      ref={messagesRef}
      className={`min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain scroll-smooth px-3 py-2 ${className}`}
      style={backgroundStyle}
      onScroll={onScroll}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-5 text-sm font-bold text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {labels.loading || "جاري التحميل..."}
        </div>
      ) : messages.length ? (
        messages.map((message, index) => {
          const outgoing = message.sender_type === outgoingSenderType;
          const deleted = Boolean(message.deleted_at);
          const showDay = index === 0 || messageDayKey(messages[index - 1]?.created_at) !== messageDayKey(message.created_at);
          const isAudioMessage = isPortalChatAudioMessage(message);
          const hasMessageBody = Boolean(String(message.body || "").trim());
          const voiceMessage = isAudioMessage && !hasMessageBody;
          return (
            <div id={`${messageIdPrefix}-${message.id}`} key={message.id || `${message.sender_type || "sender"}-${message.body || message.attachment_name || ""}-${message.created_at || ""}`}>
              {showDay ? <div className="mx-auto mb-3 mt-2 w-fit rounded-full bg-[#182229]/90 px-3 py-1 text-[11px] font-black text-slate-300">{messageDayLabel(message.created_at, labels)}</div> : null}
              {index === firstUnreadIndex ? (
                <div className="mx-auto mb-2 w-fit rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-black text-emerald-100">
                  {labels.unread || "رسائل غير مقروءة"}
                </div>
              ) : null}
              <div dir="ltr" className={`flex items-end rounded-2xl transition-shadow duration-300 ${outgoing ? "justify-end" : "justify-start"}`}>
                <div
                  onClick={(event) => {
                    if (deleted || event.target.closest("a, button, input, audio, video")) return;
                    openActions(message, event.currentTarget);
                  }}
                  onTouchStart={(event) => onBeginSwipe?.(event, message)}
                  onTouchMove={(event) => onMoveSwipe?.(event, message)}
                  onTouchEnd={onEndSwipe}
                  onTouchCancel={onEndSwipe}
                  className={`relative cursor-pointer touch-pan-y select-none break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm transition active:brightness-110 ${voiceMessage ? "w-[min(76vw,18.5rem)] px-2 py-1" : "w-fit max-w-[82%] px-3 py-2"} ${outgoing ? "rounded-br-[0.25rem] bg-[#005c4b] text-white after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[#005c4b] after:[clip-path:polygon(0_0,100%_100%,0_100%)]" : "rounded-bl-[0.25rem] bg-[#202c33] text-slate-50 after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[#202c33] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"}`}
                  dir="rtl"
                >
                  {false && !deleted ? (
                    <div className="absolute end-1 top-1 z-10">
                      <button
                        type="button"
                        onClick={() => setActiveMenuId((current) => String(current) === String(message.id) ? null : message.id)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-black/10 text-white/70 opacity-70 transition hover:bg-black/20 hover:opacity-100"
                        aria-label={labels.messageActions || "إجراءات الرسالة"}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {String(activeMenuId) === String(message.id) ? (
                        <div className="absolute end-0 top-8 z-30 min-w-36 overflow-hidden rounded-xl border border-white/10 bg-[#233138] py-1 text-xs font-bold text-white shadow-2xl">
                          {onReply ? <button type="button" onClick={() => { onReply(message); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-white/10"><Reply className="h-3.5 w-3.5" />{labels.reply || "رد"}</button> : null}
                          {message.body ? <button type="button" onClick={() => { navigator.clipboard?.writeText?.(message.body); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-white/10"><Copy className="h-3.5 w-3.5" />{labels.copy || "نسخ"}</button> : null}
                          {outgoing && message.body && onEdit ? <button type="button" onClick={() => { onEdit(message); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-white/10"><Pencil className="h-3.5 w-3.5" />{labels.edit || "تعديل"}</button> : null}
                          {outgoing && onDelete ? <button type="button" onClick={() => { onDelete(message); setActiveMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-start text-red-300 hover:bg-white/10"><Trash2 className="h-3.5 w-3.5" />{labels.delete || "حذف لدي الجميع"}</button> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {message.reply_to_message_id ? (
                    <button type="button" onClick={(event) => { event.stopPropagation(); scrollToMessage(message.reply_to_message_id); }} className="mb-2 block w-full min-w-[12rem] max-w-[19rem] rounded-[0.8rem] border-l-[4px] border-[#ff5d74] bg-black/20 px-3 py-2 text-start shadow-inner" dir="rtl">
                      <div className="truncate text-[13px] font-black leading-5 text-[#ff7186]">{message.reply_sender_type === outgoingSenderType ? outgoingLabel : incomingLabel}</div>
                      <div className="line-clamp-2 text-[13px] font-semibold leading-5 text-slate-100/80">{portalChatMessagePreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name }, labels)}</div>
                    </button>
                  ) : null}
                  {!deleted ? <PortalChatAttachment
                    message={message}
                    compact
                    outgoing={outgoing}
                    timeText={timeFormatter(message.created_at)}
                    showChecks={outgoing}
                    read={Boolean(message.read_at)}
                    onImageClick={onImageClick}
                    labels={labels}
                  /> : null}
                  {deleted ? <div className="pe-5 italic text-slate-300/70">{labels.deleted || "تم حذف هذه الرسالة"}</div> : message.body ? <PortalChatMessageText body={message.body} /> : null}
                  {false && !voiceMessage && onReply ? (
                    <button type="button" onClick={() => onReply(message)} className="mt-1 text-[10px] font-bold text-slate-300/60">
                      {labels.reply || "رد"}
                    </button>
                  ) : null}
                  {!voiceMessage ? (
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium leading-4 text-slate-300/65" dir="ltr">
                      <span>{timeFormatter(message.created_at)}</span>
                      {message.edited_at && !deleted ? <span>{labels.edited || "معدلة"}</span> : null}
                      {outgoing ? <CheckCheck className={`h-3.5 w-3.5 ${message.read_at ? "text-sky-300" : "text-slate-300/70"}`} /> : null}
                    </div>
                  ) : null}
                  {!deleted && reactionCounts(message.reactions).length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1" dir="ltr">
                      {reactionCounts(message.reactions).map(([emoji, count]) => (
                        <button key={emoji} type="button" onClick={(event) => { event.stopPropagation(); onReact?.(message, emoji); }} className="flex h-6 items-center gap-1 rounded-full border border-white/10 bg-[#182229] px-2 text-[14px] shadow-sm" aria-label={`${labels.react || "تفاعل"} ${emoji}`}>
                          <span>{emoji}</span>{count > 1 ? <span className="text-[10px] font-black text-slate-300">{count}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm font-bold text-slate-300">
          <MessageCircle className="mx-auto h-8 w-8" />
          <div className="mt-2">{labels.empty || "لا توجد رسائل حتى الآن"}</div>
        </div>
      )}
      {typingLabel ? <div className="w-fit rounded-2xl bg-[#202c33] px-3 py-1.5 text-[12px] font-bold text-emerald-200">{typingLabel}</div> : null}
      {showJump ? (
        <button type="button" onClick={onJumpToBottom} className="sticky bottom-3 z-10 ms-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#202c33] text-white shadow-lg">
          <ArrowDownCircle className="h-5 w-5" />
        </button>
      ) : null}
    </div>
    {actionSheet}
    </>
  );
}
