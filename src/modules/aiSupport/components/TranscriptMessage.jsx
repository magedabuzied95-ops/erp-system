import { memo, useMemo } from "react";
import { useEffect, useRef, useState } from "react";
import { Bot, CheckSquare, Copy, ExternalLink, Info, MessageSquareText, Pin, PinOff, Reply as ReplyIcon, Smile, Sparkles, Star, UserCheck, X } from "lucide-react";

import { useTranslation } from "react-i18next";

import ProductCardMessage from "./ProductCardMessage";
import { AppleEmoji, AppleEmojiPicker } from "./AppleEmojiPicker.jsx";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const reactionEmoji = (value = "") => clean(value) === "❤" ? "❤️" : clean(value);
const QUICK_MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
export const INSTAGRAM_MESSAGE_REACTIONS = ["❤️"];
export const MESSENGER_MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "👎"];
const MESSAGE_PIN_STORAGE_KEY = "m1:ai-inbox:pinned-messages:v1";
const MESSAGE_STAR_STORAGE_KEY = "m1:ai-inbox:starred-messages:v1";
const MESSAGE_PIN_CHANGE_EVENT = "m1:ai-inbox-message-pin-change";
const MESSAGE_FOCUS_EVENT = "m1:ai-inbox-message-focus";
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

const attachmentType = (attachment = {}) => clean(attachment.type || attachment.media_type || attachment.message_type || attachment.mime_type || attachment.metadata?.media_type || attachment.metadata?.mime_type || "").toLowerCase();
const attachmentUrl = (attachment = {}) => clean(
  attachment.url ||
    attachment.image_url ||
    attachment.media_url ||
    attachment.attachment_url ||
    attachment.file_url ||
    attachment.link ||
    attachment.payload?.url ||
    attachment.payload?.image_url ||
    attachment.media?.url ||
    attachment.media?.image?.src ||
    attachment.metadata?.url ||
    attachment.metadata?.media_url ||
    attachment.metadata?.image_url ||
    ""
);

const messageAttachments = (message = {}) => [
  ...asArray(message.visual_attachments),
  ...asArray(message.visualAttachments),
  ...asArray(message.attachments),
  ...asArray(message.metadata?.visual_attachments),
  ...asArray(message.metadata?.attachments),
  ...asArray(message.channel_metadata?.visual_attachments),
  ...asArray(message.channel_metadata?.attachments),
];

const uniqueUrls = (values = []) => [...new Set(values.map((value) => clean(value)).filter(Boolean))];
/*
 * delivery_status is a RAW enum. It is compared against "failed"/"sending"
 * below and travels in payloads, so the value itself must never change --
 * only how it is shown. Keys live in a literal map rather than being built by
 * interpolation, so every one stays statically visible to the missing-key
 * guard, and an unrecognised status falls back to its raw text rather than
 * rendering nothing.
 */
const DELIVERY_STATUS_KEYS = {
  sending: "aiSupport.inbox.delivery.sending",
  sent: "aiSupport.inbox.delivery.sent",
  delivered: "aiSupport.inbox.delivery.delivered",
  read: "aiSupport.inbox.delivery.read",
  failed: "aiSupport.inbox.delivery.failed",
  pending: "aiSupport.inbox.delivery.pending",
};
const deliveryStatusLabel = (t, status) => {
  const key = DELIVERY_STATUS_KEYS[String(status || "").toLowerCase()];
  return key ? t(key) : String(status || "");
};

const PLACEHOLDER_BODY = /^\[(attachment|image|media|file|sticker)\]$/i;

const imageUrlsForMessage = (message = {}) =>
  uniqueUrls([
    message.image_url,
    !["audio", "voice", "ptt", "video", "document", "file"].includes(clean(message.message_type).toLowerCase()) ? message.media_url : "",
    message.attachment_url,
    message.file_url,
    message.preview_url,
    message.thumbnail_url,
    ...messageAttachments(message)
      .filter((attachment) => !["audio", "voice", "ptt", "video", "document", "file"].includes(attachmentType(attachment)))
      .map((attachment) => attachmentUrl(attachment)),
  ]);

const typedMediaUrls = (message = {}, types = []) =>
  uniqueUrls([
    ...(types.includes(clean(message.message_type).toLowerCase()) ? [message.media_url, message.attachment_url, message.file_url] : []),
    ...messageAttachments(message)
      .filter((attachment) => types.includes(attachmentType(attachment)))
      .map((attachment) => attachmentUrl(attachment)),
  ]);

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

const messageBodyText = (message = {}) =>
  clean(
    message.customer_message ||
      message.staff_message ||
      message.ai_answer ||
      message.message_text ||
      message.text ||
      message.body ||
      message.caption ||
      ""
  );

const messageIdentity = (row = {}, message = {}) =>
  clean(
    message.id ||
      message.message_id ||
      message.external_message_id ||
      message.provider_message_id ||
      message.whatsapp_message_id ||
      row.key ||
      `${row.kind || "message"}:${message.created_at || ""}:${messageBodyText(message).slice(0, 80)}`
  );

const readStoredMessageSet = (storageKey) => {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(asArray(JSON.parse(window.localStorage.getItem(storageKey) || "[]")).map((item) => clean(item)).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeStoredMessageFlag = (storageKey, messageKey, enabled) => {
  if (typeof window === "undefined" || !messageKey) return;
  const values = readStoredMessageSet(storageKey);
  if (enabled) values.add(messageKey);
  else values.delete(messageKey);
  window.localStorage.setItem(storageKey, JSON.stringify([...values].slice(-500)));
};

const dispatchMessagePinChange = (messageKey, pinned) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MESSAGE_PIN_CHANGE_EVENT, { detail: { messageKey, pinned } }));
};

export function PinnedMessagesBar({ rows = [], variant = "desktop" }) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener(MESSAGE_PIN_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MESSAGE_PIN_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const pinnedRows = useMemo(() => {
    const pinnedKeys = readStoredMessageSet(MESSAGE_PIN_STORAGE_KEY);
    return asArray(rows)
      .filter((row) => pinnedKeys.has(messageIdentity(row, row?.message || {})))
      .map((row) => {
        const message = row?.message || {};
        return {
          key: messageIdentity(row, message),
          text: messageBodyText(message) || "رسالة منتجات أو مرفقات",
          sender: row?.kind === "customer" ? "العميل" : row?.kind === "ai" ? "AI" : row?.kind === "staff" ? staffSenderLabel(message) : "رسالة",
        };
      });
  }, [rows, revision]);

  if (!pinnedRows.length) return null;

  const isPwa = variant === "pwa";
  return (
    <section
      dir="rtl"
      aria-label="Pinned messages"
      className={`sticky top-0 z-30 rounded-2xl border p-2 shadow-lg backdrop-blur-xl ${isPwa ? "border-amber-200 bg-white/95 text-slate-900" : "border-amber-300/20 bg-[#24251f]/95 text-white"}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-black ${isPwa ? "text-amber-700" : "text-amber-300"}`}>
          <Pin className="h-3.5 w-3.5 fill-current" />
          الرسائل المثبتة
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isPwa ? "bg-amber-100 text-amber-700" : "bg-amber-300/10 text-amber-200"}`}>{pinnedRows.length}</span>
      </div>
      <div className="flex max-w-full gap-2 overflow-x-auto pb-0.5">
        {pinnedRows.map((item) => (
          <div key={item.key} className={`flex min-w-[220px] max-w-[340px] flex-1 items-center gap-1 rounded-xl border ${isPwa ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/20"}`}>
            <button
              type="button"
              className="min-w-0 flex-1 px-2.5 py-2 text-right"
              onClick={() => window.dispatchEvent(new CustomEvent(MESSAGE_FOCUS_EVENT, { detail: { messageKey: item.key } }))}
            >
              <span className={`block text-[10px] font-black ${isPwa ? "text-amber-700" : "text-amber-300"}`}>{item.sender}</span>
              <span className={`block truncate text-xs font-semibold ${isPwa ? "text-slate-700" : "text-slate-200"}`}>{item.text}</span>
            </button>
            <button
              type="button"
              aria-label="Unpin message"
              title="Unpin"
              className={`mx-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isPwa ? "text-slate-500 hover:bg-slate-200" : "text-slate-400 hover:bg-white/10"}`}
              onClick={() => {
                writeStoredMessageFlag(MESSAGE_PIN_STORAGE_KEY, item.key, false);
                dispatchMessagePinChange(item.key, false);
              }}
            >
              <PinOff className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MessageActionShell({ row, message, variant, align = "left", createdAt = "", channelLabel = "", onReact, reactionOptions = QUICK_MESSAGE_REACTIONS, children }) {
  const key = messageIdentity(row, message);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selected, setSelected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionPickerExpanded, setReactionPickerExpanded] = useState(false);
  const [reactionSending, setReactionSending] = useState(false);
  const [localReaction, setLocalReaction] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const [pinned, setPinned] = useState(() => readStoredMessageSet(MESSAGE_PIN_STORAGE_KEY).has(key));
  const [starred, setStarred] = useState(() => readStoredMessageSet(MESSAGE_STAR_STORAGE_KEY).has(key));
  const shellRef = useRef(null);
  const reactionPickerAnchorRef = useRef(null);
  const text = messageBodyText(message);
  const reactions = asArray(row?.reactions).filter((reaction) => reactionEmoji(reaction?.message_text || reaction?.text || reaction?.customer_message || reaction?.staff_message));
  const ownReaction = reactions.find((reaction) => reaction.from_me === true || reaction.fromMe === true || clean(reaction.direction).toLowerCase() === "outbound" || clean(reaction.sender_type).toLowerCase() === "staff") || null;
  const ownReactionEmoji = reactionEmoji(ownReaction?.message_text || ownReaction?.text || ownReaction?.customer_message || ownReaction?.staff_message);
  const effectiveOwnReaction = localReaction === null ? ownReactionEmoji : localReaction;
  const reactionTargetMessageId = clean(message.provider_message_id || message.external_message_id || message.whatsapp_message_id || message.message_id);
  const canReact = Boolean(onReact && reactionTargetMessageId);
  const displayedReactions = [
    ...reactions.filter((reaction) => reaction !== ownReaction),
    ...(effectiveOwnReaction ? [{ id: `local-reaction:${key}`, message_text: effectiveOwnReaction, from_me: true, direction: "outbound", sender_type: "staff" }] : []),
  ];
  const sender = row.kind === "customer" ? "العميل" : row.kind === "ai" ? "AI" : row.kind === "staff" ? staffSenderLabel(message) : "الرسالة";

  useEffect(() => {
    setPinned(readStoredMessageSet(MESSAGE_PIN_STORAGE_KEY).has(key));
    setStarred(readStoredMessageSet(MESSAGE_STAR_STORAGE_KEY).has(key));
    setSelected(false);
    setReactionPickerOpen(false);
    setReactionPickerExpanded(false);
    setLocalReaction(null);
  }, [key]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (!shellRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  useEffect(() => {
    const syncPinState = (event) => {
      if (event.detail?.messageKey === key) setPinned(Boolean(event.detail?.pinned));
    };
    const focusMessage = (event) => {
      if (event.detail?.messageKey !== key) return;
      shellRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFocused(true);
      window.setTimeout(() => setFocused(false), 1600);
    };
    window.addEventListener(MESSAGE_PIN_CHANGE_EVENT, syncPinState);
    window.addEventListener(MESSAGE_FOCUS_EVENT, focusMessage);
    return () => {
      window.removeEventListener(MESSAGE_PIN_CHANGE_EVENT, syncPinState);
      window.removeEventListener(MESSAGE_FOCUS_EVENT, focusMessage);
    };
  }, [key]);

  const openActionsFromMessage = (event) => {
    if (!event.target.closest("[data-ai-message-bubble='true']")) return;
    if (event.target.closest("a, button, input, textarea, select, audio, video, [role='button']")) return;
    if (typeof window !== "undefined" && window.getSelection?.()?.toString()) return;
    const bounds = shellRef.current?.getBoundingClientRect();
    if (bounds) {
      const left = Math.max(8, Math.min(event.clientX - bounds.left, Math.max(8, bounds.width - 184)));
      const top = Math.max(8, event.clientY - bounds.top);
      setMenuPosition({ left, top });
    }
    setMenuOpen(true);
  };

  const copyMessage = async () => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
    setMenuOpen(false);
  };

  const replyToMessage = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("m1:ai-inbox-message-reply", { detail: { messageKey: key, sender, text, createdAt } }));
    }
    setMenuOpen(false);
  };

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    writeStoredMessageFlag(MESSAGE_PIN_STORAGE_KEY, key, next);
    dispatchMessagePinChange(key, next);
    setMenuOpen(false);
  };

  const toggleStarred = () => {
    const next = !starred;
    setStarred(next);
    writeStoredMessageFlag(MESSAGE_STAR_STORAGE_KEY, key, next);
    setMenuOpen(false);
  };

  const submitReaction = async (emoji) => {
    if (!canReact || reactionSending) return;
    const previousEmoji = effectiveOwnReaction;
    const nextEmoji = effectiveOwnReaction === emoji ? "" : emoji;
    setReactionSending(true);
    setLocalReaction(nextEmoji);
    setReactionPickerOpen(false);
    setReactionPickerExpanded(false);
    try {
      await onReact({
        row,
        message,
        emoji: nextEmoji,
        targetMessageId: reactionTargetMessageId,
        remoteJid: clean(message.remote_jid || message.resolved_reply_jid || message.channel_metadata?.remote_jid || ""),
        targetFromMe: clean(message.direction).toLowerCase() === "outbound" || ["staff", "ai", "system"].includes(clean(message.sender_type).toLowerCase()),
      });
    } catch {
      setLocalReaction(previousEmoji);
    } finally {
      setReactionSending(false);
    }
  };

  const menuItems = [
    { label: "Reply", icon: ReplyIcon, action: replyToMessage, disabled: !text },
    { label: copied ? "Copied" : "Copy", icon: Copy, action: copyMessage, disabled: !text },
    { label: pinned ? "Unpin" : "Pin", icon: pinned ? PinOff : Pin, action: togglePinned },
    { label: starred ? "Unstar" : "Star", icon: Star, action: toggleStarred, active: starred },
    { label: selected ? "Deselect" : "Select", icon: CheckSquare, action: () => { setSelected((current) => !current); setMenuOpen(false); }, active: selected },
    { label: "Info", icon: Info, action: () => { setInfoOpen(true); setMenuOpen(false); } },
  ];

  return (
    <div
      ref={shellRef}
      onClick={openActionsFromMessage}
      className={`ai-inbox-message-actions group relative cursor-context-menu rounded-2xl transition ${selected ? "bg-amber-300/10 p-1 ring-1 ring-amber-300/45" : ""} ${focused ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-transparent" : ""}`}
      data-message-key={key}
      data-message-selected={selected ? "true" : "false"}
    >
      {(pinned || starred) ? (
        <div className={`mb-1 flex items-center gap-1.5 px-2 text-[10px] font-black text-amber-400 ${align === "right" ? "justify-end" : "justify-start"}`}>
          {pinned ? <span className="inline-flex items-center gap-1"><Pin className="h-3 w-3" /> Pinned</span> : null}
          {starred ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current" /> Starred</span> : null}
        </div>
      ) : null}
      {children}
      {canReact ? (
        <div className={`-mt-2 flex px-3 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <button
            type="button"
            aria-label="إضافة تفاعل"
            title="إضافة تفاعل"
            onClick={() => setReactionPickerOpen((current) => !current)}
            className={`grid h-7 w-7 place-items-center rounded-full border shadow-sm transition hover:-translate-y-0.5 ${variant === "pwa" ? "border-slate-200 bg-white text-slate-500" : "border-white/10 bg-[#252824] text-slate-300"}`}
          >
            <Smile className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {reactionPickerOpen ? (
        <div data-ai-message-reaction-picker="true" className={`relative z-50 mt-1 flex px-2 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <div className={`inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border px-1.5 py-1 shadow-xl ${variant === "pwa" ? "border-slate-200 bg-white" : "border-white/10 bg-[#f8fafc]"}`}>
            {reactionOptions.map((emoji) => (
              <button key={emoji} type="button" disabled={reactionSending} onClick={() => void submitReaction(emoji)} className={`grid h-9 w-9 place-items-center rounded-full transition hover:-translate-y-0.5 hover:bg-slate-100 disabled:opacity-50 ${effectiveOwnReaction === emoji ? "bg-amber-100 ring-1 ring-amber-300" : ""}`} aria-label={`تفاعل ${emoji}`}><AppleEmoji emoji={emoji} size={25} /></button>
            ))}
            {reactionOptions.length > 1 ? <button ref={reactionPickerAnchorRef} type="button" onClick={() => setReactionPickerExpanded((current) => !current)} className="grid h-9 w-9 place-items-center rounded-full text-lg font-black text-slate-500 transition hover:bg-slate-100" aria-label="عرض كل الإيموجي">+</button> : null}
          </div>
        </div>
      ) : null}
      <AppleEmojiPicker
        open={reactionPickerExpanded}
        anchorRef={reactionPickerAnchorRef}
        onClose={() => setReactionPickerExpanded(false)}
        onSelect={(emoji) => void submitReaction(emoji)}
        title="اختيار تفاعل"
      />
      {displayedReactions.length ? (
        <div data-ai-message-reactions="true" className={`-mt-2 flex px-3 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <div className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2 py-0.5 shadow-sm ${variant === "pwa" ? "border-slate-200 bg-white text-slate-900" : "border-white/10 bg-[#252824] text-white"}`}>
            {displayedReactions.map((reaction) => {
              const emoji = reactionEmoji(reaction.message_text || reaction.text || reaction.customer_message || reaction.staff_message);
              const reactor = reaction.from_me === true || reaction.fromMe === true || clean(reaction.direction).toLowerCase() === "outbound" || clean(reaction.sender_type).toLowerCase() === "staff" ? "أنت" : "العميل";
              return <AppleEmoji key={messageIdentity({ kind: "reaction" }, reaction)} emoji={emoji} size={20} className="drop-shadow-sm" title={`${reactor}: ${emoji}`} />;
            })}
          </div>
        </div>
      ) : null}
      {menuOpen ? (
        <div
          dir="ltr"
          role="menu"
          aria-label="Message actions"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          className="absolute z-40 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 text-slate-800 shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
        >
          {menuItems.map(({ label, icon: Icon, action, disabled, active }) => (
            <button key={label} type="button" onClick={action} disabled={disabled} className={`flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-semibold transition hover:bg-slate-100 disabled:opacity-40 ${active ? "text-amber-600" : ""}`}>
              <Icon className={`h-4 w-4 ${active && label.includes("Star") ? "fill-current" : ""}`} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {infoOpen ? (
        <div className="fixed inset-0 z-[2147482500] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setInfoOpen(false); }}>
          <section dir="rtl" role="dialog" aria-modal="true" aria-label="Message info" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#20231f] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Message info</div><h3 className="mt-1 text-lg font-black">تفاصيل الرسالة</h3></div>
              <button type="button" onClick={() => setInfoOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5"><X className="h-4 w-4" /></button>
            </div>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
              <dt className="text-slate-400">المرسل</dt><dd className="font-bold">{sender}</dd>
              <dt className="text-slate-400">القناة</dt><dd className="font-bold">{channelLabel || message.channel || "—"}</dd>
              <dt className="text-slate-400">الوقت</dt><dd className="font-bold">{createdAt || "—"}</dd>
              <dt className="text-slate-400">النوع</dt><dd className="font-bold">{message.message_type || row.kind || "message"}</dd>
              <dt className="text-slate-400">الحالة</dt><dd className="font-bold">{message.delivery_status || "—"}</dd>
              <dt className="text-slate-400">المعرف</dt><dd dir="ltr" className="truncate text-left font-mono text-xs">{key || "—"}</dd>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

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

// Chat images are previews, not hero art. A 16:9 box with object-cover cropped
// portrait photos (the usual phone screenshot) into an unreadable strip and let a
// single attachment swallow the whole transcript, so keep the real aspect ratio
// and cap the footprint. The full image is one click away.
function MessageImageGrid({ urls = [], variant = "desktop", className = "mt-3" }) {
  if (!urls.length) return null;
  const size = variant === "pwa" ? "max-h-44 max-w-[180px]" : "max-h-56 max-w-[220px]";
  return (
    <div className={`${className} flex flex-wrap gap-2`}>
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-block overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60"
        >
          <img src={url} alt="Attachment" className={`${size} w-auto object-contain`} loading="lazy" decoding="async" />
        </a>
      ))}
    </div>
  );
}

// Media rendering used to exist only on the customer bubble in the PWA, so a
// photo the shop sent (or the AI echoed back) showed as a bare caption.
function PwaMessageMedia({ mediaUrls = [], audioUrls = [], videoUrls = [], documentUrls = [] }) {
  if (!mediaUrls.length && !audioUrls.length && !videoUrls.length && !documentUrls.length) return null;
  return (
    <>
      <MessageImageGrid urls={mediaUrls} variant="pwa" className="mt-2" />
      {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-2 w-full" />)}
      {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-2 max-h-72 w-full rounded-xl" />)}
      {documentUrls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700">
          فتح الملف
        </a>
      ))}
    </>
  );
}

function TranscriptMessage({
  row = null,
  variant = "desktop",
  onOpenCorrection,
  onReplyComment,
  onPrivateMessage,
  onReact,
  reactionOptions = QUICK_MESSAGE_REACTIONS,
  channelLabel = "",
}) {
  const { t } = useTranslation();
  const safeRow = row || {};
  const message = safeRow.message || {};
  const cards = asArray(safeRow.cards);
  const mediaUrls = useMemo(() => imageUrlsForMessage(message).slice(0, 4), [message]);
  const audioUrls = useMemo(() => typedMediaUrls(message, ["audio", "voice", "ptt"]).slice(0, 4), [message]);
  const videoUrls = useMemo(() => typedMediaUrls(message, ["video"]).slice(0, 4), [message]);
  const documentUrls = useMemo(() => typedMediaUrls(message, ["document", "file"]).slice(0, 4), [message]);
  // Messages stored before the webhook started writing a readable label still
  // carry the literal "[attachment]" body. Once the media itself is on screen
  // that string is pure noise, so swap it for the same label new rows get.
  const bodyText = useMemo(() => {
    const label = mediaUrls.length
      ? "📷 صورة"
      : videoUrls.length
        ? "🎥 فيديو"
        : audioUrls.length
          ? "🎤 رسالة صوتية"
          : documentUrls.length
            ? "📎 ملف"
            : "";
    return (value) => (label && PLACEHOLDER_BODY.test(clean(value)) ? label : value);
  }, [mediaUrls, videoUrls, audioUrls, documentUrls]);
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
        <MessageActionShell row={safeRow} message={message} variant="pwa" align="left" createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
          <div className="flex justify-start">
            <div data-ai-message-bubble="true" className="w-[82%] max-w-sm space-y-1.5">
              <div className="px-1 text-left text-[10px] font-medium text-slate-500">{createdAt}</div>
              <ProductCardMessage message={message} cards={cards} />
            </div>
          </div>
        </MessageActionShell>
      );
    }

    if (safeRow.kind === "customer") {
      return (
        <MessageActionShell row={safeRow} message={message} variant="pwa" align="right" createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
          <div className="flex justify-end">
            <div data-ai-message-bubble="true" className="ai-pwa-message ai-pwa-message--customer max-w-[82%] rounded-[20px] rounded-br-md px-3 py-2 shadow-sm ring-1">
            <div className="ai-pwa-message-meta mb-1 text-right text-[10px] font-medium">{createdAt}</div>
            <div className="ai-pwa-message-body">
              <LinkifiedText text={bodyText(message.customer_message)} className="text-[14px] leading-5.5" />
              {message.delivery_status === "failed" ? <span className="text-[11px] text-rose-500"> · Failed</span> : null}
              {message.delivery_status === "failed" && message.delivery_error ? (
                <p className="mt-1 text-[11px] leading-4 text-rose-200">{message.delivery_error}</p>
              ) : null}
              <MessageImageGrid urls={mediaUrls} variant="pwa" className="mt-2" />
              {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-2 w-full" />)}
              {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-2 max-h-72 w-full rounded-xl" />)}
              {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700">فتح الملف</a>)}
            </div>
          </div>
        </div>
        </MessageActionShell>
      );
    }

    if (safeRow.kind === "ai") {
      return (
        <MessageActionShell row={safeRow} message={message} variant="pwa" align="left" createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
          <div className="flex justify-start">
            <div data-ai-message-bubble="true" className="ai-pwa-message ai-pwa-message--ai max-w-[82%] rounded-[20px] rounded-bl-md px-3 py-2 shadow-sm ring-1">
            <div className="ai-pwa-message-meta mb-1 flex items-center gap-1 text-[10px] font-medium">
              <Bot className="h-3.5 w-3.5" />
              AI
            </div>
            <LinkifiedText text={bodyText(message.ai_answer)} className="ai-pwa-message-body text-[14px] leading-5.5" />
            <PwaMessageMedia mediaUrls={mediaUrls} audioUrls={audioUrls} videoUrls={videoUrls} documentUrls={documentUrls} />
            </div>
          </div>
        </MessageActionShell>
      );
    }

    if (safeRow.kind === "staff") {
      return (
        <MessageActionShell row={safeRow} message={message} variant="pwa" align="left" createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
          <div className="flex justify-start">
            <div data-ai-message-bubble="true" className={`ai-pwa-message ai-pwa-message--staff max-w-[82%] rounded-[20px] rounded-bl-md px-3 py-2 shadow-sm ${message.delivery_status === "failed" ? "ai-pwa-message--failed ring-1" : ""}`}>
            <div className="ai-pwa-message-meta mb-1 text-[10px] font-medium">
              {message.message_type === "internal_note" ? "ملاحظة داخلية" : staffSenderLabel(message)} · {createdAt}
            </div>
            <LinkifiedText text={bodyText(message.staff_message)} className="ai-pwa-message-body text-[14px] leading-5.5" />
            <PwaMessageMedia mediaUrls={mediaUrls} audioUrls={audioUrls} videoUrls={videoUrls} documentUrls={documentUrls} />
            {message.delivery_status === "failed" && message.delivery_error ? (
              <p className="mt-1 text-[11px] leading-4 text-rose-200">{message.delivery_error}</p>
            ) : null}
            </div>
          </div>
        </MessageActionShell>
      );
    }

    if (isCommentMessage) {
      return (
        <MessageActionShell row={safeRow} message={message} variant="pwa" align="left" createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
          <div className="flex justify-start">
            <div data-ai-message-bubble="true" className="max-w-[80%] rounded-2xl rounded-bl-md border border-amber-300/20 bg-amber-300/10 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">
              <MessageSquareText className="h-3.5 w-3.5" />
              <span>{commenterName || commentLabel}</span>
              <span className="text-slate-400">/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={bodyText(message.customer_message || message.message_text || message.text || message.body)} className="mt-2 text-[15px] leading-7 text-white" />
            <MessageImageGrid urls={mediaUrls} variant="pwa" />
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
        </MessageActionShell>
      );
    }

    return null;
  }

  return (
    <MessageActionShell row={safeRow} message={message} variant="desktop" align={safeRow.kind === "customer" || isCommentMessage ? "left" : "right"} createdAt={createdAt} channelLabel={channelLabel} onReact={onReact} reactionOptions={reactionOptions}>
      <div className="space-y-2" style={{ contentVisibility: "auto", containIntrinsicBlockSize: "180px" }}>
      {safeRow.kind === "product_card" ? (
        <div className="flex justify-end">
          <div data-ai-message-bubble="true" className="max-w-[88%]">
            <ProductCardMessage message={message} cards={cards} compact />
          </div>
        </div>
      ) : null}
      {safeRow.kind === "customer" ? (
        <div className="flex justify-start">
          <div data-ai-message-bubble="true" className="max-w-[80%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
              <span>العميل</span>
              <span>/</span>
              <span>{channelLabel}</span>
              <span>/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={bodyText(message.customer_message)} className="mt-2 text-[15px] leading-7 text-white" />
            <MessageImageGrid urls={mediaUrls} />
            {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-3 w-full" />)}
            {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-3 max-h-80 w-full rounded-2xl border border-white/10 bg-slate-950/80" />)}
            {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-black text-cyan-100">فتح الملف</a>)}
          </div>
        </div>
      ) : null}
      {safeRow.kind === "ai" ? (
        <div className="flex justify-end">
          <div data-ai-message-bubble="true" className="max-w-[80%] rounded-2xl rounded-br-md border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 shadow-[0_10px_30px_rgba(8,145,178,0.14)]">
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
            <LinkifiedText text={bodyText(message.ai_answer)} className="mt-2 text-[15px] leading-7 text-white" />
            {message.suggested_products?.length ? <div className="mt-3"><ProductCardMessage message={message} cards={message.suggested_products} compact /></div> : null}
            {/* visual_attachments already feed mediaUrls via imageUrlsForMessage —
                rendering them separately here painted every AI image twice. */}
            <MessageImageGrid urls={mediaUrls} />
          </div>
        </div>
      ) : null}
      {safeRow.kind === "staff" ? (
        <div className="flex justify-end">
          <div data-ai-message-bubble="true" className={`max-w-[80%] rounded-2xl rounded-br-md px-4 py-3 shadow-[0_10px_30px_rgba(16,185,129,0.12)] ${message.message_type === "automation_error" ? "border border-rose-300/20 bg-rose-400/10" : "border border-emerald-300/15 bg-emerald-400/10"}`}>
            <div className={`flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] ${message.message_type === "automation_error" ? "text-rose-100" : "text-emerald-100"}`}>
              <UserCheck className="h-3.5 w-3.5" />
              <span>{staffSenderLabel(message)}</span>
              {message.staff_user_name && message.staff_user_name !== "أنا" ? <span className="text-slate-400">{message.staff_user_name}</span> : null}
              {message.message_type && !["text", "conversation"].includes(clean(message.message_type).toLowerCase()) ? (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${message.message_type === "automation_error" ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : message.message_type === "comment_like" ? "border-white/10 bg-white/[0.055] text-slate-100" : message.message_type === "comment_private_reply" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : "border-violet-300/20 bg-violet-400/10 text-violet-100"}`}>
                  {message.message_type}
                </span>
              ) : null}
              <span className="text-slate-500">{createdAt}</span>
              {message.delivery_status ? <span className={message.delivery_status === "failed" ? "text-rose-200" : message.delivery_status === "sending" ? "text-amber-200" : "text-emerald-200"}>{deliveryStatusLabel(t, message.delivery_status)}</span> : null}
            </div>
            <LinkifiedText text={bodyText(message.staff_message)} className="mt-2 text-[15px] leading-7 text-white" />
            <MessageImageGrid urls={mediaUrls} />
            {audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url} className="mt-3 w-full" />)}
            {videoUrls.map((url) => <video key={url} controls preload="metadata" src={url} className="mt-3 max-h-80 w-full rounded-2xl border border-white/10 bg-slate-950/80" />)}
            {documentUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-black text-cyan-100">فتح الملف</a>)}
            {message.delivery_error ? <p className="mt-2 text-xs font-bold text-rose-200">{message.delivery_error}</p> : null}
          </div>
        </div>
      ) : null}
      {isCommentMessage ? (
        <div className="flex justify-start">
          <div data-ai-message-bubble="true" className="max-w-[80%] rounded-2xl rounded-bl-md border border-amber-300/20 bg-amber-300/10 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">
              <MessageSquareText className="h-3.5 w-3.5" />
              <span>{commenterName || commentLabel}</span>
              <span className="text-slate-400">/</span>
              <span>{createdAt}</span>
            </div>
            <LinkifiedText text={bodyText(message.customer_message || message.message_text || message.text || message.body)} className="mt-2 text-[15px] leading-7 text-white" />
            <MessageImageGrid urls={mediaUrls} />
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
    </MessageActionShell>
  );
}

export default memo(TranscriptMessage, (prev, next) => prev.row === next.row && prev.variant === next.variant && prev.onOpenCorrection === next.onOpenCorrection && prev.onReact === next.onReact && prev.reactionOptions === next.reactionOptions && prev.channelLabel === next.channelLabel);

