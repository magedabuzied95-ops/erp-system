import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { isPortalChatImageMessage, portalChatAttachmentUrl } from "./portalChatUtils";

/*
 * Full-screen image viewer over the conversation's images: ← → (keys, buttons,
 * swipe), tap to zoom, thumbnail strip, download, sender + time caption.
 * Always dark — it sits over a black ground in both themes.
 */
export default function ChatMediaViewer({ open, messages = [], initialUrl = "", onClose, senderLabel = () => "", timeFormatter = (value) => value || "" }) {
  const { t, i18n } = useTranslation();
  const images = useMemo(() => messages.filter((message) => isPortalChatImageMessage(message) && !message.deleted_at).map((message) => ({ message, url: portalChatAttachmentUrl(message) })).filter((item) => item.url), [messages]);
  const initialIndex = Math.max(0, images.findIndex((item) => item.url === initialUrl));
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const swipeRef = useRef({ x: 0, y: 0, active: false });
  const stripRef = useRef(null);

  useEffect(() => { if (open) { setIndex(initialIndex); setZoomed(false); } }, [open, initialIndex]);
  const step = useCallback((delta) => {
    if (!images.length) return;
    setZoomed(false);
    setIndex((current) => (current + delta + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowRight") step(i18n.dir() === "rtl" ? -1 : 1);
      if (event.key === "ArrowLeft") step(i18n.dir() === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [open, onClose, step, i18n]);

  useEffect(() => {
    stripRef.current?.children?.[index]?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (!open || typeof document === "undefined") return null;
  const current = images[index] || (initialUrl ? { url: initialUrl, message: null } : null);
  if (!current) return null;

  const onTouchStart = (event) => { const touch = event.touches[0]; swipeRef.current = { x: touch.clientX, y: touch.clientY, active: true }; };
  const onTouchEnd = (event) => {
    if (!swipeRef.current.active || zoomed) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeRef.current.x;
    const dy = Math.abs(touch.clientY - swipeRef.current.y);
    swipeRef.current.active = false;
    if (Math.abs(dx) > 48 && dy < 60) step(dx < 0 ? 1 : -1);
    else if (dy > 120 && Math.abs(dx) < 60) onClose?.();
  };

  const iconButton = "grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20";
  return createPortal(
    <div className="fixed inset-0 z-[150] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true" dir={i18n.dir()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div className="min-w-0">
          <div className="truncate text-sm font-black" dir="auto">{current.message ? senderLabel(current.message) : ""}</div>
          <div className="text-[11px] font-semibold text-white/70" dir="ltr">{current.message ? timeFormatter(current.message.created_at) : ""}{images.length > 1 ? ` · ${index + 1}/${images.length}` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setZoomed((value) => !value)} className={iconButton} aria-label={zoomed ? t("common.zoomOut") : t("common.zoomIn")}>{zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}</button>
          <a href={current.url} download target="_blank" rel="noreferrer" className={iconButton} aria-label={t("common.download")}><Download className="h-5 w-5" /></a>
          <button type="button" onClick={onClose} className={iconButton} aria-label={t("common.close")}><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {images.length > 1 ? (
          <>
            <button type="button" onClick={() => step(-1)} className={`${iconButton} absolute start-3 top-1/2 z-10 -translate-y-1/2 max-md:hidden`} aria-label={t("common.previous")}><ChevronLeft className="h-6 w-6 rtl:-scale-x-100" /></button>
            <button type="button" onClick={() => step(1)} className={`${iconButton} absolute end-3 top-1/2 z-10 -translate-y-1/2 max-md:hidden`} aria-label={t("common.next")}><ChevronRight className="h-6 w-6 rtl:-scale-x-100" /></button>
          </>
        ) : null}
        <img
          src={current.url}
          alt=""
          onClick={() => setZoomed((value) => !value)}
          className={`select-none transition-transform duration-200 ${zoomed ? "max-h-none max-w-none cursor-zoom-out scale-[1.8]" : "max-h-full max-w-full cursor-zoom-in object-contain"}`}
          draggable={false}
        />
      </div>
      {images.length > 1 ? (
        <div ref={stripRef} className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2" dir="ltr">
          {images.map((item, itemIndex) => (
            <button key={`${item.url}-${itemIndex}`} type="button" onClick={() => { setIndex(itemIndex); setZoomed(false); }} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${itemIndex === index ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}>
              <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body
  );
}
