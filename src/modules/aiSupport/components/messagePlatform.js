/**
 * What a message looked like on the platform it actually travelled on.
 *
 * The transcript used to paint every channel with one house palette and label
 * each bubble with its provenance ("العميل / رسائل إنستجرام / 9/8/2026, 1:03:47 AM"),
 * which is a database row printed on screen rather than a chat. An operator
 * already knows which thread they opened; what they need is to recognise what
 * the customer is looking at on their phone.
 *
 * So the channel picks the chrome instead of a caption: WhatsApp's teal-on-slate,
 * Messenger's blue, Instagram's gradient, Telegram's navy. The same object also
 * decides how a product card is drawn, because the platforms genuinely differ —
 * WhatsApp sends the card as a bubble (image, caption, a link row under a
 * hairline), while Meta's generic template is a white card that sits on the
 * transcript background outside any bubble.
 *
 * These are VALUES, not Tailwind classes, and the bubbles apply them as inline
 * styles. Twice now the class route has failed silently on production: once
 * because Tailwind does not generate a three-digit arbitrary hex (`text-[#fff]`
 * emitted nothing at all, so every bubble ran with no ink), and once because a
 * global `html[data-theme]` rule re-points whole families of colour utilities at
 * the theme tokens with `!important`. A brand colour is data — WhatsApp green is
 * WhatsApp green in every theme — so it must not travel through a layer whose
 * job is to make colours follow the theme, and it must not depend on a scanner
 * having noticed the string. An inline style cannot be dropped by either.
 */

const clean = (value = "") => String(value ?? "").trim().toLowerCase();

export const resolveMessagePlatform = (message = {}, fallbackChannel = "") => {
  const raw = clean(message?.channel || message?.source || message?.platform || fallbackChannel);
  if (!raw) return "web";
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("instagram")) return "instagram";
  if (raw.includes("messenger") || raw.includes("facebook")) return "messenger";
  if (raw.includes("telegram")) return "telegram";
  if (raw.includes("tiktok")) return "tiktok";
  return "web";
};

/*
 * Per platform, per canvas:
 *   canvas        the conversation wallpaper the app itself uses
 *   inBg/outBg    bubble fill (any CSS background value — Instagram's is a gradient)
 *   inInk/outInk  text colour on that bubble
 *   inDark/outDark  true when the ink is dark, i.e. the bubble is a light one.
 *                   Everything drawn inside the bubble — a link, a voice player,
 *                   a failure mark — reads this rather than the page theme.
 *   inMeta/outMeta  the timestamp row
 *   inLink/outLink  link colour ON that side (Messenger keeps a blue bubble in
 *                   light mode, so its outgoing link stays white there)
 *   card*         the product card, which is part of the bubble on WhatsApp and
 *                 a free-standing white template on Meta
 */
const CHROME = {
  whatsapp: {
    radius: "10px",
    cardMode: "bubble",
    cardWidth: "286px",
    dark: {
      canvas: "#0b141a",
      inBg: "#202c33", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.45)", inLink: "#53bdeb",
      outBg: "#005c4b", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.6)", outLink: "#53bdeb",
      cardBg: "#005c4b", cardInk: "#ffffff", cardMuted: "rgba(255,255,255,0.65)", cardLine: "rgba(255,255,255,0.15)", cardAction: "#53bdeb", cardImageBg: "#ffffff",
    },
    light: {
      canvas: "#efeae2",
      inBg: "#ffffff", inInk: "#111b21", inDark: true, inMeta: "#667781", inLink: "#027eb5",
      outBg: "#d9fdd3", outInk: "#111b21", outDark: true, outMeta: "#667781", outLink: "#027eb5",
      cardBg: "#d9fdd3", cardInk: "#111b21", cardMuted: "#667781", cardLine: "rgba(17,27,33,0.1)", cardAction: "#027eb5", cardImageBg: "#ffffff",
    },
  },
  messenger: {
    radius: "18px",
    cardMode: "standalone",
    cardWidth: "248px",
    dark: {
      canvas: "#0a0a0a",
      inBg: "#303030", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.5)", inLink: "#ffffff",
      outBg: "#0084ff", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#050505", cardMuted: "#65676b", cardLine: "#dadde1", cardAction: "#0084ff", cardImageBg: "#f0f2f5",
    },
    light: {
      canvas: "#ffffff",
      inBg: "#e4e6eb", inInk: "#050505", inDark: true, inMeta: "#65676b", inLink: "#0064d1",
      outBg: "#0084ff", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#050505", cardMuted: "#65676b", cardLine: "#dadde1", cardAction: "#0084ff", cardImageBg: "#f0f2f5",
    },
  },
  instagram: {
    radius: "20px",
    cardMode: "standalone",
    cardWidth: "240px",
    dark: {
      canvas: "#000000",
      inBg: "#262626", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.5)", inLink: "#ffffff",
      outBg: "linear-gradient(135deg,#4f5bd5,#962fbf 55%,#d62976)", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#0f0f0f", cardMuted: "#737373", cardLine: "#dbdbdb", cardAction: "#0095f6", cardImageBg: "#fafafa",
    },
    light: {
      canvas: "#ffffff",
      inBg: "#efefef", inInk: "#0f0f0f", inDark: true, inMeta: "#737373", inLink: "#00376b",
      outBg: "linear-gradient(135deg,#4f5bd5,#962fbf 55%,#d62976)", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#0f0f0f", cardMuted: "#737373", cardLine: "#dbdbdb", cardAction: "#0095f6", cardImageBg: "#fafafa",
    },
  },
  telegram: {
    radius: "12px",
    cardMode: "bubble",
    cardWidth: "286px",
    dark: {
      canvas: "#0e1621",
      inBg: "#182533", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.45)", inLink: "#62bcf9",
      outBg: "#2b5278", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.6)", outLink: "#62bcf9",
      cardBg: "#2b5278", cardInk: "#ffffff", cardMuted: "rgba(255,255,255,0.65)", cardLine: "rgba(255,255,255,0.15)", cardAction: "#62bcf9", cardImageBg: "#ffffff",
    },
    light: {
      canvas: "#e6ebee",
      inBg: "#ffffff", inInk: "#111b21", inDark: true, inMeta: "#707579", inLink: "#168acd",
      outBg: "#effdde", outInk: "#111b21", outDark: true, outMeta: "#4fae4e", outLink: "#168acd",
      cardBg: "#effdde", cardInk: "#111b21", cardMuted: "#707579", cardLine: "rgba(17,27,33,0.1)", cardAction: "#168acd", cardImageBg: "#ffffff",
    },
  },
  tiktok: {
    radius: "16px",
    cardMode: "standalone",
    cardWidth: "240px",
    dark: {
      canvas: "#121212",
      inBg: "#2a2a2a", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.5)", inLink: "#ffffff",
      outBg: "#fe2c55", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#161823", cardMuted: "#6b7280", cardLine: "#e5e7eb", cardAction: "#fe2c55", cardImageBg: "#f4f4f5",
    },
    light: {
      canvas: "#ffffff",
      inBg: "#f1f1f2", inInk: "#161823", inDark: true, inMeta: "#6b7280", inLink: "#fe2c55",
      outBg: "#fe2c55", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.75)", outLink: "#ffffff",
      cardBg: "#ffffff", cardInk: "#161823", cardMuted: "#6b7280", cardLine: "#e5e7eb", cardAction: "#fe2c55", cardImageBg: "#f4f4f5",
    },
  },
  // Web chat has no app of its own to imitate, so it borrows the house green and
  // leaves the transcript on the workspace surface.
  web: {
    radius: "14px",
    cardMode: "bubble",
    cardWidth: "286px",
    dark: {
      canvas: "",
      inBg: "rgba(255,255,255,0.09)", inInk: "#ffffff", inDark: false, inMeta: "rgba(255,255,255,0.45)", inLink: "#a5f3fc",
      outBg: "#155e4b", outInk: "#ffffff", outDark: false, outMeta: "rgba(255,255,255,0.6)", outLink: "#a5f3fc",
      cardBg: "#155e4b", cardInk: "#ffffff", cardMuted: "rgba(255,255,255,0.65)", cardLine: "rgba(255,255,255,0.15)", cardAction: "#a5f3fc", cardImageBg: "#ffffff",
    },
    light: {
      canvas: "",
      inBg: "#ffffff", inInk: "#0f172a", inDark: true, inMeta: "#64748b", inLink: "#047857",
      outBg: "#d1fae5", outInk: "#0f172a", outDark: true, outMeta: "#047857", outLink: "#047857",
      cardBg: "#d1fae5", cardInk: "#0f172a", cardMuted: "#64748b", cardLine: "rgba(15,23,42,0.1)", cardAction: "#047857", cardImageBg: "#ffffff",
    },
  },
};

/**
 * The chrome for one message. `mode` is the canvas it is painted on — "dark" or
 * "light" — which the caller reads off the live theme, NOT off the surface: the
 * desktop workspace follows the ERP theme and the PWA is always light.
 */
export const platformChrome = (platform = "web", mode = "dark") => {
  const base = CHROME[platform] || CHROME.web;
  const palette = base[mode === "light" ? "light" : "dark"];
  return { radius: base.radius, cardMode: base.cardMode, cardWidth: base.cardWidth, ...palette };
};

/** The transcript wallpaper for a conversation (may be "" for web chat). */
export const platformCanvas = (platform = "web", mode = "dark") => platformChrome(platform, mode).canvas;

/**
 * Which canvas the bubbles are being painted on. The PWA transcript is a light
 * page whatever the ERP theme is; everywhere else follows the live theme, so a
 * user on the light theme gets the light-mode bubbles rather than WhatsApp's
 * night palette punched into a bright page.
 */
export const chromeModeFor = (variant = "desktop", themeMode = "") =>
  variant === "pwa" || String(themeMode).toLowerCase() === "light" ? "light" : "dark";

/** The side of one message, resolved to the values that side is drawn in. */
export const bubbleSkin = (chrome = {}, side = "in") => {
  const isIn = side === "in";
  return {
    background: isIn ? chrome.inBg : chrome.outBg,
    ink: isIn ? chrome.inInk : chrome.outInk,
    meta: isIn ? chrome.inMeta : chrome.outMeta,
    link: isIn ? chrome.inLink : chrome.outLink,
    darkInk: Boolean(isIn ? chrome.inDark : chrome.outDark),
  };
};

// "1:03 ص" — the only stamp a chat bubble carries. The day it belongs to is the
// separator above it, exactly as WhatsApp and Messenger do it, so the full
// timestamp is left to the message-info sheet.
export const bubbleClock = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
};
