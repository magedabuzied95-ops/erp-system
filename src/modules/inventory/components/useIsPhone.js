import { useSyncExternalStore } from "react";

/* True below md (< 768px), the catalog phone layout breakpoint. Synchronous on
   first render, so a phone never paints the desktop layout first. */
const PHONE_QUERY = "(max-width: 767px)";

function subscribe(callback) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener?.("change", callback);
  return () => query.removeEventListener?.("change", callback);
}

function getSnapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(PHONE_QUERY).matches;
}

export default function useIsPhone() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
