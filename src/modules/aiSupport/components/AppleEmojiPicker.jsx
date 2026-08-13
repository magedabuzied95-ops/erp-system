import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import EmojiPicker, { Emoji, EmojiStyle, Theme } from "emoji-picker-react";

import { useTheme } from "../../../theme/useTheme";

export const emojiToUnified = (emoji = "") =>
  Array.from(String(emoji || ""))
    .map((part) => part.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join("-");

export function AppleEmoji({ emoji = "", size = 24, className = "", title = "" }) {
  const unified = emojiToUnified(emoji);
  if (!unified) return null;
  return (
    <span className={`inline-grid shrink-0 place-items-center align-middle leading-none ${className}`} aria-label={emoji} title={title || emoji} role="img">
      <Emoji unified={unified} emojiStyle={EmojiStyle.APPLE} size={size} lazyLoad />
    </span>
  );
}

export function AppleEmojiPicker({ open = false, anchorRef, onClose, onSelect, title = "" }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const pickerRef = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 350, height: 390 });

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const updatePosition = () => {
      const anchor = anchorRef?.current?.getBoundingClientRect?.();
      const width = Math.max(280, Math.min(350, window.innerWidth - 16));
      const height = Math.max(320, Math.min(420, window.innerHeight - 24));
      if (!anchor) {
        setPosition({ left: Math.max(8, (window.innerWidth - width) / 2), top: Math.max(8, (window.innerHeight - height) / 2), width, height });
        return;
      }
      const left = Math.min(Math.max(8, anchor.right - width), Math.max(8, window.innerWidth - width - 8));
      const preferredTop = anchor.top - height - 10;
      const top = preferredTop >= 8 ? preferredTop : Math.min(anchor.bottom + 10, Math.max(8, window.innerHeight - height - 8));
      setPosition({ left, top, width, height });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (pickerRef.current?.contains(event.target) || anchorRef?.current?.contains?.(event.target)) return;
      onClose?.();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={pickerRef}
      role="dialog"
      aria-label={title || t("aiSupport.inbox.emoji.choose")}
      data-ai-inbox-apple-emoji-picker="true"
      className="fixed z-[2147483000] overflow-hidden rounded-[22px] border border-black/10 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.3)] dark:border-white/10 dark:bg-[#20231f]"
      style={{ left: position.left, top: position.top }}
    >
      <EmojiPicker
        open
        width={position.width}
        height={position.height}
        emojiStyle={EmojiStyle.APPLE}
        theme={theme?.mode === "dark" ? Theme.DARK : Theme.LIGHT}
        lazyLoadEmojis
        searchPlaceHolder={t("aiSupport.inbox.emoji.search")}
        previewConfig={{ showPreview: false }}
        onEmojiClick={(emojiData) => onSelect?.(emojiData.emoji, emojiData)}
      />
    </div>,
    document.body
  );
}
