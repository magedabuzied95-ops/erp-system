import { memo, useContext, useMemo } from "react";
import { useEffect, useRef, useState } from "react";
import { Bot, Camera, CheckSquare, Copy, ExternalLink, Info, MessageSquareText, Pencil, Pin, PinOff, Reply as ReplyIcon, Smile, Sparkles, Star, UserCheck, X } from "lucide-react";

import { useTranslation } from "react-i18next";

import ProductCardMessage from "./ProductCardMessage";
import MessageMedia, { messageMediaGroups, messageStoryContext } from "./MessageMedia.jsx";
import DeliveryTicks, { isTickableDeliveryStatus } from "./DeliveryTicks.jsx";
import CustomerAvatar from "./CustomerAvatar.jsx";
import { bubbleClock, chromeModeFor, platformChrome, resolveMessagePlatform } from "./messagePlatform.js";
// The context, not the hook: this component also renders in the message
// previews and the pinned bar, and useTheme throws outside a provider.
import { ThemeContext } from "../../../theme/themeContext";
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
// WhatsApp refuses an edit older than 15 minutes, so the action disappears
// rather than offering a button that can only fail. Mirrors
// WHATSAPP_EDIT_WINDOW_MS on the server.
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const EDITABLE_MESSAGE_TYPES = new Set(["", "text", "private_message"]);
const isOutboundMessage = (message = {}) =>
  message.from_me === true ||
  message.fromMe === true ||
  clean(message.direction).toLowerCase() === "outbound" ||
  ["staff", "agent", "human", "ai", "assistant", "bot", "system"].includes(clean(message.sender_type).toLowerCase());
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

// The webhook writes a readable label as the body of a media-only message
// ("📷 صورة", "🎤 رسالة صوتية", "📎 ملف"), and older rows still carry the literal
// "[attachment]". Once the attachment itself renders as a player, a tile or a
// file card, repeating that label above it is noise — so a body that is nothing
// but the label is dropped, while a real caption is always kept.
const MEDIA_BODY_LABELS = new Set(["صورة", "ملصق", "فيديو", "رسالة صوتية", "ملف", "مرفق", "image", "photo", "sticker", "video", "voice note", "audio", "file", "attachment"]);
const isGenericMediaBody = (value = "") => {
  const stripped = clean(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return !stripped || MEDIA_BODY_LABELS.has(stripped);
};

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
  const { t } = useTranslation();
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
      aria-label={t("aiSupport.inbox.message.pinnedMessages")}
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
              aria-label={t("aiSupport.inbox.message.unpinMessage")}
              title={t("aiSupport.inbox.message.unpin")}
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

function MessageActionShell({ row, message, variant, align = "left", createdAt = "", channelLabel = "", onReact, onEditMessage, reactionOptions = QUICK_MESSAGE_REACTIONS, children }) {
  const { t } = useTranslation();
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
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [locallyEdited, setLocallyEdited] = useState(false);
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
  const sentAtMs = message.created_at ? new Date(message.created_at).getTime() : 0;
  const withinEditWindow = Boolean(sentAtMs) && Date.now() - sentAtMs <= MESSAGE_EDIT_WINDOW_MS;
  const canEdit = Boolean(
    onEditMessage
      && reactionTargetMessageId
      && text
      && isOutboundMessage(message)
      && withinEditWindow
      && EDITABLE_MESSAGE_TYPES.has(clean(message.message_type).toLowerCase())
      && !asArray(message.visual_attachments).length
      && !asArray(message.product_cards || message.productCards).length
  );
  const wasEdited = Boolean(message.edited_at) || locallyEdited;
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
    setEditing(false);
    setEditDraft("");
    setLocallyEdited(false);
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
    if (editing) return;
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

  const startEditing = () => {
    setEditDraft(text);
    setEditing(true);
    setMenuOpen(false);
  };

  const submitEdit = async () => {
    const nextText = clean(editDraft);
    if (!canEdit || editSaving || !nextText || nextText === text) {
      setEditing(false);
      return;
    }
    setEditSaving(true);
    try {
      await onEditMessage({
        row,
        message,
        text: nextText,
        targetMessageId: reactionTargetMessageId,
        remoteJid: clean(message.remote_jid || message.resolved_reply_jid || message.channel_metadata?.remote_jid || ""),
      });
      setLocallyEdited(true);
      setEditing(false);
    } catch {
      // The toast is raised by the caller; the editor stays open with the draft
      // so the text the operator typed is never lost on a failed edit.
    } finally {
      setEditSaving(false);
    }
  };

  const menuItems = [
    { label: t("aiSupport.inbox.message.reply"), icon: ReplyIcon, action: replyToMessage, disabled: !text },
    ...(canEdit ? [{ label: t("aiSupport.inbox.message.edit"), icon: Pencil, action: startEditing }] : []),
    { label: t(copied ? "aiSupport.inbox.message.copied" : "aiSupport.inbox.message.copy"), icon: Copy, action: copyMessage, disabled: !text },
    { label: t(pinned ? "aiSupport.inbox.message.unpin" : "aiSupport.inbox.message.pin"), icon: pinned ? PinOff : Pin, action: togglePinned },
    { label: t(starred ? "aiSupport.inbox.message.unstar" : "aiSupport.inbox.message.star"), icon: Star, action: toggleStarred, active: starred },
    { label: t(selected ? "aiSupport.inbox.message.deselect" : "aiSupport.inbox.message.select"), icon: CheckSquare, action: () => { setSelected((current) => !current); setMenuOpen(false); }, active: selected },
    { label: t("aiSupport.inbox.message.info"), icon: Info, action: () => { setInfoOpen(true); setMenuOpen(false); } },
  ];

  return (
    <div
      ref={shellRef}
      onClick={openActionsFromMessage}
      className={`ai-inbox-message-actions group relative cursor-context-menu rounded-2xl transition ${selected ? "bg-amber-300/10 p-1 ring-1 ring-amber-300/45" : ""} ${focused ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-transparent" : ""}`}
      data-message-key={key}
      data-message-selected={selected ? "true" : "false"}
    >
      {(pinned || starred || wasEdited) ? (
        <div className={`mb-1 flex items-center gap-1.5 px-2 text-[10px] font-black text-amber-400 ${align === "right" ? "justify-end" : "justify-start"}`}>
          {pinned ? <span className="inline-flex items-center gap-1"><Pin className="h-3 w-3" /> {t("aiSupport.inbox.message.pinned")}</span> : null}
          {starred ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current" /> {t("aiSupport.inbox.message.starred")}</span> : null}
          {wasEdited ? <span className="inline-flex items-center gap-1"><Pencil className="h-3 w-3" /> {t("aiSupport.inbox.message.edited")}</span> : null}
        </div>
      ) : null}
      {children}
      {editing ? (
        <div data-ai-message-editor="true" className={`mt-1 flex px-2 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <div dir="rtl" className={`w-full max-w-[420px] rounded-2xl border p-2 shadow-lg ${variant === "pwa" ? "border-slate-200 bg-white text-slate-900" : "border-amber-300/40 bg-[#20231f] text-white"}`}>
            <div className="mb-1 text-[10px] font-black text-amber-400">{t("aiSupport.inbox.message.editTitle")}</div>
            <textarea
              autoFocus
              dir="auto"
              rows={3}
              value={editDraft}
              maxLength={4096}
              disabled={editSaving}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); setEditing(false); return; }
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitEdit(); }
              }}
              className={`w-full resize-y rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${variant === "pwa" ? "border-slate-200 bg-slate-50 text-slate-900" : "border-white/10 bg-black/25 text-white"}`}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-slate-400">{t("aiSupport.inbox.message.editHint")}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={editSaving} onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-xs font-black text-slate-400 transition hover:bg-white/10 disabled:opacity-50">{t("aiSupport.inbox.message.editCancel")}</button>
                <button type="button" disabled={editSaving || !clean(editDraft) || clean(editDraft) === text} onClick={() => void submitEdit()} className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-black transition hover:bg-amber-300 disabled:opacity-40">{t(editSaving ? "aiSupport.inbox.message.editSaving" : "aiSupport.inbox.message.editSave")}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {canReact ? (
        <div className={`-mt-2 flex px-3 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <button
            type="button"
            aria-label={t("aiSupport.inbox.message.addReaction")}
            title={t("aiSupport.inbox.message.addReaction")}
            onClick={() => setReactionPickerOpen((current) => !current)}
            className={`grid h-7 w-7 place-items-center rounded-full border shadow-sm transition hover:-translate-y-0.5 ${variant === "pwa" ? "border-slate-200 bg-white text-slate-500" : "border-white/10 bg-[#252824] text-slate-300"}`}
          >
            <Smile className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {reactionPickerOpen ? (
        <div data-ai-message-reaction-picker="true" className={`relative z-50 mt-1 flex px-2 ${align === "right" ? "justify-end" : "justify-start"}`}>
          <div className={`inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border px-1.5 py-1 shadow-xl ${variant === "pwa" ? "border-slate-200 bg-white" : "border-white/10 bg-[#232833]"}`}>
            {reactionOptions.map((emoji) => (
              <button key={emoji} type="button" disabled={reactionSending} onClick={() => void submitReaction(emoji)} className={`grid h-9 w-9 place-items-center rounded-full transition hover:-translate-y-0.5 hover:bg-slate-100 disabled:opacity-50 ${effectiveOwnReaction === emoji ? "bg-amber-100 ring-1 ring-amber-300" : ""}`} aria-label={`تفاعل ${emoji}`}><AppleEmoji emoji={emoji} size={25} /></button>
            ))}
            {reactionOptions.length > 1 ? <button ref={reactionPickerAnchorRef} type="button" onClick={() => setReactionPickerExpanded((current) => !current)} className="grid h-9 w-9 place-items-center rounded-full text-lg font-black text-slate-500 transition hover:bg-slate-100" aria-label={t("aiSupport.inbox.message.showAllEmoji")}>+</button> : null}
          </div>
        </div>
      ) : null}
      <AppleEmojiPicker
        open={reactionPickerExpanded}
        anchorRef={reactionPickerAnchorRef}
        onClose={() => setReactionPickerExpanded(false)}
        onSelect={(emoji) => void submitReaction(emoji)}
        title={t("aiSupport.inbox.message.pickReaction")}
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
          aria-label={t("aiSupport.inbox.message.messageActions")}
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
          <section dir="rtl" role="dialog" aria-modal="true" aria-label={t("aiSupport.inbox.message.messageInfo")} className="w-full max-w-md rounded-3xl border border-white/10 bg-[#20231f] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-lg font-black">{t("aiSupport.inbox.message.messageInfo")}</h3></div>
              <button type="button" onClick={() => setInfoOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5"><X className="h-4 w-4" /></button>
            </div>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
              <dt className="text-slate-400">{t("aiSupport.inbox.message.sender")}</dt><dd className="font-bold">{sender}</dd>
              <dt className="text-slate-400">{t("aiSupport.inbox.message.channel")}</dt><dd className="font-bold">{channelLabel || message.channel || "—"}</dd>
              <dt className="text-slate-400">{t("aiSupport.inbox.message.time")}</dt><dd className="font-bold">{createdAt || "—"}</dd>
              <dt className="text-slate-400">{t("aiSupport.inbox.message.type")}</dt><dd className="font-bold">{message.message_type || row.kind || "message"}</dd>
              <dt className="text-slate-400">{t("aiSupport.inbox.message.status")}</dt><dd className="font-bold">{message.delivery_status || "—"}</dd>
              {/* The AI bubble used to print "conf 0.62" beside the sender caption.
                  It is a diagnostic, not chat, so it moved here with the rest. */}
              {Number(message.confidence) > 0 ? (
                <>
                  <dt className="text-slate-400">{t("aiSupport.inbox.message.confidence")}</dt>
                  <dd dir="ltr" className="text-left font-bold tabular-nums">{Number(message.confidence).toFixed(2)}</dd>
                </>
              ) : null}
              <dt className="text-slate-400">{t("aiSupport.inbox.message.identifier")}</dt><dd dir="ltr" className="truncate text-left font-mono text-xs">{key || "—"}</dd>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function LinkifiedText({ text = "", className = "", linkClassName = "font-black text-cyan-100 decoration-cyan-300/50" }) {
  const value = String(text || "");
  if (!value.trim()) return null;
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p dir="auto" className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>;
        return (
          <a key={`${index}-${part}`} href={part} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-4 ${linkClassName}`}>
            {part}
          </a>
        );
      })}
    </p>
  );
}

/* ── Chat chrome ─────────────────────────────────────────────────────────────
 * A bubble, a stamp, and — on the customer's side — a small round picture next
 * to it. That is the whole vocabulary of every chat app the customer is actually
 * using, and it is now the whole vocabulary here: no sender caption, no channel
 * name, no full date. The day lives in the separator above the group, and the
 * channel lives in the colours the bubble is painted in.
 * ------------------------------------------------------------------------- */

function ChatBubble({ chrome, side, flush = false, className = "", children }) {
  const tone = side === "in" ? chrome.inbound : chrome.outbound;
  // The tail sits on the top corner nearest the edge the bubble is anchored to.
  // Logical corners keep that true whichever direction the transcript runs in.
  const tail = side === "in" ? "rounded-ss-[4px]" : "rounded-se-[4px]";
  return (
    <div
      data-ai-message-bubble="true"
      className={`relative max-w-full overflow-hidden ${chrome.radius} ${tail} ${tone} ${flush ? "p-[3px]" : "px-2.5 py-1.5"} shadow-[0_1px_2px_rgba(0,0,0,0.22)] ${className}`}
    >
      {children}
    </div>
  );
}

// The stamp: the time, then the delivery marks, at the bottom-end of the bubble.
// Over a photo it becomes the same translucent pill the platforms float on the
// image itself.
function BubbleStamp({ chrome, side, time, status, showTicks = false, floating = false, leading = null, trailing = null }) {
  const meta = side === "in" ? chrome.inboundMeta : chrome.outboundMeta;
  return (
    <div
      className={floating
        ? "absolute bottom-2 end-2 z-10 flex items-center gap-1 rounded-full bg-black/[0.55] px-1.5 py-0.5 text-[10.5px] font-medium leading-4 text-white/90 backdrop-blur-sm"
        : `mt-0.5 flex items-center justify-end gap-1 text-[10.5px] font-medium leading-4 ${meta}`}
    >
      {leading}
      {time ? <span className="tabular-nums">{time}</span> : null}
      {showTicks ? <DeliveryTicks status={status} /> : null}
      {trailing}
    </div>
  );
}

function ChatRow({ side, align, avatarUrl = "", customerName = "", showAvatar = false, variant = "desktop", children }) {
  const avatarSize = variant === "pwa" ? "h-6 w-6" : "h-7 w-7";
  return (
    <div className={`flex items-end gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
      {side === "in" ? (
        showAvatar ? (
          <CustomerAvatar
            url={avatarUrl}
            name={customerName}
            // One size, one place: CustomerAvatar concatenates className with
            // imgClassName, so an `h-full` there would out-rank the box set here.
            className={`${avatarSize} shrink-0 self-end rounded-full object-cover`}
            fallbackClassName={variant === "pwa" ? "bg-slate-200 text-[10px] text-slate-600" : "bg-white/[0.12] text-[10px] text-slate-200"}
            iconClassName="h-3.5 w-3.5"
          />
        ) : (
          <span aria-hidden="true" className={`${avatarSize} shrink-0`} />
        )
      ) : null}
      <div className={`flex min-w-0 max-w-[78%] flex-col ${side === "in" ? "items-start" : "items-end"}`}>{children}</div>
    </div>
  );
}

// A story reply used to land in the transcript as a bare line of text: the
// customer answers one of our stories with "بكام؟" and nothing on screen says
// which story they were looking at. The frame is quoted above the message the
// way the platform itself shows it, and names the product whenever the webhook
// could match the story id back to one of our published stories.
const STORY_TONES = {
  desktop: {
    shell: "border-white/10 bg-white/[0.05]",
    bar: "bg-fuchsia-400",
    label: "text-fuchsia-200",
    title: "text-white",
    link: "text-fuchsia-200 hover:text-fuchsia-100",
  },
  pwa: {
    shell: "border-black/10 bg-black/[0.04]",
    bar: "bg-fuchsia-500",
    label: "text-fuchsia-700",
    title: "text-slate-900",
    link: "text-fuchsia-700 hover:text-fuchsia-800",
  },
};

function StoryContext({ story, variant = "desktop" }) {
  const { t } = useTranslation();
  // The story frame is a signed CDN link when we could not resolve the story to
  // one of ours, so it can be dead by the time the operator opens the thread.
  // The quote still has to say what the message is about, so the label stays.
  const [imageFailed, setImageFailed] = useState(false);
  if (!story) return null;
  const tone = STORY_TONES[variant] || STORY_TONES.desktop;
  const label = story.kind === "story_mention"
    ? t("aiSupport.inbox.message.storyMention")
    : t("aiSupport.inbox.message.storyReply");
  const details = [story.productName, story.color].filter(Boolean).join(" · ");
  return (
    <div className={`mt-2 flex items-stretch gap-2 overflow-hidden rounded-xl border ${tone.shell}`}>
      <span className={`w-1 shrink-0 ${tone.bar}`} aria-hidden="true" />
      {story.url && !imageFailed ? (
        <img
          src={story.url}
          alt={label}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="my-1.5 h-14 w-10 shrink-0 rounded-md object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1 px-1 py-1.5">
        <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${tone.label}`}>
          <Camera className="h-3 w-3" />
          <span>{label}</span>
        </div>
        {details ? <p dir="auto" className={`mt-0.5 truncate text-[12px] font-bold ${tone.title}`}>{details}</p> : null}
        {story.productUrl ? (
          <a
            href={story.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold ${tone.link}`}
          >
            <ExternalLink className="h-3 w-3" />
            {t("aiSupport.inbox.message.storyOpenProduct")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// The context of the comment an auto private-reply DM answered: the post the customer commented on
// (image + caption + link) with their comment quoted beneath. Only comment_private_reply DM rows
// carry `source_comment_text`, so this never fires on an ordinary text reply.
const sourceCommentContext = (message = {}) => {
  const postImage = clean(message.post_full_picture || message.post_thumbnail || message.attachment_image || "");
  const postText = clean(message.post_message || message.post_caption || "");
  const postUrl = clean(message.post_permalink_url || message.comment_url || message.post_permalink || "");
  const commentText = clean(message.source_comment_text || "");
  const commenter = clean(message.commenter_name || "");
  const isPrivateReply = clean(message.message_type).toLowerCase() === "comment_private_reply";
  if (!isPrivateReply && !commentText) return null;
  if (!postImage && !postText && !commentText && !postUrl) return null;
  return { postImage, postText, postUrl, commentText, commenter };
};

function SourceCommentContext({ context, variant = "desktop" }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!context) return null;
  const { postImage, postText, postUrl, commentText, commenter } = context;
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/50">
      <div className="flex items-stretch gap-2">
        <span className="w-1 shrink-0 bg-cyan-400" aria-hidden="true" />
        {postImage && !imageFailed ? (
          <img
            src={postImage}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="my-1.5 h-14 w-14 shrink-0 rounded-md object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1 px-1 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-200">
            <MessageSquareText className="h-3 w-3" />
            <span>علّق على منشورك</span>
          </div>
          {postText ? <p dir="auto" className="mt-0.5 line-clamp-2 text-[12px] font-bold text-slate-100">{postText}</p> : null}
          {postUrl ? (
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-200"
            >
              <ExternalLink className="h-3 w-3" />
              فتح البوست
            </a>
          ) : null}
        </div>
      </div>
      {commentText ? (
        <div className="border-t border-white/10 px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            <p dir="auto" className="min-w-0 text-[12.5px] leading-5 text-white">
              {commenter ? <span className="font-black text-slate-300">{commenter}: </span> : null}
              {commentText}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TranscriptMessage({
  row = null,
  variant = "desktop",
  onOpenCorrection,
  onReplyComment,
  onPrivateMessage,
  onReact,
  onEditMessage,
  reactionOptions = QUICK_MESSAGE_REACTIONS,
  channelLabel = "",
  channelKey = "",
  avatarUrl = "",
  customerName = "",
  showAvatar = true,
}) {
  const { t } = useTranslation();
  const safeRow = row || {};
  const message = safeRow.message || {};
  const cards = asArray(safeRow.cards);
  const media = useMemo(() => messageMediaGroups(message), [message]);
  const story = useMemo(() => messageStoryContext(message), [message]);
  const isVoiceTranscript = Boolean(message.voice_transcript);
  const bodyText = useMemo(() => {
    const rendered = media.images.length || media.videos.length || media.audios.length || media.documents.length;
    // A transcribed voice note stores the transcript as the message body, and the
    // player prints it under the waveform that produced it — printing it a second
    // time above the player is the same sentence twice.
    if (rendered && isVoiceTranscript && media.audios.length) return () => "";
    // With the attachment on screen the label is duplication. Without one — a dead
    // media URL, or a kind this bubble cannot render — it is the only thing that
    // says what arrived, so it stays exactly as the webhook wrote it.
    return (value) => (rendered && isGenericMediaBody(value) ? "" : value);
  }, [media, isVoiceTranscript]);
  const createdAt = safeRow.createdAt || absoluteTime(message.created_at);
  const isCommentMessage =
    safeRow.kind === "comment" ||
    clean(message.message_type).toLowerCase() === "comment_inbound" ||
    (clean(message.thread_kind).toLowerCase() === "comment" && ["customer", "user", "client"].includes(clean(message.sender_type).toLowerCase()));
  const commenterName = clean(message.commenter_name || message.customer_name || message.sender_name || message.from_name || message.author_name || "");
  const sourceComment = isCommentMessage ? null : sourceCommentContext(message);

  // The chrome the customer's own app would have used. The channel decides the
  // colours; nothing writes its name on the bubble any more.
  const platform = useMemo(() => resolveMessagePlatform(message, channelKey), [message, channelKey]);
  const chromeMode = chromeModeFor(variant, useContext(ThemeContext)?.theme?.mode);
  const chrome = useMemo(() => platformChrome(platform, chromeMode), [platform, chromeMode]);
  const compact = variant === "pwa";
  const side = safeRow.kind === "customer" || isCommentMessage ? "in" : "out";
  const align = side === "in" ? "left" : "right";
  const clock = bubbleClock(message.created_at);
  // Everything drawn inside a bubble follows the bubble's own ink, not the
  // page's: a link, a failure mark and a media player on a WhatsApp-light
  // outgoing bubble are all dark on mint, while the same three on Messenger's
  // blue stay white whichever theme the ERP is in.
  const darkInk = (side === "in" ? chrome.inboundInk : chrome.outboundInk) === "dark";
  const mediaTone = darkInk ? "onLight" : "onDark";
  const linkClass = darkInk ? chrome.linkDarkInk : chrome.linkLightInk;
  const dangerClass = darkInk ? "text-rose-600" : "text-rose-200";
  const failed = clean(message.delivery_status).toLowerCase() === "failed";
  const isInternalNote = clean(message.message_type).toLowerCase() === "internal_note";
  const showTicks = side === "out" && !isInternalNote && isTickableDeliveryStatus(message.delivery_status);
  const textClass = compact ? "text-[14px] leading-5.5" : "text-[14.5px] leading-6";

  const stampFor = (options = {}) => (
    <BubbleStamp
      chrome={chrome}
      side={side}
      time={clock}
      status={message.delivery_status}
      showTicks={showTicks}
      leading={failed ? <span className={`font-black ${dangerClass}`}>!</span> : options.leading || null}
      trailing={options.trailing || null}
      floating={Boolean(options.floating)}
    />
  );

  const attachments = (extraClass = "mt-1.5") => (
    <MessageMedia message={message} groups={media} tone={mediaTone} variant={variant} bare className={extraClass} />
  );

  // A photo or a clip with nothing written under it is the message. It fills the
  // bubble edge to edge and the stamp floats on top of it, exactly as it does on
  // the customer's screen — the framed tile inside a padded card is gone.
  const visualOnly = (kindText) =>
    !clean(kindText) &&
    !story &&
    !sourceComment &&
    Boolean(media.images.length || media.videos.length) &&
    !media.audios.length &&
    !media.documents.length;

  if (!safeRow.visible) return null;

  const shell = (children) => (
    <MessageActionShell
      row={safeRow}
      message={message}
      variant={variant}
      align={align}
      createdAt={createdAt}
      channelLabel={channelLabel}
      onReact={onReact}
      onEditMessage={onEditMessage}
      reactionOptions={reactionOptions}
    >
      {children}
    </MessageActionShell>
  );

  /* ── The product card ─────────────────────────────────────────────────────
   * On WhatsApp the card is the outgoing bubble; on Messenger and Instagram the
   * generic template is a white card on the conversation background with no
   * bubble behind it. `cardMode` carries that difference. */
  if (safeRow.kind === "product_card") {
    const standalone = chrome.cardMode === "standalone";
    return shell(
      <ChatRow side="out" align="right" variant={variant}>
        {standalone ? (
          <div data-ai-message-bubble="true" className="flex max-w-full flex-col items-end">
            <ProductCardMessage message={message} cards={cards} compact={compact} platform={platform} variant={variant} chrome={chrome} />
            <BubbleStamp chrome={chrome} side="out" time={clock} status={message.delivery_status} showTicks={showTicks} />
          </div>
        ) : (
          <ChatBubble chrome={chrome} side="out" className={chrome.cardWidth}>
            <ProductCardMessage message={message} cards={cards} compact={compact} platform={platform} variant={variant} chrome={chrome} />
            {stampFor()}
          </ChatBubble>
        )}
      </ChatRow>
    );
  }

  /* ── The customer ─────────────────────────────────────────────────────── */
  if (safeRow.kind === "customer") {
    const text = bodyText(message.customer_message);
    const flush = visualOnly(text);
    return shell(
      <ChatRow side="in" align="left" variant={variant} avatarUrl={avatarUrl} customerName={customerName} showAvatar={showAvatar}>
        <ChatBubble chrome={chrome} side="in" flush={flush}>
          {story ? <StoryContext story={story} variant={variant} /> : null}
          <LinkifiedText text={text} className={textClass} linkClassName={linkClass} />
          {attachments(flush ? "" : "mt-1.5")}
          {stampFor({ floating: flush })}
        </ChatBubble>
      </ChatRow>
    );
  }

  /* ── A comment under a post ───────────────────────────────────────────── */
  if (isCommentMessage) {
    const text = bodyText(message.customer_message || message.message_text || message.text || message.body);
    return shell(
      <ChatRow side="in" align="left" variant={variant} avatarUrl={avatarUrl} customerName={customerName || commenterName} showAvatar={showAvatar}>
        <ChatBubble chrome={chrome} side="in">
          {commenterName ? (
            <div dir="auto" className={`text-[12.5px] font-bold leading-4 ${chrome.cardAction}`}>{commenterName}</div>
          ) : null}
          <LinkifiedText text={text} className={`${textClass} ${commenterName ? "mt-0.5" : ""}`} linkClassName={linkClass} />
          {attachments()}
          {(message.comment_id && onReplyComment) || (message.commenter_id && onPrivateMessage) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.comment_id && onReplyComment ? (
                <button
                  type="button"
                  onClick={() => onReplyComment(message)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/[0.22] px-2.5 text-[11px] font-bold"
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  رد على التعليق
                </button>
              ) : null}
              {message.commenter_id && onPrivateMessage ? (
                <button
                  type="button"
                  onClick={() => onPrivateMessage(message)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/[0.22] px-2.5 text-[11px] font-bold"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  إرسال رسالة خاصة
                </button>
              ) : null}
            </div>
          ) : null}
          {stampFor()}
        </ChatBubble>
      </ChatRow>
    );
  }

  /* ── Our side: the assistant, an agent, or an automation ──────────────── */
  const isAi = safeRow.kind === "ai";
  const text = bodyText(isAi ? message.ai_answer : message.staff_message);
  const flush = visualOnly(text);
  const staffName = clean(message.staff_user_name);
  const authorLabel = isInternalNote
    ? "ملاحظة داخلية"
    : isAi
      ? (message.message_type === "comment_suggestion" ? t("aiSupport.inbox.message.draftReply") : "AI")
      : staffName && staffName !== "أنا"
        ? staffName
        : staffSenderLabel(message) === "النظام"
          ? "النظام"
          : "";
  const AuthorIcon = isAi ? Bot : isInternalNote ? Info : UserCheck;
  const correctReply = isAi && onOpenCorrection && message.message_type !== "comment_suggestion" ? (
    <button
      type="button"
      title={t("aiSupport.inbox.message.correctReply")}
      aria-label={t("aiSupport.inbox.message.correctReply")}
      onClick={(event) => {
        event.stopPropagation();
        onOpenCorrection(message);
      }}
      className="ms-0.5 grid h-4 w-4 place-items-center rounded-full opacity-70 transition hover:opacity-100"
    >
      <Sparkles className="h-3 w-3" />
    </button>
  ) : null;

  return shell(
    <ChatRow side="out" align="right" variant={variant}>
      <ChatBubble chrome={chrome} side="out" flush={flush} className={failed ? "ring-1 ring-rose-400/70" : ""}>
        {authorLabel ? (
          <div className={`flex items-center gap-1 text-[11.5px] font-bold leading-4 ${chrome.outboundMeta}`}>
            <AuthorIcon className="h-3 w-3" />
            {authorLabel}
          </div>
        ) : null}
        {sourceComment ? <div className={authorLabel ? "mt-1" : ""}><SourceCommentContext context={sourceComment} variant={variant} /></div> : null}
        <LinkifiedText text={text} className={`${textClass} ${authorLabel || sourceComment ? "mt-0.5" : ""}`} linkClassName={linkClass} />
        {isAi && message.suggested_products?.length ? (
          <div className="mt-2">
            <ProductCardMessage message={message} cards={message.suggested_products} compact platform={platform} variant={variant} chrome={chrome} />
          </div>
        ) : null}
        {/* visual_attachments already feed messageMediaGroups — rendering them
            separately here painted every AI image twice. */}
        {attachments(flush ? "" : "mt-1.5")}
        {failed && message.delivery_error ? (
          <p className={`mt-1 text-[11px] font-bold leading-4 ${dangerClass}`}>{message.delivery_error}</p>
        ) : null}
        {stampFor({ floating: flush, trailing: correctReply })}
      </ChatBubble>
    </ChatRow>
  );
}

export default memo(TranscriptMessage, (prev, next) => prev.row === next.row && prev.variant === next.variant && prev.onOpenCorrection === next.onOpenCorrection && prev.onReact === next.onReact && prev.onEditMessage === next.onEditMessage && prev.reactionOptions === next.reactionOptions && prev.channelLabel === next.channelLabel && prev.channelKey === next.channelKey && prev.avatarUrl === next.avatarUrl && prev.customerName === next.customerName && prev.showAvatar === next.showAvatar);

