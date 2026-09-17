import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Forward, Loader2, Search, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import CustomerAvatar from "./CustomerAvatar.jsx";
import { attachmentKindOf, namedAttachmentFile } from "../utils/outboundAttachment.js";
import {
  clipboardReadPermission,
  imageFingerprint,
  readClipboardImage,
  rememberImageSeen,
  wasImageSeen,
} from "../utils/clipboardImage.js";

/*
 * The Messenger "recent screenshot" card, for the inbox composer.
 *
 * A picture reaches it three ways — the clipboard noticed on its own, the
 * clipboard read on a tap, or a paste/drop into the composer — and in every
 * case it waits as a floating preview with send, dismiss and forward, instead
 * of being sent the instant it lands. A paste used to go straight to the
 * customer, with no chance to see WHICH image was on the clipboard.
 */
export function useQuickMedia({ enabled = true } = {}) {
  const [media, setMedia] = useState(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const readingRef = useRef(false);

  useEffect(() => () => {
    if (media?.url) URL.revokeObjectURL(media.url);
  }, [media]);

  const offer = useCallback(async (rawFile, source = "paste") => {
    const file = namedAttachmentFile(rawFile);
    if (!file || !attachmentKindOf(file)) return false;
    const fingerprint = await imageFingerprint(file);
    // Whatever the operator has seen once is not offered again by the
    // clipboard watcher; an explicit paste always shows.
    if (source === "clipboard" && wasImageSeen(fingerprint)) return false;
    rememberImageSeen(fingerprint);
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      url = "";
    }
    setMedia({ file, url, source, fingerprint, kind: attachmentKindOf(file) });
    return true;
  }, []);

  /* "offered" | "seen" | "empty" — the tap path needs to say something when nothing is there. */
  const checkClipboard = useCallback(async ({ manual = false } = {}) => {
    if (!enabledRef.current || readingRef.current) return "empty";
    readingRef.current = true;
    try {
      const file = await readClipboardImage();
      if (!file) return "empty";
      if (manual) return (await offer(file, "paste")) ? "offered" : "empty";
      return (await offer(file, "clipboard")) ? "offered" : "seen";
    } finally {
      readingRef.current = false;
    }
  }, [offer]);

  // Silent reads only where the browser allows them without a prompt.
  const autoCheck = useCallback(async () => {
    if (!enabledRef.current || document.visibilityState !== "visible") return;
    if ((await clipboardReadPermission()) !== "granted") return;
    await checkClipboard();
  }, [checkClipboard]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void autoCheck();
    };
    const onFocus = () => void autoCheck();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    void autoCheck();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoCheck, enabled]);

  const dismiss = useCallback(() => setMedia(null), []);

  return { media, offer, checkClipboard, autoCheck, dismiss };
}

export function QuickMediaCard({ media, busy = false, onSend, onForward, onDismiss, className = "" }) {
  const { t } = useTranslation();
  if (!media?.file) return null;
  const label = media.source === "clipboard"
    ? t("aiSupport.inbox.composer.quickMedia.fromClipboard")
    : t("aiSupport.inbox.composer.quickMedia.ready");
  return (
    <div
      data-ai-inbox-quick-media="true"
      className={`pointer-events-auto flex items-end gap-2 ${className}`}
    >
      {onForward ? (
        <button
          type="button"
          onClick={onForward}
          disabled={busy}
          title={t("aiSupport.inbox.composer.quickMedia.forward")}
          aria-label={t("aiSupport.inbox.composer.quickMedia.forward")}
          className="mb-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200/90 text-slate-700 shadow-sm transition hover:bg-slate-300 disabled:opacity-50 dark:bg-white/15 dark:text-slate-100 dark:hover:bg-white/25"
        >
          <Forward className="h-4 w-4" />
        </button>
      ) : null}
      <div className="relative w-36 rounded-[20px] border border-slate-200 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-[#23262b]">
        <div className="overflow-hidden rounded-2xl bg-slate-100 dark:bg-black/30">
          {media.kind === "video" ? (
            <video src={media.url} muted playsInline preload="metadata" className="block max-h-52 w-full object-cover" />
          ) : (
            <img src={media.url} alt={label} className="block max-h-52 w-full object-cover" />
          )}
        </div>
        <p className="truncate pb-0.5 pl-1 pr-7 pt-1 text-center text-[10px] font-bold text-slate-500 dark:text-slate-400">{label}</p>
        <button
          type="button"
          onClick={onDismiss}
          title={t("aiSupport.inbox.composer.quickMedia.dismiss")}
          aria-label={t("aiSupport.inbox.composer.quickMedia.dismiss")}
          className="absolute -left-2.5 -top-2.5 grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-md transition hover:bg-slate-100 dark:border-white/15 dark:bg-[#34373d] dark:text-slate-100"
        >
          <X className="h-4 w-4" strokeWidth={2.6} />
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          title={t("aiSupport.inbox.composer.quickMedia.send")}
          aria-label={t("aiSupport.inbox.composer.quickMedia.send")}
          className="absolute -bottom-3 -right-3 grid h-11 w-11 place-items-center rounded-full bg-blue-600 text-white shadow-lg ring-4 ring-white transition hover:bg-blue-700 disabled:opacity-60 dark:ring-[#20231f]"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

/* Pick the conversation a picture should be forwarded to. */
export function ForwardConversationSheet({ open, items = [], onPick, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? items.filter((item) => `${item.name} ${item.subtitle || ""}`.toLowerCase().includes(needle))
      : items;
    return matched.slice(0, 80);
  }, [items, query]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("aiSupport.inbox.composer.quickMedia.forwardTitle")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-3xl dark:bg-[#1c1f1c]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-black text-slate-900 dark:text-slate-100">{t("aiSupport.inbox.composer.quickMedia.forwardTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiSupport.inbox.composer.quickMedia.dismiss")}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-2">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 dark:border-white/10 dark:bg-white/5">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("aiSupport.inbox.composer.quickMedia.forwardSearch")}
              className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm dark:text-slate-100"
            />
          </label>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {visible.length ? visible.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onPick?.(item)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start transition hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <CustomerAvatar
                  url={item.avatarUrl}
                  name={item.name}
                  className="h-10 w-10 shrink-0 overflow-hidden rounded-full"
                  imgClassName="object-cover"
                  fallbackClassName="bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-200"
                  iconClassName="h-4 w-4"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{item.name}</span>
                  {item.subtitle ? <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</span> : null}
                </span>
                <Send className="h-4 w-4 shrink-0 text-blue-600" />
              </button>
            </li>
          )) : (
            <li className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t("aiSupport.inbox.composer.quickMedia.forwardEmpty")}</li>
          )}
        </ul>
      </div>
    </div>,
    document.body
  );
}
