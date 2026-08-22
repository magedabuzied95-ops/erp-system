import { ArrowDownCircle, CheckCheck, Copy, Forward, Loader2, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { portalChatMessagePreview, isPortalChatAudioMessage, portalChatTextParts } from "./portalChatUtils";
import PortalChatAttachment from "./PortalChatAttachment";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const reactionCounts = (reactions = []) => Object.entries((Array.isArray(reactions) ? reactions : []).reduce((counts, reaction) => {
  const emoji = String(reaction?.emoji || "").trim();
  if (emoji) counts[emoji] = (counts[emoji] || 0) + 1;
  return counts;
}, {}));


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
            className="select-text font-semibold text-[var(--chat-link)] underline decoration-[var(--chat-link)]/45 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-[var(--chat-link)] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chat-link)]"
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

const messageDayLabel = (value, labels = {}, language = "ar") => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = messageDayKey(date);
  if (key === messageDayKey(today)) return labels.today;
  if (key === messageDayKey(yesterday)) return labels.yesterday;
  const locale = String(language || "").toLowerCase().startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export default function PortalChatMessageList({
  messages = [],
  loading = false,
  labels: rawLabels = {},
  outgoingSenderType = "employee",
  outgoingLabel,
  incomingLabel,
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
  const { t, i18n } = useTranslation();
  const [activeMessage, setActiveMessage] = useState(null);
  const [actionAnchor, setActionAnchor] = useState(null);
  /*
   * Defaults resolve through i18n, not literals: this list is shared by the
   * manager portal, the employee app and the POS dock, and a literal Arabic
   * default rendered Arabic chrome inside the English shell.
   */
  const labels = {
    today: t("common.today"),
    yesterday: t("common.yesterday"),
    loading: t("common.loading"),
    empty: t("employeePortal.chat.admin.threadEmpty"),
    unread: t("employeePortal.chat.unread"),
    deleted: t("employeePortal.chat.deletedMessage"),
    edited: t("employeePortal.chat.edited"),
    messageActions: t("employeePortal.chat.messageActions"),
    close: t("common.close"),
    reply: t("employeePortal.chat.admin.reply"),
    forward: t("employeePortal.chat.forward"),
    copy: t("common.copy"),
    edit: t("common.edit"),
    delete: t("employeePortal.chat.deleteForAll"),
    react: t("employeePortal.chat.react"),
    ...Object.fromEntries(Object.entries(rawLabels).filter(([, value]) => value != null && value !== "")),
  };
  const resolvedOutgoingLabel = outgoingLabel || t("employeePortal.chat.you");
  const resolvedIncomingLabel = incomingLabel || t("employeePortal.chat.admin.management");

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
    <div className="fixed inset-0 z-[140]" dir={i18n.dir()} role="dialog" aria-modal="true" aria-label={labels.messageActions}>
      <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={closeActions} aria-label={labels.close} />
      <div className="absolute overflow-hidden rounded-[1.4rem] border border-[var(--chat-border)] bg-[var(--chat-chrome)] p-2 text-[var(--chat-text)] shadow-2xl backdrop-blur-xl" style={actionAnchor || undefined}>
        {onReact ? (
          <div className="mb-2 flex items-center justify-between gap-1 rounded-2xl bg-[var(--chat-input)] px-2 py-2 shadow-inner" dir="ltr">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => { onReact(activeMessage, emoji); closeActions(); }} className="grid h-[var(--control-height-md)] w-9 place-items-center rounded-full text-[24px] transition hover:-translate-y-1 hover:bg-[var(--surface-hover)] active:scale-90" aria-label={`${labels.react} ${emoji}`}>{emoji}</button>
            ))}
          </div>
        ) : null}
        <div className="mb-1 truncate rounded-xl bg-black/15 px-3 py-2 text-xs font-semibold text-[var(--chat-muted)]" dir="auto">{portalChatMessagePreview(activeMessage, labels)}</div>
        <div className="grid text-[15px] font-bold">
          {onReply ? <button type="button" onClick={() => { onReply(activeMessage); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start hover:bg-[var(--surface-hover)]"><Reply className="h-[18px] w-[18px]" />{labels.reply}</button> : null}
          {onForward ? <button type="button" onClick={() => { onForward(activeMessage); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start hover:bg-[var(--surface-hover)]"><Forward className="h-[18px] w-[18px]" />{labels.forward}</button> : null}
          {activeMessage.body ? <button type="button" onClick={() => { navigator.clipboard?.writeText?.(activeMessage.body); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start hover:bg-[var(--surface-hover)]"><Copy className="h-[18px] w-[18px]" />{labels.copy}</button> : null}
          {activeMessage.sender_type === outgoingSenderType && activeMessage.body && onEdit ? <button type="button" onClick={() => { onEdit(activeMessage); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start hover:bg-[var(--surface-hover)]"><Pencil className="h-[18px] w-[18px]" />{labels.edit}</button> : null}
          {activeMessage.sender_type === outgoingSenderType && onDelete ? <button type="button" onClick={() => { onDelete(activeMessage); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start text-[var(--danger)] hover:bg-[var(--surface-hover)]"><Trash2 className="h-[18px] w-[18px]" />{labels.delete}</button> : null}
        </div>
      </div>
    </div>, document.body
  ) : null;

  return (
    <>
    <div
      ref={messagesRef}
      className={`chat-canvas min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain scroll-smooth px-3 py-2 ${className}`}
      style={style}
      onScroll={onScroll}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--chat-input)] px-3 py-5 text-sm font-bold text-[var(--chat-text)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {labels.loading}
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
              {showDay ? <div className="mx-auto mb-3 mt-2 w-fit rounded-full bg-[var(--chat-pill)] px-3 py-1 text-[11px] font-black text-[var(--chat-muted)]">{messageDayLabel(message.created_at, labels, i18n.language)}</div> : null}
              {index === firstUnreadIndex ? (
                <div className="mx-auto mb-2 w-fit rounded-full bg-[var(--primary-soft)] px-3 py-1 text-[11px] font-black text-[var(--primary)]">
                  {labels.unread}
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
                  className={`relative cursor-pointer touch-pan-y select-none break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm transition active:brightness-110 ${voiceMessage ? "w-[min(76vw,18.5rem)] px-2 py-1" : "w-fit max-w-[82%] px-3 py-2"} ${outgoing ? "rounded-br-[0.25rem] bg-[var(--chat-bubble-out)] text-[var(--chat-text)] after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[var(--chat-bubble-out)] after:[clip-path:polygon(0_0,100%_100%,0_100%)]" : "rounded-bl-[0.25rem] bg-[var(--chat-bubble-in)] text-[var(--chat-text)] after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[var(--chat-bubble-in)] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"}`}
                  dir="rtl"
                >
                  {message.reply_to_message_id ? (
                    <button type="button" onClick={(event) => { event.stopPropagation(); scrollToMessage(message.reply_to_message_id); }} className="mb-2 block w-full min-w-[12rem] max-w-[19rem] rounded-[0.8rem] border-l-[4px] border-[var(--chat-quote)] bg-black/20 px-3 py-2 text-start shadow-inner" dir="rtl">
                      <div className="truncate text-[13px] font-black leading-5 text-[var(--chat-quote)]">{message.reply_sender_type === outgoingSenderType ? resolvedOutgoingLabel : resolvedIncomingLabel}</div>
                      <div className="line-clamp-2 text-[13px] font-semibold leading-5 text-[var(--chat-text)]/80">{portalChatMessagePreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name }, labels)}</div>
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
                  {deleted ? <div className="pe-5 italic text-[var(--chat-muted)]/70">{labels.deleted}</div> : message.body ? <PortalChatMessageText body={message.body} /> : null}
                  {!voiceMessage ? (
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium leading-4 text-[var(--chat-muted)]/65" dir="ltr">
                      <span>{timeFormatter(message.created_at)}</span>
                      {message.edited_at && !deleted ? <span>{labels.edited}</span> : null}
                      {outgoing ? <CheckCheck className={`h-3.5 w-3.5 ${message.read_at ? "text-primary" : "text-[var(--chat-muted)]/70"}`} /> : null}
                    </div>
                  ) : null}
                  {!deleted && reactionCounts(message.reactions).length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1" dir="ltr">
                      {reactionCounts(message.reactions).map(([emoji, count]) => (
                        <button key={emoji} type="button" onClick={(event) => { event.stopPropagation(); onReact?.(message, emoji); }} className="flex h-6 items-center gap-1 rounded-full border border-[var(--chat-border)] bg-[var(--chat-pill)] px-2 text-[14px] shadow-sm" aria-label={`${labels.react} ${emoji}`}>
                          <span>{emoji}</span>{count > 1 ? <span className="text-[10px] font-black text-[var(--chat-muted)]">{count}</span> : null}
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
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--chat-border)] bg-[var(--chat-input)] px-4 py-8 text-center text-sm font-bold text-[var(--chat-muted)]">
          <MessageCircle className="mx-auto h-8 w-8" />
          <div className="mt-2">{labels.empty}</div>
        </div>
      )}
      {typingLabel ? <div className="w-fit rounded-2xl bg-[var(--chat-chrome)] px-3 py-1.5 text-[12px] font-bold text-[var(--primary)]">{typingLabel}</div> : null}
      {showJump ? (
        <button type="button" onClick={onJumpToBottom} className="sticky bottom-3 z-10 ms-auto flex h-[var(--control-height-md)] w-9 items-center justify-center rounded-full bg-[var(--chat-chrome)] text-[var(--chat-text)] shadow-lg">
          <ArrowDownCircle className="h-5 w-5" />
        </button>
      ) : null}
    </div>
    {actionSheet}
    </>
  );
}
