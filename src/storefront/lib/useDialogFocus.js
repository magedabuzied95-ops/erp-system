import { useEffect, useRef } from "react";
import { DIALOG_FOCUSABLE_SELECTOR, nextDialogFocusIndex } from "./dialogFocus.js";

// A drawer can open in the same commit that mounts it (the cart bag mounts one
// render later), so the first focus waits a few frames for the panel to exist.
const INITIAL_FOCUS_FRAMES = 10;

const modalRootOf = (node) => (node && typeof node.closest === "function" ? node.closest("[aria-modal=\"true\"]") : null);

const tabbablesIn = (container) =>
  Array.from(container.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && element.getClientRects().length > 0
  );

const focusQuietly = (element) => {
  if (element && typeof element.focus === "function") element.focus({ preventScroll: true });
};

/**
 * Modal focus for a storefront drawer or sheet: while `open`, focus moves into
 * `containerRef` (the `initialFocusRef` element, else its first tabbable), Tab
 * and Shift+Tab wrap inside it, Escape calls `onClose`, and on close focus goes
 * back to `returnFocusRef` or to whatever held it before the dialog opened.
 *
 * A dialog stacked on top (the size guide over the bag) owns the keyboard: keys
 * pressed while focus sits in a different aria-modal root are left alone.
 */
export function useDialogFocus(open, containerRef, { onClose, initialFocusRef = null, returnFocusRef = null } = {}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === "undefined" || typeof window === "undefined") return undefined;
    const previous = document.activeElement;
    let frame = 0;
    let attempts = 0;

    const focusInitial = () => {
      frame = 0;
      const container = containerRef.current;
      if (!container) {
        attempts += 1;
        if (attempts < INITIAL_FOCUS_FRAMES) frame = window.requestAnimationFrame(focusInitial);
        return;
      }
      if (container.contains(document.activeElement)) return;
      const target = initialFocusRef?.current || tabbablesIn(container)[0];
      if (target) {
        focusQuietly(target);
      } else {
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        focusQuietly(container);
      }
    };
    frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event) => {
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      const activeRoot = modalRootOf(active);
      if (!container.contains(active) && activeRoot && activeRoot !== modalRootOf(container)) return;

      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const tabbables = tabbablesIn(container);
      const next = nextDialogFocusIndex({ count: tabbables.length, currentIndex: tabbables.indexOf(active), shift: event.shiftKey });
      if (next === -1) return;
      event.preventDefault();
      if (next === -2) {
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        focusQuietly(container);
        return;
      }
      focusQuietly(tabbables[next]);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      // Only hand focus back when it is still in the dialog or was dropped on
      // <body> by the unmount — never pull it away from somewhere the shopper moved it.
      // The refs are read live on purpose: a closed drawer may already be unmounted.
      const active = document.activeElement;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const container = containerRef.current;
      const stranded = !active || active === document.body || Boolean(container && container.contains(active));
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = returnFocusRef?.current || previous;
      if (stranded && target && target !== document.body && target.isConnected) focusQuietly(target);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useDialogFocus;
