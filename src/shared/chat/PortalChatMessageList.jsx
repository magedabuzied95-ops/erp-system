import { ArrowDownCircle, CheckCheck, Loader2, MessageCircle } from "lucide-react";

import { portalChatMessagePreview, isPortalChatAudioMessage, portalChatTextParts } from "./portalChatUtils";
import PortalChatAttachment from "./PortalChatAttachment";

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
  onBeginSwipe,
  onMoveSwipe,
  onEndSwipe,
  firstUnreadIndex = -1,
  messageIdPrefix = "portal-chat-message",
  className = "",
  style,
}) {
  const backgroundStyle = style || DEFAULT_BACKGROUND;

  const scrollToMessage = (messageId) => {
    if (!messageId) return;
    document.getElementById(`${messageIdPrefix}-${messageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div
      ref={messagesRef}
      className={`min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain scroll-smooth px-3 py-2 ${className}`}
      style={backgroundStyle}
      onScroll={onScroll}
    >
      <div className="mx-auto mb-3 w-fit rounded-full bg-[#182229]/90 px-3 py-1 text-[11px] font-black text-slate-300">{labels.today || "اليوم"}</div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-5 text-sm font-bold text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {labels.loading || "جاري التحميل..."}
        </div>
      ) : messages.length ? (
        messages.map((message, index) => {
          const outgoing = message.sender_type === outgoingSenderType;
          const isAudioMessage = isPortalChatAudioMessage(message);
          const hasMessageBody = Boolean(String(message.body || "").trim());
          const voiceMessage = isAudioMessage && !hasMessageBody;
          return (
            <div id={`${messageIdPrefix}-${message.id}`} key={message.id || `${message.sender_type || "sender"}-${message.body || message.attachment_name || ""}-${message.created_at || ""}`}>
              {index === firstUnreadIndex ? (
                <div className="mx-auto mb-2 w-fit rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-black text-emerald-100">
                  {labels.unread || "رسائل غير مقروءة"}
                </div>
              ) : null}
              <div className={`flex rounded-2xl transition-shadow duration-300 ${outgoing ? "justify-end" : "justify-start"}`}>
                <div
                  onTouchStart={(event) => onBeginSwipe?.(event, message)}
                  onTouchMove={(event) => onMoveSwipe?.(event, message)}
                  onTouchEnd={onEndSwipe}
                  onTouchCancel={onEndSwipe}
                  className={`relative touch-pan-y select-none break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm ${voiceMessage ? "w-[min(78vw,18.5rem)] px-2 py-1" : "w-fit max-w-[78%] px-3 py-2"} ${outgoing ? "rounded-br-[0.25rem] bg-[#005c4b] text-white after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[#005c4b] after:[clip-path:polygon(0_0,100%_100%,0_100%)]" : "rounded-bl-[0.25rem] bg-[#202c33] text-slate-50 after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[#202c33] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"}`}
                >
                  {message.reply_to_message_id ? (
                    <button type="button" onClick={() => scrollToMessage(message.reply_to_message_id)} className="mb-1.5 w-full rounded-xl border-r-2 border-emerald-300 bg-black/10 px-2 py-1 text-start text-[11px] leading-4 text-slate-200/80">
                      <div className="font-black">{message.reply_sender_type === outgoingSenderType ? outgoingLabel : incomingLabel}</div>
                      <div className="truncate">{portalChatMessagePreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name }, labels)}</div>
                    </button>
                  ) : null}
                  <PortalChatAttachment
                    message={message}
                    compact
                    outgoing={outgoing}
                    timeText={timeFormatter(message.created_at)}
                    showChecks={outgoing}
                    read={Boolean(message.read_at)}
                    onImageClick={onImageClick}
                    labels={labels}
                  />
                  {message.body ? <PortalChatMessageText body={message.body} /> : null}
                  {!voiceMessage && onReply ? (
                    <button type="button" onClick={() => onReply(message)} className="mt-1 text-[10px] font-bold text-slate-300/60">
                      {labels.reply || "رد"}
                    </button>
                  ) : null}
                  {!voiceMessage ? (
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium leading-4 text-slate-300/65" dir="ltr">
                      <span>{timeFormatter(message.created_at)}</span>
                      {outgoing ? <CheckCheck className={`h-3.5 w-3.5 ${message.read_at ? "text-sky-300" : "text-slate-300/70"}`} /> : null}
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
  );
}
