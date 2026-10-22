import { useEffect, useState } from "react";

// True below the `md` breakpoint (768px), tracked live. Used where a phone
// layout moves controls (e.g. filters into a bottom sheet) rather than only
// restyling them, so the same control is never mounted twice.
const QUERY = "(max-width: 767px)";

export default function usePhoneViewport() {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(QUERY);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return isPhone;
}
