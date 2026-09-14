import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Loader2 } from "lucide-react";

// The floating "back to top" pill, built to the specification of the button on
// m1store-eg.com: a 40x60 pill pinned to the bottom-left corner, hidden until the
// page has scrolled past 300px, then sliding up into place over 500ms.
//
// The one thing not copied from there is the colour: that site paints the pill in
// its own teal, while this one paints from the storefront's `--m1h-accent` token
// (declared on body.storefront-shell, where this is portalled), so a Site Studio
// palette change moves the button with the rest of the site. The `accent` prop is
// only the fallback for that token and the input to the icon-contrast choice.
const SHOW_AFTER_PX = 300;
const FALLBACK_ACCENT = "#a47a12";

// 30px from the corner as on the reference site, plus the phone's home-indicator
// inset so it is 30px of visible page on iOS too. The storefront's own floating
// button (WhatsApp) sits in the opposite corner, so nothing collides here.
const RESTING_BOTTOM = "calc(30px + env(safe-area-inset-bottom, 0px))";
const LIFTED_BOTTOM = "calc(40px + env(safe-area-inset-bottom, 0px))";

// Icons are drawn in whichever of black/white the accent can actually carry, so
// an owner who picks a pale colour in Site Studio does not end up with white
// glyphs on cream. Anything this cannot parse (a named colour, a gradient) keeps
// the light ink the reference site uses. Both inks are contract tokens.
const LIGHT_ICON = "var(--sfx-media-ink)";
const DARK_ICON = "var(--sfx-on-accent)";
const readableIconColor = (accent) => {
  const value = String(accent || "").trim();
  let r;
  let g;
  let b;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    r = parseInt(digits.slice(0, 2), 16);
    g = parseInt(digits.slice(2, 4), 16);
    b = parseInt(digits.slice(4, 6), 16);
  } else {
    const rgb = value.match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
    if (!rgb) return LIGHT_ICON;
    [, r, g, b] = rgb.map(Number);
  }
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // Contrast against white vs against near-black, whichever is higher.
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? LIGHT_ICON : DARK_ICON;
};

export default function StorefrontScrollTopButton({ isRtl = true, accent = FALLBACK_ACCENT }) {
  const [visible, setVisible] = useState(false);
  const [lifted, setLifted] = useState(false);
  // The scroll handler reads on every tick like the reference site does, but only
  // touches state when the answer actually flips — a rAF throttle would stall in a
  // background tab, and a boolean compare is cheaper than the frame it would cost.
  const shownRef = useRef(null);

  useEffect(() => {
    const read = () => {
      const offset = window.scrollY || document.documentElement.scrollTop || 0;
      const next = offset > SHOW_AFTER_PX;
      if (shownRef.current === next) return;
      shownRef.current = next;
      setVisible(next);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  if (typeof document === "undefined") return null;

  const label = isRtl ? "الرجوع لأعلى" : "Back to top";
  const background = String(accent || "").trim() || FALLBACK_ACCENT;
  const iconColor = readableIconColor(background);
  const bottom = lifted ? LIFTED_BOTTOM : RESTING_BOTTOM;

  const scrollToTop = () => {
    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Portalled to the body so no transformed ancestor on the page can turn this
  // fixed pill into an absolutely positioned one.
  return createPortal(
    <button
      type="button"
      className="sf-scroll-top-btn"
      aria-label={label}
      title={label}
      onClick={scrollToTop}
      onMouseEnter={() => setLifted(true)}
      onMouseLeave={() => setLifted(false)}
      onFocus={() => setLifted(true)}
      onBlur={() => setLifted(false)}
      style={{
        position: "fixed",
        left: "30px",
        right: "auto",
        bottom,
        width: "40px",
        height: "60px",
        padding: 0,
        border: "none",
        borderRadius: "var(--m1h-r-pill)",
        background: `var(--m1h-accent, ${background})`,
        color: iconColor,
        // Darkening on hover rather than a second stored colour: it works for any
        // format Site Studio accepts, including rgb() and hsl().
        filter: lifted ? "brightness(0.9)" : "none",
        boxShadow: "var(--m1h-shadow-soft)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        cursor: "pointer",
        zIndex: 99,
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        transform: visible ? "translateY(0)" : "translateY(100px)",
        transition: "500ms",
      }}
    >
      <ChevronUp size={16} color="currentColor" style={{ marginTop: "5px", marginBottom: "10px" }} aria-hidden="true" />
      <Loader2 size={16} color="currentColor" aria-hidden="true" />
    </button>,
    document.body
  );
}
