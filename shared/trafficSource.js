/**
 * Where a storefront visit came from, as a channel (google, facebook, ...) and a medium
 * (paid, organic, direct, unknown). Shared by the storefront, which uses it to decide when a
 * new session starts, and by the server, which re-classifies the raw landing parameters
 * itself rather than trusting the label a browser sends.
 *
 * Precedence, strongest signal first:
 *   1. an ad click id (gclid, ttclid, ...) — only the ad platform appends those, so paid;
 *   2. utm_source / utm_medium tags written by whoever built the link;
 *   3. the shop's own /track/CODE links (src=...), which point at published posts: organic;
 *   4. fbclid alone — Meta adds it to ad AND post clicks, so the medium is unknown;
 *   5. the referrer host;
 *   6. nothing at all: direct.
 */

export const TRAFFIC_MEDIUMS = ["paid", "organic", "direct", "unknown"];

export const TRAFFIC_CHANNELS = [
  "direct",
  "google",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "snapchat",
  "whatsapp",
  "telegram",
  "twitter",
  "bing",
  "email",
  "referral",
  "other",
  // An order whose visit could not be traced (tracking blocked, a page cached from before).
  "unknown",
];

// The idle gap after which the next page view opens a new session, as GA4 counts them.
export const TRAFFIC_SESSION_IDLE_MS = 30 * 60 * 1000;

const SOURCE_ALIASES = {
  google: "google",
  "google.com": "google",
  adwords: "google",
  googleads: "google",
  google_ads: "google",
  pmax: "google",
  facebook: "facebook",
  fb: "facebook",
  "facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  meta: "facebook",
  messenger: "facebook",
  instagram: "instagram",
  ig: "instagram",
  insta: "instagram",
  "instagram.com": "instagram",
  story: "instagram",
  instagram_story: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  "tiktok.com": "tiktok",
  youtube: "youtube",
  yt: "youtube",
  "youtube.com": "youtube",
  snapchat: "snapchat",
  snap: "snapchat",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  telegram: "telegram",
  tg: "telegram",
  twitter: "twitter",
  x: "twitter",
  "t.co": "twitter",
  bing: "bing",
  microsoft: "bing",
  email: "email",
  newsletter: "email",
  mail: "email",
  sms: "other",
};

// Hosts matched by their registrable suffix, so l.instagram.com and www.google.com.eg both land.
const REFERRER_HOSTS = [
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)googlequicksearchbox$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, "telegram"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "twitter"],
  [/(^|\.)(mail\.google\.com|outlook\.live\.com|mail\.yahoo\.com)$/, "email"],
];

const PAID_MEDIUM = /(^|[^a-z])(cpc|ppc|cpm|cpv|cpa|paid|ads?|display|sponsored|retargeting|remarketing|banner|pmax|shopping)([^a-z]|$)/;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const lower = (value, max = 200) => text(value, max).toLowerCase();

export const normalizeTrafficSource = (value) => {
  const source = lower(value).replace(/^www\./, "");
  if (!source) return "";
  if (SOURCE_ALIASES[source]) return SOURCE_ALIASES[source];
  const fromHost = channelFromHost(source);
  return fromHost || "other";
};

export const referrerHost = (referrer) => {
  const value = text(referrer, 2000);
  if (!value) return "";
  // An Android app referrer reads android-app://com.google.android.googlequicksearchbox/...
  const appMatch = value.match(/^android-app:\/\/([^/]+)/i);
  if (appMatch) return appMatch[1].toLowerCase();
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const channelFromHost = (host) => {
  if (!host) return "";
  if (/(^|\.)mail\.google\.com$/.test(host)) return "email";
  for (const [pattern, channel] of REFERRER_HOSTS) {
    if (pattern.test(host)) return channel;
  }
  return "";
};

const sameSite = (host, ownHost) => {
  const a = lower(host).replace(/^www\./, "");
  const b = lower(ownHost).replace(/^www\./, "");
  return Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
};

/** The landing parameters worth keeping, from a URLSearchParams, a query string or a plain object. */
export const readTrafficParams = (search = "") => {
  const params = search instanceof URLSearchParams
    ? search
    : typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : new URLSearchParams(Object.entries(search || {}).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => [key, String(value)]));
  const get = (key) => text(params.get(key));
  return {
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    utm_term: get("utm_term"),
    gclid: get("gclid") || get("gbraid") || get("wbraid"),
    gad_source: get("gad_source"),
    fbclid: get("fbclid"),
    ttclid: get("ttclid"),
    sccid: get("ScCid") || get("sccid"),
    msclkid: get("msclkid"),
    src: get("src"),
    campaign: get("campaign"),
  };
};

/** True when the landing carries anything beyond a bare visit, so it may open a new session. */
export const hasTrafficSignal = (params = {}, referrer = "", ownHost = "") => {
  const keys = ["utm_source", "utm_medium", "utm_campaign", "gclid", "gad_source", "fbclid", "ttclid", "sccid", "msclkid", "src"];
  if (keys.some((key) => text(params[key]))) return true;
  const host = referrerHost(referrer);
  return Boolean(host) && !sameSite(host, ownHost);
};

/**
 * Classify one landing. Returns { channel, medium, source, campaign, click_id_type, referrer_host }.
 * `source` is the raw utm_source (or referrer host) so the report can show what the label hid.
 */
export const classifyTrafficSource = ({ params = {}, referrer = "", ownHost = "" } = {}) => {
  const p = readTrafficParams(params);
  const host = referrerHost(referrer);
  const external = Boolean(host) && !sameSite(host, ownHost);
  const referrerChannel = external ? channelFromHost(host) : "";
  const campaign = p.utm_campaign || p.campaign || "";
  const base = { campaign, referrer_host: external ? host : "", click_id_type: "" };

  if (p.gclid || p.gad_source) {
    return { ...base, channel: "google", medium: "paid", source: p.utm_source || "google", click_id_type: p.gclid ? "gclid" : "gad_source" };
  }
  if (p.ttclid) return { ...base, channel: "tiktok", medium: "paid", source: p.utm_source || "tiktok", click_id_type: "ttclid" };
  if (p.sccid) return { ...base, channel: "snapchat", medium: "paid", source: p.utm_source || "snapchat", click_id_type: "sccid" };
  if (p.msclkid) return { ...base, channel: "bing", medium: "paid", source: p.utm_source || "bing", click_id_type: "msclkid" };

  if (p.utm_source || p.utm_medium) {
    const medium = lower(p.utm_medium);
    const channel = normalizeTrafficSource(p.utm_source) || referrerChannel || (medium === "email" ? "email" : "other");
    const resolvedMedium = PAID_MEDIUM.test(medium)
      ? "paid"
      : medium
        ? "organic"
        // A bare utm_source: an ad click id would have said paid, but a hand-tagged ad link
        // often carries no medium, so it is not safe to call it organic either.
        : p.fbclid ? "unknown" : "organic";
    return { ...base, channel, medium: resolvedMedium, source: p.utm_source || host, click_id_type: p.fbclid ? "fbclid" : "" };
  }

  if (p.src) {
    return { ...base, channel: normalizeTrafficSource(p.src) || "other", medium: "organic", source: p.src };
  }

  if (p.fbclid) {
    // Meta's in-app browser usually sends no referrer; when it does, it tells Instagram apart.
    const channel = referrerChannel === "instagram" ? "instagram" : "facebook";
    return { ...base, channel, medium: "unknown", source: host || channel, click_id_type: "fbclid" };
  }

  if (external) {
    return { ...base, channel: referrerChannel || "referral", medium: "organic", source: host };
  }

  return { ...base, channel: "direct", medium: "direct", source: "" };
};

const BOT_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|headless|lighthouse|pingdom|uptime|preview|python-requests|curl\/|wget\//i;

export const isBotUserAgent = (userAgent = "") => {
  const value = String(userAgent || "");
  return !value || BOT_USER_AGENT.test(value);
};
