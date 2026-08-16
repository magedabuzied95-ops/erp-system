import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The inbox renders customer avatars at 36-48px, which is far too small to actually see who
// you are talking to. Wrapping an avatar in <AvatarZoom> gives it a large preview: hover on a
// mouse, press-and-hold on touch. Works for every channel (WhatsApp, Messenger, Instagram,
// Telegram, comment threads) because it only takes the already-resolved avatar URL.

const HOVER_SIZE = 232;
const HOVER_DELAY_MS = 140;
const LONG_PRESS_MS = 420;
const EDGE_GAP = 12;

// Meta / Google avatar URLs carry the thumbnail size in the query string, and the inbox is
// handed a tiny crop. Ask the CDN for a big one; if that URL is rejected we fall back to the
// original in onError, so a signed URL that dislikes the rewrite still renders.
export const highResAvatarUrl = (raw) => {
  const url = String(raw || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    let changed = false;
    ["width", "height", "sz", "size"].forEach((key) => {
      const current = Number(parsed.searchParams.get(key));
      if (Number.isFinite(current) && current > 0 && current < 640) {
        parsed.searchParams.set(key, "640");
        changed = true;
      }
    });
    return changed ? parsed.toString() : "";
  } catch {
    return "";
  }
};

export default function AvatarZoom({ url, name = "", className = "", children }) {
  const anchorRef = useRef(null);
  const timerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [mode, setMode] = useState("");
  const [anchorRect, setAnchorRect] = useState(null);
  const [src, setSrc] = useState("");

  const avatar = String(url || "").trim();

  const close = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMode("");
    setAnchorRect(null);
  }, []);

  const open = useCallback(
    (nextMode) => {
      const node = anchorRef.current;
      if (!node || !avatar) return;
      setAnchorRect(node.getBoundingClientRect());
      setSrc(highResAvatarUrl(avatar) || avatar);
      setMode(nextMode);
    },
    [avatar]
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!mode) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [mode, close]);

  if (!avatar) return children;

  const handlePointerEnter = (event) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => open("hover"), HOVER_DELAY_MS);
  };

  const handlePointerDown = (event) => {
    if (event.pointerType === "mouse") return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // The press-and-hold already did something, so the tap must not also open the
      // conversation / Customer 360 underneath.
      suppressClickRef.current = true;
      open("press");
    }, LONG_PRESS_MS);
  };

  const handlePointerRelease = (event) => {
    // Only the long-press timer is cancellable here; a mouse fires pointermove constantly and
    // must not lose its pending hover preview.
    if (event && event.type === "pointermove" && event.pointerType === "mouse") return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const handleClickCapture = (event) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const hoverStyle = () => {
    if (!anchorRect || typeof window === "undefined") return { display: "none" };
    const cardHeight = HOVER_SIZE + (name ? 40 : 0);
    let left = anchorRect.right + EDGE_GAP;
    if (left + HOVER_SIZE + EDGE_GAP > window.innerWidth) left = anchorRect.left - HOVER_SIZE - EDGE_GAP;
    left = Math.max(EDGE_GAP, Math.min(left, window.innerWidth - HOVER_SIZE - EDGE_GAP));
    let top = anchorRect.top + anchorRect.height / 2 - cardHeight / 2;
    top = Math.max(EDGE_GAP, Math.min(top, window.innerHeight - cardHeight - EDGE_GAP));
    return { top, left, width: HOVER_SIZE };
  };

  const onImageError = (event) => {
    if (event.currentTarget.src !== avatar) event.currentTarget.src = avatar;
  };

  const preview =
    mode === "hover" ? (
      <div
        dir="ltr"
        style={{ position: "fixed", zIndex: 2147483000, pointerEvents: "none", ...hoverStyle() }}
        className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur"
      >
        <img
          src={src}
          alt={name || ""}
          onError={onImageError}
          decoding="async"
          style={{ height: HOVER_SIZE, width: HOVER_SIZE }}
          className="block object-cover"
        />
        {name ? <div className="truncate px-3 py-2 text-center text-[12px] font-semibold text-white">{name}</div> : null}
      </div>
    ) : mode === "press" ? (
      <div
        dir="ltr"
        role="presentation"
        onPointerDown={close}
        onClick={close}
        style={{ position: "fixed", inset: 0, zIndex: 2147483000 }}
        className="grid place-items-center bg-black/75 p-6 backdrop-blur-sm"
      >
        <div className="overflow-hidden rounded-3xl border border-white/15 bg-slate-950/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
          <img
            src={src}
            alt={name || ""}
            onError={onImageError}
            decoding="async"
            style={{ height: "min(78vw, 360px)", width: "min(78vw, 360px)" }}
            className="block object-cover"
          />
          {name ? <div className="truncate px-4 py-3 text-center text-[13px] font-semibold text-white">{name}</div> : null}
        </div>
      </div>
    ) : null;

  return (
    <>
      <span
        ref={anchorRef}
        className={`relative inline-flex shrink-0 ${className}`.trim()}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={close}
        onPointerCancel={close}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerRelease}
        onPointerMove={handlePointerRelease}
        onClickCapture={handleClickCapture}
      >
        {children}
      </span>
      {preview && typeof document !== "undefined" ? createPortal(preview, document.body) : null}
    </>
  );
}
