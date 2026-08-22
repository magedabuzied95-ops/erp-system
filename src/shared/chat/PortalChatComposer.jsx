import { Loader2, Mic, Paperclip, Send, Smile, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import WhatsAppRecordingBar from "../../modules/employees/components/WhatsAppRecordingBar";
import { CHAT_ATTACHMENT_ACCEPT, formatPortalChatFileSize, portalChatMessagePreview } from "./portalChatUtils";

const MAX_LINES = 5;
const RECENT_EMOJI_KEY = "m1.chat.recentEmoji";
const EMOJI = [
  "😀", "😂", "🥲", "😊", "😍", "😘", "😎", "🤔", "😅", "😭", "😡", "🙄", "😴", "🤒", "🥳", "🤝",
  "👍", "👎", "👏", "🙏", "💪", "👌", "✌️", "🤞", "👋", "❤️", "💛", "💔", "🔥", "✨", "⭐", "✅",
  "❌", "⚠️", "📞", "📦", "🧾", "💰", "💵", "🛒", "🏬", "🚚", "⏰", "📅", "📍", "📸", "🎉", "🙌",
];

// A synthetic change event so paste/drop reuse the caller's <input type=file> handler.
const fileEvent = (file) => ({ target: { files: [file], value: "" } });

const readRecentEmoji = () => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((item) => typeof item === "string").slice(0, 16) : [];
  } catch {
    return [];
  }
};

function EmojiPicker({ onPick, onClose, label }) {
  const [recent, setRecent] = useState(readRecentEmoji);
  const pick = (emoji) => {
    const next = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, 16);
    setRecent(next);
    try { window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    onPick(emoji);
  };
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-label={label} className="absolute bottom-full start-0 z-40 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-[1.1rem] border border-[var(--chat-border)] bg-[var(--chat-chrome)] p-2 shadow-2xl" dir="ltr">
      {recent.length ? (
        <div className="mb-1 grid grid-cols-8 gap-0.5 border-b border-[var(--chat-border)] pb-1">
          {recent.map((emoji) => <button key={`r-${emoji}`} type="button" onClick={() => pick(emoji)} className="grid h-9 place-items-center rounded-lg text-[22px] hover:bg-[var(--surface-hover)]">{emoji}</button>)}
        </div>
      ) : null}
      <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
        {EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => pick(emoji)} className="grid h-9 place-items-center rounded-lg text-[22px] hover:bg-[var(--surface-hover)]">{emoji}</button>)}
      </div>
    </div>
  );
}

export default function PortalChatComposer({
  onSubmit,
  body,
  setBody,
  sending = false,
  attachment = null,
  setAttachment,
  setAttachmentDuration,
  replyTo = null,
  setReplyTo,
  editingMessage = null,
  setEditingMessage,
  labels = {},
  fileInputRef,
  inputRef,
  chooseAttachment,
  emitTyping,
  recordingState = { active: false, paused: false, seconds: 0, supported: false },
  recordingStream = null,
  onCancelRecording,
  onToggleRecordingPause,
  onSendRecording,
  onStartRecording,
  disabled = false,
  onScrollToReply,
}) {
  const { t } = useTranslation();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const localInputRef = useRef(null);
  const textareaRef = inputRef || localInputRef;
  const hasText = Boolean(String(body || "").trim());
  const canSend = !disabled && !sending && (hasText || Boolean(attachment));
  const finePointer = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;

  const removeAttachment = () => {
    setAttachment?.(null);
    setAttachmentDuration?.(0);
    if (fileInputRef?.current) fileInputRef.current.value = "";
  };

  // Auto-grow up to MAX_LINES, then scroll inside (WhatsApp's composer).
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "0px";
    const line = parseFloat(getComputedStyle(node).lineHeight) || 22;
    const padding = node.offsetHeight - node.clientHeight;
    const max = line * MAX_LINES + 18;
    // Empty: one line, whatever the placeholder wraps to in a narrow column.
    const wanted = String(body || "").length ? node.scrollHeight + padding : line + padding + 8;
    node.style.height = `${Math.min(wanted, max)}px`;
    node.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [body, textareaRef]);

  const onKeyDown = (event) => {
    // Desktop: Enter sends, Shift+Enter breaks the line. Touch keyboards keep
    // Enter as a newline and send from the button.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing && finePointer) {
      event.preventDefault();
      if (canSend) event.currentTarget.form?.requestSubmit?.();
      return;
    }
    if (event.key === "Escape") {
      if (editingMessage) { setEditingMessage?.(null); setBody?.(""); }
      else if (replyTo) setReplyTo?.(null);
    }
  };

  const pickFile = useCallback((file) => {
    if (!file || disabled) return;
    chooseAttachment?.(fileEvent(file));
  }, [chooseAttachment, disabled]);

  const onPaste = (event) => {
    const file = [...(event.clipboardData?.files || [])][0];
    if (!file) return;
    event.preventDefault();
    pickFile(file);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = [...(event.dataTransfer?.files || [])][0];
    if (file) pickFile(file);
  };

  const insertEmoji = (emoji) => {
    const node = textareaRef.current;
    const value = String(body || "");
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setBody?.(next);
    window.requestAnimationFrame(() => {
      if (!node) return;
      node.focus();
      const caret = start + emoji.length;
      node.setSelectionRange(caret, caret);
    });
  };

  const attachmentPreview = useMemo(() => {
    if (!attachment) return null;
    const isImage = String(attachment.type || "").startsWith("image/");
    const url = isImage ? URL.createObjectURL(attachment) : "";
    return { isImage, url, name: attachment.name, size: formatPortalChatFileSize(attachment.size) };
  }, [attachment]);
  useEffect(() => () => { if (attachmentPreview?.url) URL.revokeObjectURL(attachmentPreview.url); }, [attachmentPreview]);

  const iconButton = "flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-full text-[var(--chat-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--chat-text)] disabled:opacity-50";

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={(event) => { if (!disabled) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative z-30 flex-none border-t border-[var(--chat-border)] bg-[var(--chat-chrome)] px-2 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1.5 ${dragging ? "outline outline-2 -outline-offset-4 outline-dashed outline-[var(--primary)]" : ""}`}
    >
      {recordingState.active ? (
        <WhatsAppRecordingBar
          stream={recordingStream}
          seconds={recordingState.seconds}
          paused={recordingState.paused}
          sending={sending}
          onDelete={onCancelRecording}
          onPauseResume={onToggleRecordingPause}
          onSend={onSendRecording}
        />
      ) : (
        <>
          {replyTo ? (
            <div className="mb-1.5 flex items-stretch gap-1 rounded-[0.9rem] bg-[var(--chat-input)] p-1 text-[12px] font-bold leading-5 text-[var(--chat-text)]">
              <button type="button" onClick={() => onScrollToReply?.(replyTo.id)} className="min-w-0 flex-1 rounded-[0.7rem] border-s-[4px] border-[var(--chat-quote)] bg-[var(--chat-chrome)] px-3 py-1.5 text-start" dir="auto">
                <div className="truncate text-[13px] font-black text-[var(--chat-quote)]">{replyTo.sender_type === labels.outgoingSenderType ? labels.you || t("employeePortal.chat.you") : labels.management || t("employeePortal.chat.admin.management")}</div>
                <div className="truncate text-[12px] font-semibold text-[var(--chat-text)]/80">{portalChatMessagePreview(replyTo, labels)}</div>
              </button>
              <button type="button" onClick={() => setReplyTo?.(null)} className={iconButton} aria-label={labels.cancelReply || t("common.close")}>
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          {editingMessage ? (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-[0.9rem] bg-[var(--chat-input)] px-2.5 py-1.5 text-[11px] font-bold leading-4 text-[var(--chat-text)]">
              <div className="min-w-0 flex-1 border-s-[3px] border-[var(--primary)] ps-2 text-start">
                <div className="text-[var(--primary)]">{labels.editing || t("common.edit")}</div>
                <div className="truncate opacity-80" dir="auto">{editingMessage.body}</div>
              </div>
              <button type="button" onClick={() => { setEditingMessage?.(null); setBody?.(""); }} className="flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-full bg-[var(--chat-chrome)] text-[var(--danger)]" aria-label={t("common.close")}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {attachmentPreview ? (
            <div className="mb-1.5 flex items-center gap-3 rounded-[0.9rem] bg-[var(--chat-input)] p-1.5 text-[var(--chat-text)]">
              {attachmentPreview.isImage ? (
                <img src={attachmentPreview.url} alt="" className="h-16 w-16 shrink-0 rounded-[0.7rem] object-cover" />
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[0.7rem] bg-[var(--chat-chrome)] text-[var(--chat-muted)]"><Paperclip className="h-5 w-5" /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-black" dir="auto">{attachmentPreview.name}</span>
                <span className="block text-[11px] font-bold text-[var(--chat-muted)]" dir="ltr">{attachmentPreview.size}</span>
                <span className="block text-[11px] font-semibold text-[var(--chat-muted)]">{labels.captionHint || t("employeePortal.chat.captionHint")}</span>
              </span>
              <button type="button" onClick={removeAttachment} className={iconButton} aria-label={labels.removeAttachment || t("common.delete")}>
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          {disabled && labels.disabledNotice ? (
            <div className="mb-2 rounded-[var(--radius-card)] border border-[var(--chat-border)] bg-[var(--chat-input)] px-3 py-2 text-xs font-bold text-[var(--chat-text)]">
              {labels.disabledNotice}
            </div>
          ) : null}
          <div className="relative flex items-end gap-1">
            <input ref={fileInputRef} type="file" className="hidden" accept={CHAT_ATTACHMENT_ACCEPT} onChange={chooseAttachment} />
            {emojiOpen ? <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} label={labels.emoji || t("employeePortal.chat.emoji")} /> : null}
            <div className="flex min-h-[var(--control-height-md)] min-w-0 flex-1 items-end gap-0.5 rounded-[1.4rem] border border-[var(--chat-border)] bg-[var(--chat-input)] ps-1 pe-1">
              <button type="button" onClick={() => setEmojiOpen((open) => !open)} disabled={disabled} className={`${iconButton} mb-0.5 h-9 w-9`} aria-label={labels.emoji || t("employeePortal.chat.emoji")} aria-expanded={emojiOpen}>
                <Smile className="h-5 w-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(event) => { setBody(event.target.value); emitTyping?.(); }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onFocus={() => setEmojiOpen(false)}
                placeholder={labels.placeholder || t("employeePortal.chat.placeholder")}
                rows={1}
                enterKeyHint={finePointer ? "send" : "enter"}
                autoComplete="off"
                autoCapitalize="sentences"
                spellCheck="true"
                className="my-1 min-h-[30px] min-w-0 flex-1 resize-none bg-transparent px-1 py-1 !text-[16px] font-medium leading-[22px] text-[var(--chat-text)] outline-none [transform:none] placeholder:text-[var(--chat-muted)]"
                dir="auto"
                disabled={disabled}
              />
              <button type="button" onClick={() => fileInputRef?.current?.click()} disabled={disabled} className={`${iconButton} mb-0.5 h-9 w-9`} aria-label={labels.attachFile || t("employeePortal.chat.attachFile")}>
                <Paperclip className="h-5 w-5" />
              </button>
            </div>
            {hasText || attachment || !recordingState.supported ? (
              <button type="submit" disabled={!canSend} className="flex h-[var(--control-height-md)] w-[var(--control-height-md)] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-contrast)] shadow-md transition active:scale-95 disabled:opacity-50" aria-label={labels.send || t("common.send")}>
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 rtl:-scale-x-100" />}
              </button>
            ) : (
              <button type="button" onClick={onStartRecording} disabled={disabled} className="flex h-[var(--control-height-md)] w-[var(--control-height-md)] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-contrast)] shadow-md transition active:scale-95 disabled:opacity-50" aria-label={labels.recordVoice || t("employeePortal.chat.voiceRecording")}>
                <Mic className="h-5 w-5" />
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
