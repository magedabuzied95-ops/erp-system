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

// `cardMode: "bubble"` — the product card is part of the outbound bubble and
// wears its colour (WhatsApp). `"standalone"` — the card is its own surface on
// the transcript background, the way Meta draws a generic template.
const CHROME = {
  whatsapp: {
    radius: "rounded-[10px]",
    inbound: "bg-[#202c33] text-[#fff]",
    outbound: "bg-[#005c4b] text-[#fff]",
    inboundMeta: "text-white/45",
    outboundMeta: "text-white/60",
    link: "decoration-white/40 text-[#53bdeb]",
    cardMode: "bubble",
    cardWidth: "w-[286px]",
    cardSurface: "bg-[#005c4b] text-[#fff]",
    cardRadius: "rounded-[10px]",
    cardTitle: "text-[#fff]",
    cardMuted: "text-white/65",
    cardHairline: "bg-white/15",
    cardAction: "text-[#53bdeb]",
    cardImageBg: "bg-white",
  },
  messenger: {
    radius: "rounded-[18px]",
    inbound: "bg-[#303030] text-[#fff]",
    outbound: "bg-[#0084ff] text-[#fff]",
    inboundMeta: "text-white/50",
    outboundMeta: "text-white/75",
    link: "decoration-white/40 text-[#fff]",
    cardMode: "standalone",
    cardWidth: "w-[248px]",
    cardSurface: "bg-white text-[#050505]",
    cardRadius: "rounded-[18px]",
    cardTitle: "text-[#050505]",
    cardMuted: "text-[#65676b]",
    cardHairline: "bg-[#dadde1]",
    cardAction: "text-[#0084ff]",
    cardImageBg: "bg-[#f0f2f5]",
  },
  instagram: {
    radius: "rounded-[20px]",
    inbound: "bg-[#262626] text-[#fff]",
    outbound: "bg-[linear-gradient(135deg,#4f5bd5,#962fbf_55%,#d62976)] text-[#fff]",
    inboundMeta: "text-white/50",
    outboundMeta: "text-white/75",
    link: "decoration-white/40 text-[#fff]",
    cardMode: "standalone",
    cardWidth: "w-[240px]",
    cardSurface: "bg-white text-[#0f0f0f]",
    cardRadius: "rounded-[20px]",
    cardTitle: "text-[#0f0f0f]",
    cardMuted: "text-[#737373]",
    cardHairline: "bg-[#dbdbdb]",
    cardAction: "text-[#0095f6]",
    cardImageBg: "bg-[#fafafa]",
  },
  telegram: {
    radius: "rounded-[12px]",
    inbound: "bg-[#182533] text-[#fff]",
    outbound: "bg-[#2b5278] text-[#fff]",
    inboundMeta: "text-white/45",
    outboundMeta: "text-white/60",
    link: "decoration-white/40 text-[#62bcf9]",
    cardMode: "bubble",
    cardWidth: "w-[286px]",
    cardSurface: "bg-[#2b5278] text-[#fff]",
    cardRadius: "rounded-[12px]",
    cardTitle: "text-[#fff]",
    cardMuted: "text-white/65",
    cardHairline: "bg-white/15",
    cardAction: "text-[#62bcf9]",
    cardImageBg: "bg-white",
  },
  tiktok: {
    radius: "rounded-[16px]",
    inbound: "bg-[#2a2a2a] text-[#fff]",
    outbound: "bg-[#fe2c55] text-[#fff]",
    inboundMeta: "text-white/50",
    outboundMeta: "text-white/75",
    link: "decoration-white/40 text-[#fff]",
    cardMode: "standalone",
    cardWidth: "w-[240px]",
    cardSurface: "bg-white text-[#161823]",
    cardRadius: "rounded-[16px]",
    cardTitle: "text-[#161823]",
    cardMuted: "text-[#6b7280]",
    cardHairline: "bg-[#e5e7eb]",
    cardAction: "text-[#fe2c55]",
    cardImageBg: "bg-[#f4f4f5]",
  },
  web: {
    radius: "rounded-[14px]",
    inbound: "bg-white/[0.09] text-[#fff]",
    outbound: "bg-emerald-800/70 text-[#fff]",
    inboundMeta: "text-white/45",
    outboundMeta: "text-white/60",
    link: "decoration-white/40 text-cyan-200",
    cardMode: "bubble",
    cardWidth: "w-[286px]",
    cardSurface: "bg-emerald-800/70 text-[#fff]",
    cardRadius: "rounded-[14px]",
    cardTitle: "text-[#fff]",
    cardMuted: "text-white/65",
    cardHairline: "bg-white/15",
    cardAction: "text-cyan-200",
    cardImageBg: "bg-white",
  },
};

// The PWA transcript is a light canvas — it is these apps in light mode, not the
// dark ones with the page turned up. WhatsApp and Telegram are genuinely a
// different pair of bubbles there (pale mint on white, dark ink); Messenger,
// Instagram and TikTok keep the same brand colour on the outgoing side and only
// their neutral half moves.
//
// `ink` says which way the text runs on that side, because an attachment drawn
// inside the bubble has to be painted in the same ink as the words above it.
const LIGHT_OVERRIDES = {
  whatsapp: {
    inbound: "bg-white text-[#111b21]",
    inboundMeta: "text-[#667781]",
    inboundInk: "dark",
    outbound: "bg-[#d9fdd3] text-[#111b21]",
    outboundMeta: "text-[#667781]",
    outboundInk: "dark",
    link: "text-[#027eb5] decoration-[#027eb5]/40",
    cardSurface: "bg-[#d9fdd3] text-[#111b21]",
    cardTitle: "text-[#111b21]",
    cardMuted: "text-[#667781]",
    cardHairline: "bg-[#111b21]/10",
    cardAction: "text-[#027eb5]",
  },
  telegram: {
    inbound: "bg-white text-[#111b21]",
    inboundMeta: "text-[#707579]",
    inboundInk: "dark",
    outbound: "bg-[#effdde] text-[#111b21]",
    outboundMeta: "text-[#4fae4e]",
    outboundInk: "dark",
    link: "text-[#168acd] decoration-[#168acd]/40",
    cardSurface: "bg-[#effdde] text-[#111b21]",
    cardTitle: "text-[#111b21]",
    cardMuted: "text-[#707579]",
    cardHairline: "bg-[#111b21]/10",
    cardAction: "text-[#168acd]",
  },
  messenger: {
    inbound: "bg-[#e4e6eb] text-[#050505]",
    inboundMeta: "text-[#65676b]",
    inboundInk: "dark",
    link: "text-[#0064d1] decoration-[#0064d1]/40",
  },
  instagram: {
    inbound: "bg-[#efefef] text-[#0f0f0f]",
    inboundMeta: "text-[#737373]",
    inboundInk: "dark",
    link: "text-[#00376b] decoration-[#00376b]/40",
  },
  tiktok: {
    inbound: "bg-[#f1f1f2] text-[#161823]",
    inboundMeta: "text-[#6b7280]",
    inboundInk: "dark",
    link: "text-[#fe2c55] decoration-[#fe2c55]/40",
  },
  web: {
    inbound: "bg-white text-slate-900",
    inboundMeta: "text-slate-500",
    inboundInk: "dark",
    outbound: "bg-emerald-100 text-slate-900",
    outboundMeta: "text-emerald-800/70",
    outboundInk: "dark",
    link: "text-emerald-700 decoration-emerald-700/40",
    cardSurface: "bg-emerald-100 text-slate-900",
    cardTitle: "text-slate-900",
    cardMuted: "text-slate-500",
    cardHairline: "bg-slate-900/10",
    cardAction: "text-emerald-700",
  },
};

/**
 * The chrome for one message. `variant` is the surface it is painted on —
 * "desktop" (dark workspace) or "pwa" (light phone transcript).
 */
export const platformChrome = (platform = "web", variant = "desktop") => {
  const base = { inboundInk: "light", outboundInk: "light", ...(CHROME[platform] || CHROME.web) };
  if (variant !== "pwa") return base;
  return { ...base, ...(LIGHT_OVERRIDES[platform] || LIGHT_OVERRIDES.web) };
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
