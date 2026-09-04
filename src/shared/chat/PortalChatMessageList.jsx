import { dateKeyInAppTimezone, shiftDateKey, todayInAppTimezone } from "../lib/appTimezone";
import { AlertCircle, ArrowDownCircle, Check, CheckCheck, ChevronDown, Clock3, Copy, Forward, Loader2, MessageCircle, Pencil, Reply, RotateCcw, Star, StarOff, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { messageDeliveryState, portalChatMessagePreview, isPortalChatAudioMessage, isPortalChatImageMessage, portalChatTextParts } from "./portalChatUtils";
import PortalChatAttachment from "./PortalChatAttachment";
import ChatLinkPreview from "./ChatLinkPreview";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
/* Consecutive messages from one sender inside this window share a group:
   tight spacing, one tail, one sender boundary — the WhatsApp reading rhythm. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const LONG_PRESS_MS = 380;
const LONG_PRESS_MOVE_PX = 10;

const reactionCounts = (reactions = []) => Object.entries((Array.isArray(reactions) ? reactions : []).reduce((counts, reaction) => {
  const emoji = String(reaction?.emoji || "").trim();
  if (emoji) counts[emoji] = (counts[emoji] || 0) + 1;
  return counts;
}, {}));

export function MessageTicks({ message, className = "h-3.5 w-3.5" }) {
  const state = messageDeliveryState(message);
  if (state === "failed") return <AlertCircle className={`${className} text-[var(--danger)]`} aria-label="failed" />;
  if (state === "pending") return <Clock3 className={`${className} text-[var(--chat-tick)]`} aria-label="pending" />;
  if (state === "sent") return <Check className={`${className} text-[var(--chat-tick)]`} aria-label="sent" />;
  return <CheckCheck className={`${className} ${state === "read" ? "text-[var(--chat-read)]" : "text-[var(--chat-tick)]"}`} aria-label={state} />;
}

const highlightParts = (text, query) => {
  if (!query) return [text];
  const haystack = String(text).toLocaleLowerCase("ar");
  const needle = query.toLocaleLowerCase("ar");
  const out = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(<mark key={`m-${at}`} className="rounded-sm bg-[var(--primary)] px-0.5 text-[var(--primary-contrast)]">{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
};

function PortalChatMessageText({ body = "", reserve = 0, highlight = "" }) {
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
          <span key={`text-${index}`}>{highlightParts(part.text, highlight)}</span>
        )
      )}
      {/* WhatsApp's trick: an inline spacer the width of the time/ticks so the
          last line never runs under the absolutely positioned meta. */}
      {reserve ? <span className="inline-block h-1 align-bottom" style={{ width: reserve }} aria-hidden="true" /> : null}
    </div>
  );
}

// First strong character decides the paragraph direction (what dir="auto" does),
// so the time/ticks can sit at the *end* of the text where the spacer is.
const STRONG_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG_LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
const bodyDirection = (body = "") => {
  for (const char of String(body)) {
    if (STRONG_RTL.test(char)) return "rtl";
    if (STRONG_LTR.test(char)) return "ltr";
  }
  return "rtl";
};

// Days are the store's days: a message at 01:00 Cairo belongs to "today" on every device.
const messageDayKey = (value) => dateKeyInAppTimezone(new Date(value || 0));

const messageDayLabel = (value, labels = {}, language = "ar") => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  const today = todayInAppTimezone();
  const key = messageDayKey(date);
  if (key === today) return labels.today;
  if (key === shiftDateKey(today, -1)) return labels.yesterday;
  const locale = String(language || "").toLowerCase().startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
};

const messageTime = (value) => new Date(value || 0).getTime() || 0;
const sameGroup = (left, right) =>
  Boolean(left && right) &&
  left.sender_type === right.sender_type &&
  messageDayKey(left.created_at) === messageDayKey(right.created_at) &&
  Math.abs(messageTime(right.created_at) - messageTime(left.created_at)) < GROUP_WINDOW_MS;

function TypingDots({ label = "" }) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-[1.05rem] rounded-tl-[0.25rem] bg-[var(--chat-bubble-in)] px-3 py-2.5 shadow-sm" aria-live="polite" aria-label={label} dir="ltr">
      {[0, 1, 2].map((index) => (
        <span key={index} className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--chat-muted)]" style={{ animationDelay: `${index * 160}ms` }} />
      ))}
    </div>
  );
}

/*
 * One bubble. Memoised on the fields that can change after first paint so a
 * keystroke in the composer (which re-renders the list's parent) does not
 * re-render three hundred of these. Handlers arrive through `handlers`, a ref
 * the list keeps current, so the comparator never sees a fresh closure.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  outgoing,
  groupStart,
  labels,
  timeText,
  outgoingLabel,
  incomingLabel,
  outgoingSenderType,
  messageIdPrefix,
  handlers,
  selectable,
  highlight,
  fetchLinkPreview,
}) {
  const deleted = Boolean(message.deleted_at);
  const hasBody = Boolean(String(message.body || "").trim());
  const voiceMessage = isPortalChatAudioMessage(message) && !hasBody;
  const imageOnly = isPortalChatImageMessage(message) && !hasBody && !deleted;
  const failed = messageDeliveryState(message) === "failed";
  const starred = Array.isArray(message.stars) && message.stars.includes(outgoingSenderType);
  const reactions = useMemo(() => reactionCounts(message.reactions), [message.reactions]);
  const pressRef = useRef({ timer: null, x: 0, y: 0, fired: false });

  const cancelPress = () => {
    if (pressRef.current.timer) window.clearTimeout(pressRef.current.timer);
    pressRef.current.timer = null;
  };
  const onPointerDown = (event) => {
    if (deleted || event.pointerType === "mouse" || event.target.closest("a, button, input, audio, video")) return;
    const node = event.currentTarget;
    pressRef.current = { timer: null, x: event.clientX, y: event.clientY, fired: false };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.fired = true;
      if (navigator.vibrate) navigator.vibrate(12);
      handlers.current.openActions(message, node);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (event) => {
    if (!pressRef.current.timer) return;
    if (Math.abs(event.clientX - pressRef.current.x) > LONG_PRESS_MOVE_PX || Math.abs(event.clientY - pressRef.current.y) > LONG_PRESS_MOVE_PX) cancelPress();
  };
  const onContextMenu = (event) => {
    if (deleted) return;
    event.preventDefault();
    handlers.current.openActions(message, event.currentTarget);
  };

  const tail = groupStart
    ? outgoing
      ? "rounded-tr-[0.25rem] after:absolute after:top-0 after:-right-[7px] after:h-3 after:w-3 after:bg-[var(--chat-bubble-out)] after:[clip-path:polygon(0_0,100%_0,0_100%)]"
      : "rounded-tl-[0.25rem] after:absolute after:top-0 after:-left-[7px] after:h-3 after:w-3 after:bg-[var(--chat-bubble-in)] after:[clip-path:polygon(0_0,100%_0,100%_100%)]"
    : "";
  const surface = outgoing
    ? "bg-[var(--chat-bubble-out)] text-[var(--chat-text)]"
    : "bg-[var(--chat-bubble-in)] text-[var(--chat-text)]";
  const size = voiceMessage ? "w-[min(76vw,18.5rem)] px-2 py-1" : imageOnly ? "w-fit max-w-[82%] p-1" : "w-fit max-w-[82%] px-3 py-1.5";
  const metaRef = useRef(null);
  const [metaWidth, setMetaWidth] = useState(0);
  useLayoutEffect(() => {
    const width = metaRef.current?.offsetWidth || 0;
    if (width && width !== metaWidth) setMetaWidth(width);
  }, [metaWidth, timeText, message.edited_at]);
  // Measured once mounted; the estimate only covers the very first paint.
  const metaReserve = (metaWidth || (outgoing ? 62 : 44) + (message.edited_at && !deleted ? 40 : 0) + (starred ? 16 : 0)) + 6;
  const textDirection = hasBody && !deleted ? bodyDirection(message.body) : "rtl";
  const meta = (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium leading-4 ${imageOnly ? "text-white" : "text-[var(--chat-muted)]/80"}`} dir="ltr">
      {starred ? <Star className="h-3 w-3 fill-current" aria-label={labels.starred} /> : null}
      {message.edited_at && !deleted ? <span>{labels.edited}</span> : null}
      <span className="tabular-nums">{timeText}</span>
      {outgoing ? <MessageTicks message={message} /> : null}
    </span>
  );

  return (
    <div id={`${messageIdPrefix}-${message.id || message.client_id}`} className={groupStart ? "mt-2" : "mt-0.5"}>
      <div dir="ltr" className={`group/bubble flex items-end gap-1.5 ${outgoing ? "justify-end" : "justify-start"}`}>
        {outgoing && failed ? (
          <button type="button" onClick={() => handlers.current.retry?.(message)} className="mb-1 inline-flex h-7 items-center gap-1 rounded-full border border-[var(--danger)]/40 px-2 text-[11px] font-black text-[var(--danger)]" title={labels.retry}>
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{labels.retry}</span>
          </button>
        ) : null}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={onContextMenu}
          onTouchStart={(event) => handlers.current.onBeginSwipe?.(event, message)}
          onTouchMove={(event) => handlers.current.onMoveSwipe?.(event, message)}
          onTouchEnd={handlers.current.onEndSwipe}
          onTouchCancel={handlers.current.onEndSwipe}
          className={`relative touch-pan-y break-words rounded-[1.05rem] text-[15px] font-medium leading-5 shadow-sm ${selectable ? "select-text" : "select-none"} ${size} ${surface} ${tail} ${failed ? "opacity-70" : ""}`}
          dir="rtl"
        >
          {!deleted ? (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); handlers.current.openActions(message, event.currentTarget.parentElement); }}
              className="absolute end-1 top-1 z-10 hidden h-6 w-6 place-items-center rounded-full bg-[var(--chat-chrome)]/85 text-[var(--chat-muted)] opacity-0 shadow transition group-hover/bubble:opacity-100 focus-visible:opacity-100 md:grid"
              aria-label={labels.messageActions}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : null}
          {message.reply_to_message_id ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); handlers.current.scrollToMessage(message.reply_to_message_id); }} className="mb-1.5 block w-full min-w-[12rem] max-w-[19rem] rounded-[0.6rem] border-s-[4px] border-[var(--chat-quote)] bg-black/10 px-3 py-1.5 text-start" dir="auto">
              <div className="truncate text-[13px] font-black leading-5 text-[var(--chat-quote)]">{message.reply_sender_type === outgoingSenderType ? outgoingLabel : incomingLabel}</div>
              <div className="line-clamp-2 text-[13px] font-semibold leading-5 text-[var(--chat-text)]/80">{portalChatMessagePreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name }, labels)}</div>
            </button>
          ) : null}
          {!deleted ? (
            <div className={imageOnly ? "relative" : ""}>
              <PortalChatAttachment
                message={message}
                compact
                outgoing={outgoing}
                timeText={timeText}
                showChecks={outgoing}
                read={Boolean(message.read_at)}
                onImageClick={handlers.current.onImageClick}
                labels={labels}
              />
              {imageOnly ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-end rounded-b-[var(--radius-control)] bg-gradient-to-t from-black/55 to-transparent px-2 pb-1 pt-5">
                  {meta}
                </div>
              ) : null}
            </div>
          ) : null}
          {!deleted && hasBody && fetchLinkPreview ? <ChatLinkPreview body={message.body} fetchLinkPreview={fetchLinkPreview} outgoing={outgoing} /> : null}
          {deleted ? <div className="pe-5 italic text-[var(--chat-muted)]/70">{labels.deleted}</div> : hasBody ? <PortalChatMessageText body={message.body} reserve={metaReserve} highlight={highlight} /> : null}
          {!voiceMessage && !imageOnly ? (
            hasBody || deleted
              ? <div ref={metaRef} className={`absolute bottom-1 ${textDirection === "ltr" ? "right-2" : "left-2"}`} dir="ltr">{meta}</div>
              : <div className="mt-0.5 flex justify-end" dir="ltr">{meta}</div>
          ) : null}
          {reactions.length && !deleted ? (
            <div className={`mt-1 flex flex-wrap items-center gap-1 ${outgoing ? "justify-end" : ""}`} dir="ltr">
              {reactions.map(([emoji, count]) => (
                <button key={emoji} type="button" onClick={(event) => { event.stopPropagation(); handlers.current.onReact?.(message, emoji); }} className="flex h-6 items-center gap-1 rounded-full border border-[var(--chat-border)] bg-[var(--chat-pill)] px-2 text-[14px] shadow-sm" aria-label={`${labels.react} ${emoji}`}>
                  <span>{emoji}</span>{count > 1 ? <span className="text-[10px] font-black text-[var(--chat-muted)]">{count}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.message === next.message
  && prev.outgoing === next.outgoing
  && prev.groupStart === next.groupStart
  && prev.timeText === next.timeText
  && prev.labels === next.labels
  && prev.outgoingLabel === next.outgoingLabel
  && prev.incomingLabel === next.incomingLabel
  && prev.selectable === next.selectable
  && prev.highlight === next.highlight
  && prev.fetchLinkPreview === next.fetchLinkPreview
);

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
  jumpCount = 0,
  onJumpToBottom,
  typingLabel = "",
  onImageClick,
  onReply,
  onForward,
  onStar,
  onReact,
  onEdit,
  onDelete,
  onRetry,
  onBeginSwipe,
  onMoveSwipe,
  onEndSwipe,
  onLoadOlder,
  hasOlder = false,
  loadingOlder = false,
  firstUnreadIndex = -1,
  messageIdPrefix = "portal-chat-message",
  className = "",
  style,
  highlight = "",
  fetchLinkPreview = null,
}) {
  const { t, i18n } = useTranslation();
  const [activeMessage, setActiveMessage] = useState(null);
  const [actionAnchor, setActionAnchor] = useState(null);
  /*
   * Defaults resolve through i18n, not literals: this list is shared by the
   * manager portal, the employee app and the POS dock, and a literal Arabic
   * default rendered Arabic chrome inside the English shell.
   */
  const labels = useMemo(() => ({
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
    retry: t("common.retry"),
    loadOlder: t("employeePortal.chat.loadOlder"),
    star: t("employeePortal.chat.star"),
    unstar: t("employeePortal.chat.unstar"),
    starred: t("employeePortal.chat.starred"),
    ...Object.fromEntries(Object.entries(rawLabels).filter(([, value]) => value != null && value !== "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, i18n.language, JSON.stringify(rawLabels)]);
  const resolvedOutgoingLabel = outgoingLabel || t("employeePortal.chat.you");
  const resolvedIncomingLabel = incomingLabel || t("employeePortal.chat.admin.management");

  const scrollToMessage = useCallback((messageId) => {
    if (!messageId) return;
    const node = document.getElementById(`${messageIdPrefix}-${messageId}`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.classList.add("chat-bubble-flash");
    window.setTimeout(() => node.classList.remove("chat-bubble-flash"), 1400);
  }, [messageIdPrefix]);

  const closeActions = () => {
    setActiveMessage(null);
    setActionAnchor(null);
  };
  const openActions = useCallback((message, node) => {
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
  }, []);

  // Latest handlers live in a ref so MessageBubble's memo comparator is not
  // defeated by the inline arrows every caller passes.
  const handlers = useRef({});
  handlers.current = { openActions, scrollToMessage, onImageClick, onReact, onBeginSwipe, onMoveSwipe, onEndSwipe, retry: onRetry };

  const selectable = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;

  // Load older on reaching the top, without stealing the scroll position.
  const topSentinelRef = useRef(null);
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = messagesRef?.current;
    if (!sentinel || !root || !hasOlder || !onLoadOlder) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !loadingOlder) onLoadOlder();
    }, { root, rootMargin: "120px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadingOlder, messagesRef, onLoadOlder]);

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
          {onStar && activeMessage.id ? (() => { const isStarred = Array.isArray(activeMessage.stars) && activeMessage.stars.includes(outgoingSenderType); return <button type="button" onClick={() => { onStar(activeMessage); closeActions(); }} className="flex min-h-[var(--control-height-lg)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-start hover:bg-[var(--surface-hover)]">{isStarred ? <StarOff className="h-[18px] w-[18px]" /> : <Star className="h-[18px] w-[18px]" />}{isStarred ? labels.unstar : labels.star}</button>; })() : null}
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
      className={`chat-canvas min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 ${className}`}
      style={style}
      onScroll={onScroll}
    >
      {hasOlder && !loading ? (
        <div ref={topSentinelRef} className="flex justify-center py-2">
          <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="inline-flex h-8 items-center gap-2 rounded-full bg-[var(--chat-pill)] px-3 text-[11px] font-black text-[var(--chat-muted)] disabled:opacity-60">
            {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {labels.loadOlder}
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--chat-input)] px-3 py-5 text-sm font-bold text-[var(--chat-text)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {labels.loading}
        </div>
      ) : messages.length ? (
        messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDay = index === 0 || messageDayKey(previous?.created_at) !== messageDayKey(message.created_at);
          const unreadDivider = index === firstUnreadIndex;
          const groupStart = showDay || unreadDivider || !sameGroup(previous, message);
          return (
            <div key={message.id || message.client_id || `${message.sender_type || "sender"}-${message.created_at || ""}`}>
              {showDay ? <div className="mx-auto mb-1 mt-2 w-fit rounded-full bg-[var(--chat-pill)] px-3 py-1 text-[11px] font-black text-[var(--chat-muted)] shadow-sm">{messageDayLabel(message.created_at, labels, i18n.language)}</div> : null}
              {unreadDivider ? (
                <div className="mx-auto mb-1 mt-2 w-fit rounded-full bg-[var(--primary-soft)] px-3 py-1 text-[11px] font-black text-[var(--primary)]">
                  {labels.unread}
                </div>
              ) : null}
              <MessageBubble
                message={message}
                outgoing={message.sender_type === outgoingSenderType}
                groupStart={groupStart}
                labels={labels}
                timeText={timeFormatter(message.created_at)}
                outgoingLabel={resolvedOutgoingLabel}
                incomingLabel={resolvedIncomingLabel}
                outgoingSenderType={outgoingSenderType}
                messageIdPrefix={messageIdPrefix}
                handlers={handlers}
                selectable={selectable}
                highlight={highlight}
                fetchLinkPreview={fetchLinkPreview}
              />
            </div>
          );
        })
      ) : (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--chat-border)] bg-[var(--chat-input)] px-4 py-8 text-center text-sm font-bold text-[var(--chat-muted)]">
          <MessageCircle className="mx-auto h-8 w-8" />
          <div className="mt-2">{labels.empty}</div>
        </div>
      )}
      {typingLabel ? <div className="mt-2"><TypingDots label={typingLabel} /></div> : null}
      {showJump ? (
        <button type="button" onClick={onJumpToBottom} className="sticky bottom-3 z-10 ms-auto flex h-[var(--control-height-md)] min-w-9 items-center justify-center gap-1 rounded-full bg-[var(--chat-chrome)] px-2 text-[var(--chat-text)] shadow-lg">
          {jumpCount > 0 ? <span className="rounded-full bg-[var(--primary)] px-1.5 text-[11px] font-black text-[var(--primary-contrast)] tabular-nums" dir="ltr">{jumpCount}</span> : null}
          <ArrowDownCircle className="h-5 w-5" />
        </button>
      ) : null}
    </div>
    {actionSheet}
    </>
  );
}
