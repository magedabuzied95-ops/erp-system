// The customer-facing social buttons, in each platform's own mark and colours.
//
// This used to live inside the public invoice page. When the invoice layout became a
// block list the `social` block drew its own plain outline pills instead, so the
// branded buttons silently disappeared from the invoice the customer opens. One
// renderer now serves both, which is why they cannot drift apart again.

import { useId } from "react";

// Current official brand marks, drawn as full-colour glyphs so each sits in the
// white circle exactly like the platform renders it.
export function BrandedSocialIcon({ type, className = "" }) {
  // The Instagram glyph needs a gradient, and a gradient needs an id that is unique
  // on the page — the same button can render twice (mobile strip + card).
  const gradientId = `social-brand-ig-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (type === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path
          fill="#25D366"
          d="M20.52 3.45A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.004c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Zm-8.47 18.29h-.004a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.89 9.88Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.89-.79-1.48-1.76-1.66-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35Z"
        />
      </svg>
    );
  }
  if (type === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path
          fill="#1877F2"
          d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.42c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07Z"
        />
      </svg>
    );
  }
  if (type === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <defs>
          <linearGradient id={gradientId} x1="2" y1="22" x2="22" y2="2">
            <stop stopColor="#FFDC80" />
            <stop offset="0.25" stopColor="#F77737" />
            <stop offset="0.5" stopColor="#F56040" />
            <stop offset="0.75" stopColor="#C13584" />
            <stop offset="1" stopColor="#833AB4" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          d="M12 0C8.74 0 8.33.02 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.02 8.33 0 8.74 0 12s.02 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.67 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.98 8.74 24 12 24s3.67-.02 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.67-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.05-1.28.07-1.69.07-4.95s-.02-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.46-1.38-2.13C21.32 1.35 20.65.94 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.02 15.26 0 12 0Zm0 2.16c3.2 0 3.58.02 4.85.07 1.17.06 1.8.25 2.23.42.56.22.96.48 1.38.9.42.42.68.82.9 1.38.17.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.06 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.07.36-2.24.41-1.27.06-1.65.07-4.86.07s-3.59-.02-4.86-.07c-1.17-.06-1.82-.26-2.24-.42-.57-.22-.96-.48-1.38-.9-.42-.42-.69-.82-.9-1.38-.17-.42-.36-1.07-.42-2.24-.05-1.26-.06-1.65-.06-4.84 0-3.2.01-3.59.06-4.86.06-1.17.25-1.81.42-2.23.21-.57.48-.96.9-1.38.42-.42.81-.69 1.38-.9.42-.17 1.05-.36 2.22-.42 1.27-.05 1.65-.06 4.86-.06Zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.41a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4c-.2 1.2-.9 2.2-2 2.9v2.4h3.1c1.8-1.7 3.1-4.1 3.1-7Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5l-3.1-2.4c-.9.6-2 .9-3.5.9-2.6 0-4.8-1.8-5.6-4.1H3.2v2.5C4.8 19.7 8.1 22 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.6H3.2a10 10 0 0 0 0 8.8l3.2-2.5Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.8 9.8 0 0 0 12 2C8.1 2 4.8 4.3 3.2 7.6l3.2 2.5C7.2 7.8 9.4 6 12 6Z" />
    </svg>
  );
}

// Each card carries its own platform colours, using the vendors' official brand
// values: Google blue, Facebook #1877F2, WhatsApp teal-to-green, and the
// Instagram gradient in its published stop order.
const SOCIAL_TONE = {
  google: "bg-[linear-gradient(135deg,#1a73e8,#4285f4)]",
  facebook: "bg-[linear-gradient(135deg,#0b5fce,#1877f2)]",
  facebookPage: "bg-[linear-gradient(135deg,#0b5fce,#1877f2)]",
  whatsapp: "bg-[linear-gradient(135deg,#075e54,#128c7e,#25d366)]",
  instagram: "bg-[linear-gradient(135deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)]",
};

// One renderer for every social/contact button so the page's own rows and the
// invoice card's social block cannot drift apart in styling.
export default function SocialBrandButton({ link, className = "" }) {
  const iconType = link.key === "facebookPage" ? "facebook" : link.key;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      // Browsers drop background gradients when printing unless told otherwise, and a
      // printed invoice with four white rectangles reads as a rendering bug.
      // `text-white` is not usable here: a global theme rule repaints every .text-white
      // with var(--text) !important, which on these gradients is near-black on dark blue.
      style={{ color: "#fff", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      className={`h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-xs font-black shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${SOCIAL_TONE[link.key] || SOCIAL_TONE.google} ${className || "inline-flex"}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
        <BrandedSocialIcon type={iconType} className="h-4 w-4" />
      </span>
      <span className="truncate">{link.label}</span>
    </a>
  );
}
