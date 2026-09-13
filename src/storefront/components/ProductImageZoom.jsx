import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { sfText } from "../lib/sfText";
import "./productImageZoom.css";

/*
 * Full-screen product photo viewer.
 *
 * Opened from the product page gallery. The photo is the original upload (no
 * srcset — the point is detail), and on a phone it zooms the way the photos app
 * does: pinch, double-tap, drag to pan while zoomed. At normal size a sideways
 * swipe moves between photos and a downward swipe closes. With a mouse a click
 * zooms to the point clicked and a drag pans.
 *
 * The transform is written straight onto the image element from pointer events;
 * routing every move through React state re-rendered the whole viewer per frame.
 */

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
const SWIPE_PX = 50;
const CLOSE_SWIPE_PX = 110;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function ProductImageZoom({ open, items = [], index = 0, title = "", imageFor, fallbackProductImage, onIndexChange, onClose }) {
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const closeRef = useRef(null);
  const thumbsRef = useRef(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef({ pointers: new Map(), start: null, lastTap: null, swipe: null });
  const total = items.length;

  useEffect(() => {
    if (open) setCurrent(clamp(index, 0, Math.max(0, total - 1)));
  }, [index, open, total]);

  const paint = useCallback((animate = false) => {
    const image = imageRef.current;
    if (!image) return;
    const { scale, x, y } = view.current;
    image.style.transition = animate ? "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    image.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    const nextZoomed = scale > 1.01;
    if (nextZoomed !== zoomedRef.current) {
      zoomedRef.current = nextZoomed;
      setZoomed(nextZoomed);
    }
  }, []);

  // How far the zoomed photo may travel before an edge comes away from the
  // screen edge. object-fit: contain paints the photo smaller than its box, so
  // the painted size comes from the natural aspect, not from the element.
  const bounds = useCallback((scale) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return { x: 0, y: 0 };
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const naturalWidth = image.naturalWidth || width;
    const naturalHeight = image.naturalHeight || height;
    const fit = Math.min(width / naturalWidth, height / naturalHeight);
    return {
      x: Math.max(0, (naturalWidth * fit * scale - width) / 2),
      y: Math.max(0, (naturalHeight * fit * scale - height) / 2),
    };
  }, []);

  const setView = useCallback((scale, x, y, animate = false) => {
    const nextScale = clamp(scale, 1, MAX_SCALE);
    const limit = bounds(nextScale);
    view.current = { scale: nextScale, x: clamp(x, -limit.x, limit.x), y: clamp(y, -limit.y, limit.y) };
    paint(animate);
  }, [bounds, paint]);

  const reset = useCallback((animate = false) => setView(1, 0, 0, animate), [setView]);

  // A point on screen, relative to the centre of the stage — the transform origin.
  const toStage = (clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  // Zooming keeps the photo point under the finger (or cursor) in place.
  const zoomAt = (point, nextScale, animate) => {
    const { scale, x, y } = view.current;
    const ratio = clamp(nextScale, 1, MAX_SCALE) / scale;
    setView(nextScale, point.x - (point.x - x) * ratio, point.y - (point.y - y) * ratio, animate);
  };

  // The page gallery follows along, so closing the viewer leaves the same photo up.
  const show = useCallback((next) => {
    setCurrent(next);
    onIndexChange?.(items[next], next);
  }, [items, onIndexChange]);
  const go = useCallback((step) => {
    if (total < 2) return;
    show((current + step + total) % total);
  }, [current, show, total]);
  const handlers = useRef({ go, onClose });
  handlers.current = { go, onClose };
  const isRtl = () => document.documentElement.dir === "rtl" || (stageRef.current && getComputedStyle(stageRef.current).direction === "rtl");

  useLayoutEffect(() => {
    if (!open) return;
    gesture.current.pointers.clear();
    gesture.current.lastTap = null;
    reset(false);
    thumbsRef.current?.querySelector(`[data-zoom-index="${current}"]`)?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [current, open, reset]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    // Through refs, so moving between photos does not tear this down and bounce
    // the focus back to the page and in again.
    const onKey = (event) => {
      if (event.key === "Escape") handlers.current.onClose?.();
      else if (event.key === "ArrowRight") handlers.current.go(isRtl() ? -1 : 1);
      else if (event.key === "ArrowLeft") handlers.current.go(isRtl() ? 1 : -1);
    };
    const onResize = () => reset(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [open, reset]);

  const onPointerDown = (event) => {
    const state = gesture.current;
    try {
      stageRef.current.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks cannot be captured; the gesture still works.
    }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...state.pointers.values()];
    if (points.length === 2) {
      const [a, b] = points;
      state.start = {
        pinch: true,
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: toStage((a.x + b.x) / 2, (a.y + b.y) / 2),
        ...view.current,
      };
      state.swipe = null;
    } else if (points.length === 1) {
      state.start = { pinch: false, clientX: event.clientX, clientY: event.clientY, moved: false, ...view.current };
      state.swipe = view.current.scale <= 1.01 ? { dx: 0, dy: 0 } : null;
    }
  };

  const onPointerMove = (event) => {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId) || !state.start) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...state.pointers.values()];
    const start = state.start;
    if (points.length >= 2 && start.pinch) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
      const nextScale = clamp(start.scale * (distance / start.distance), 1, MAX_SCALE);
      const ratio = nextScale / start.scale;
      // The pinch centre stays under the fingers and follows them as they move.
      setView(nextScale, mid.x - (start.mid.x - start.x) * ratio, mid.y - (start.mid.y - start.y) * ratio);
      return;
    }
    if (points.length !== 1 || start.pinch) return;
    const dx = event.clientX - start.clientX;
    const dy = event.clientY - start.clientY;
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) start.moved = true;
    if (state.swipe) {
      state.swipe = { dx, dy };
      const image = imageRef.current;
      if (image && start.moved) {
        // Follow the finger a little so the swipe feels attached to the photo.
        const pull = Math.abs(dx) > Math.abs(dy) ? `translate3d(${dx * 0.6}px, 0, 0)` : `translate3d(0, ${Math.max(0, dy) * 0.6}px, 0)`;
        image.style.transition = "none";
        image.style.transform = pull;
      }
      return;
    }
    setView(start.scale, start.x + dx, start.y + dy);
  };

  const onPointerUp = (event) => {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    const start = state.start;
    if (state.pointers.size === 1 && start?.pinch) {
      // One finger lifted from a pinch: the other carries on as a pan from here.
      const [remaining] = [...state.pointers.values()];
      state.start = { pinch: false, clientX: remaining.x, clientY: remaining.y, moved: true, ...view.current };
      state.swipe = null;
      return;
    }
    if (state.pointers.size > 0 || !start) return;
    state.start = null;

    if (state.swipe && start.moved) {
      const { dx, dy } = state.swipe;
      state.swipe = null;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        // Swiping the photo towards the start edge brings the next one in.
        go((dx < 0) !== isRtl() ? 1 : -1);
        return;
      }
      if (dy > CLOSE_SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
        onClose?.();
        return;
      }
      reset(true);
      return;
    }
    state.swipe = null;
    if (start.moved) return;

    const point = toStage(event.clientX, event.clientY);
    const zoomIn = view.current.scale <= 1.01;
    if (event.pointerType === "mouse") {
      zoomAt(point, zoomIn ? DOUBLE_TAP_SCALE : 1, true);
      return;
    }
    const now = Date.now();
    const last = state.lastTap;
    if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(point.x - last.x, point.y - last.y) < 40) {
      state.lastTap = null;
      zoomAt(point, zoomIn ? DOUBLE_TAP_SCALE : 1, true);
    } else {
      state.lastTap = { at: now, ...point };
    }
  };

  const onWheel = (event) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 1) return;
    const point = toStage(event.clientX, event.clientY);
    zoomAt(point, view.current.scale * Math.exp(-event.deltaY * 0.002), false);
  };

  if (!open || !total || typeof document === "undefined") return null;
  const item = items[current] || items[0];
  const src = imageFor(item?.image || item);

  return createPortal(
    <div className="sfz" role="dialog" aria-modal="true" aria-label={sfText("storefront.products.imageViewer", "Product photos")}>
      <div className="sfz__bar">
        <span className="sfz__count" dir="ltr">
          {total > 1 ? sfText("storefront.products.imageCount", "{{current}} of {{total}}", { current: current + 1, total }) : ""}
        </span>
        <button ref={closeRef} type="button" className="sfz__icon" onClick={onClose} aria-label={sfText("storefront.common.close", "Close")}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={stageRef}
        className={`sfz__stage${zoomed ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img
          key={src}
          ref={imageRef}
          src={src}
          alt={title}
          onError={fallbackProductImage}
          onLoad={() => reset(false)}
          className="sfz__img"
          draggable={false}
          decoding="async"
        />
        {!zoomed ? <p className="sfz__hint">{sfText("storefront.products.zoomHint", "Pinch or double-tap to zoom")}</p> : null}
      </div>

      {total > 1 ? (
        <>
          <button type="button" className="sfz__nav sfz__nav--prev" onClick={() => go(-1)} aria-label={sfText("storefront.products.previousImage", "Previous image")}>
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
          </button>
          <button type="button" className="sfz__nav sfz__nav--next" onClick={() => go(1)} aria-label={sfText("storefront.products.nextImage", "Next image")}>
            <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
          </button>
          <div ref={thumbsRef} className="sfz__thumbs">
            {items.map((thumb, thumbIndex) => (
              <button
                key={`${thumb?.image || thumb}-${thumbIndex}`}
                type="button"
                data-zoom-index={thumbIndex}
                className={`sfz__thumb${thumbIndex === current ? " is-active" : ""}`}
                aria-current={thumbIndex === current}
                onClick={() => show(thumbIndex)}
              >
                <img src={imageFor(thumb?.image || thumb)} alt="" loading="lazy" decoding="async" onError={fallbackProductImage} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>,
    document.body
  );
}
