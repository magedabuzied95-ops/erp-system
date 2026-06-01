import { useEffect, useState } from "react";

const readViewportHeight = () => {
  if (typeof window === "undefined") return 0;
  return Math.round(window.innerHeight || 0);
};

export function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState(readViewportHeight);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let frame = 0;
    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setViewportHeight(readViewportHeight());
      });
    };

    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return { viewportHeight };
}

export default useViewportHeight;
