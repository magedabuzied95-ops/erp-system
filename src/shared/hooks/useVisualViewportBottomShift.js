import { useEffect, useState } from "react";

// A keyboard this tall or taller is open; below it the gap is browser chrome.
const KEYBOARD_MIN_PX = 150;

export const measureShift = () => {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  // Pinch-zoom moves the visual viewport on purpose; the bar should stay put.
  if (Math.abs((viewport.scale || 1) - 1) > 0.01) return 0;
  const layoutHeight = window.innerHeight || 0;
  // The keyboard is up: leave the bar where the browser puts it, under the keyboard.
  if (layoutHeight - viewport.height > KEYBOARD_MIN_PX) return 0;
  const shift = Math.round(viewport.offsetTop + viewport.height - layoutHeight);
  return Math.abs(shift) > 1 ? shift : 0;
};

/**
 * How far a `position: fixed; bottom: …` bar must move down to sit on the bottom
 * of the screen the person actually sees.
 *
 * iPhone WebKit can leave the layout viewport offset from the visual one — most
 * often after the keyboard closes, then again as the page scrolls up — and every
 * bottom-anchored fixed element floats mid-screen over the content. The CSS is
 * right; the viewport is not. This reads the gap from `visualViewport` and is 0
 * everywhere the two agree, which is every desktop and every healthy phone.
 */
export default function useVisualViewportBottomShift() {
  const [shift, setShift] = useState(measureShift);

  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!viewport) return undefined;
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setShift(measureShift()));
    };
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("focusout", sync);
    sync();
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("focusout", sync);
    };
  }, []);

  return shift;
}
