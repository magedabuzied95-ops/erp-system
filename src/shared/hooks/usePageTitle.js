import { useEffect } from "react";

const DEFAULT_PREFIX = "M1";

export const buildPageTitle = (title) => {
  const value = String(title || "").trim();
  if (!value) return DEFAULT_PREFIX;
  if (value.startsWith("M1")) return value;
  return `M1 - ${value}`;
};

export default function usePageTitle(title) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousTitle = document.title;
    document.title = buildPageTitle(title);

    return () => {
      document.title = previousTitle || DEFAULT_PREFIX;
    };
  }, [title]);
}
