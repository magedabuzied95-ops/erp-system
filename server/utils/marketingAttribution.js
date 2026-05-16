import crypto from "node:crypto";

const trimString = (value) => String(value || "").trim();

const PLATFORM_ALIASES = {
  fb: "facebook",
  facebook: "facebook",
  ig: "instagram",
  instagram: "instagram",
  story: "story",
  instagram_story: "story",
  tiktok: "tiktok",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  other: "other",
};

const PLATFORM_CODES = {
  facebook: "FB",
  instagram: "IG",
  story: "STORY",
  tiktok: "TK",
  whatsapp: "WA",
  other: "OT",
};

export const normalizeAttributionPlatform = (value) => {
  const normalized = trimString(value).toLowerCase();
  return PLATFORM_ALIASES[normalized] || normalized || "other";
};

export const generateTrackingCode = ({ tenantId = 1, platform = "facebook", postId = null, kind = "post" } = {}) => {
  const normalizedPlatform = normalizeAttributionPlatform(platform);
  const platformCode = PLATFORM_CODES[normalizedPlatform] || "OT";
  const suffixSource = String(postId || crypto.randomInt(10, 99));
  const suffix = suffixSource.slice(-2).padStart(2, "0");

  if (kind === "story" || normalizedPlatform === "story") {
    return `STORY${suffix}`;
  }

  const tenantPrefix = `M${String(tenantId || 1)}`;
  return `${tenantPrefix}${platformCode}${suffix}`;
};

const parseCookieHeader = (cookieHeader = "") =>
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.split("="))
    .reduce((acc, [key, ...rest]) => {
      const normalizedKey = trimString(key);
      if (!normalizedKey) return acc;
      acc[normalizedKey] = trimString(rest.join("="));
      return acc;
    }, {});

export const detectMarketingSession = (req = {}) => {
  const body = req.body || {};
  const query = req.query || {};
  const cookies = parseCookieHeader(req.headers?.cookie || "");

  const source = trimString(
    body.marketing_source ??
      body.source ??
      query.src ??
      query.source ??
      cookies.marketing_source ??
      cookies.src
  );
  const platform = normalizeAttributionPlatform(
    body.marketing_platform ??
      body.platform ??
      query.platform ??
      query.src ??
      source
  );
  const postId = trimString(body.marketing_post_id ?? body.post_id ?? query.post ?? query.post_id ?? "");
  const campaign = trimString(body.marketing_campaign ?? body.campaign ?? query.campaign ?? cookies.campaign ?? "");
  const attributionType = trimString(body.attribution_type ?? body.attributionType ?? query.attr ?? query.attribution_type ?? "manual") || "manual";
  const trackingCode = trimString(body.marketing_tracking_code ?? body.tracking_code ?? query.code ?? query.tracking_code ?? "");
  const sessionId =
    trimString(body.marketing_session_id ?? body.session_id ?? query.session_id ?? cookies.marketing_session_id ?? "") ||
    crypto.randomUUID();

  return {
    session_id: sessionId,
    marketing_source: source || platform || "other",
    marketing_platform: platform || "other",
    marketing_post_id: postId || null,
    marketing_campaign: campaign || null,
    attribution_type: attributionType || "manual",
    marketing_tracking_code: trackingCode || null,
  };
};

export const buildTrackingLink = ({ origin = "", code = "", source = "", postId = "", campaign = "", platform = "" } = {}) => {
  const base = String(origin || "").replace(/\/$/, "");
  const path = `/track/${encodeURIComponent(String(code || "").trim())}`;
  const query = new URLSearchParams();
  if (source) query.set("src", source);
  if (platform) query.set("platform", platform);
  if (postId) query.set("post", postId);
  if (campaign) query.set("campaign", campaign);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return `${base}${path}${suffix}`;
};

