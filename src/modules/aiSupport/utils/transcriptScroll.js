/*
 * Pinning a transcript to its newest message is not one assignment.
 *
 * Opening a conversation used to do exactly one thing: inside a single
 * requestAnimationFrame, `scroller.scrollTop = scroller.scrollHeight`. That is
 * correct only if the transcript has already reached its final height in that
 * frame — and it never has. A chat bubble carrying a photo renders an <img>
 * with `loading="lazy" decoding="async"` and no intrinsic size, so it measures
 * a few pixels until the bitmap decodes and then expands to as much as 380px;
 * product cards, the origin-post card, avatars, reels and the Arabic web font
 * all settle a frame or more later too. Every pixel they add lands ABOVE the
 * viewport, and a scroller parked at the old bottom keeps its scrollTop — so it
 * drifts upwards by the total growth and the operator lands in the MIDDLE of
 * the thread.
 *
 * So the pin is held, not fired once: re-applied while the content keeps
 * growing (ResizeObserver + the media `load` events, which do not bubble but do
 * capture), and released the instant the operator takes the scroll over or the
 * settle window ends — whichever comes first. Holding it any other way (a
 * blind interval, say) would fight the operator's own wheel.
 */

// The gestures that mean "I am driving now" — a `scroll` event cannot serve as
// this signal, because the hold below fires it itself.
const TAKEOVER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

export const NEAR_BOTTOM_THRESHOLD_PX = 140;

export function isScrollerNearBottom(scroller, threshold = NEAR_BOTTOM_THRESHOLD_PX) {
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= threshold;
}

/**
 * Jump to the bottom and hold it there while late content settles.
 *
 * @param {HTMLElement|null} scroller the transcript's scroll container
 * @param {object}  [options]
 * @param {number}  [options.settleMs=2200] how long the pin may keep re-applying
 * @param {boolean} [options.smooth=false]  animate the first jump (the "back to latest" button)
 * @param {Function}[options.onPinned]      called after every re-pin (to resync proximity state)
 * @returns {Function} release — cancels the hold early
 */
export function pinScrollerToBottom(scroller, { settleMs = 2200, smooth = false, onPinned } = {}) {
  if (!scroller) return () => {};

  let released = false;
  let observer = null;
  let timer = 0;
  let frame = 0;

  const jump = () => {
    if (released || !scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    onPinned?.(scroller);
  };

  // The operator's own scroll wins over the hold, always. `scroll` itself is
  // useless as a signal here — our own jumps fire it — so the release listens
  // for the gestures a human makes.
  const release = () => {
    if (released) return;
    released = true;
    if (observer) observer.disconnect();
    if (timer) window.clearTimeout(timer);
    if (frame) window.cancelAnimationFrame(frame);
    scroller.removeEventListener("load", jump, true);
    TAKEOVER_EVENTS.forEach((event) => scroller.removeEventListener(event, release));
  };

  if (smooth && typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    onPinned?.(scroller);
  } else {
    jump();
  }

  TAKEOVER_EVENTS.forEach((event) => scroller.addEventListener(event, release, { passive: true }));
  // A photo finishing its decode does not bubble a `load`, but it does capture.
  scroller.addEventListener("load", jump, true);

  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      // A grown bubble moves the bottom away; re-pin on the next frame so the
      // observer is not re-entered by our own write.
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        jump();
      });
    });
    // The scroller's own box never changes; its content's does.
    Array.from(scroller.children).forEach((child) => observer.observe(child));
    if (!scroller.children.length) observer.observe(scroller);
  }

  timer = window.setTimeout(release, Math.max(0, settleMs));

  return release;
}
