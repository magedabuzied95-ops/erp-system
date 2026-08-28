// Social Comments Center — platform registry.
//
// WHAT THIS REPLACES, AND WHAT IT DELIBERATELY DOES NOT
// ----------------------------------------------------
// socialCommentsCenterService.js models platform as a Facebook/Instagram binary:
//
//     const normalizePlatform = (v) => (lower(v) === "instagram" ? "instagram" : "facebook");
//
// with roughly thirty sites embedding `channel = 'instagram_comment' ? 'instagram'
// : 'facebook'` inside raw SQL CASE expressions. Converting all of those to a
// registry is a large refactor across a ~4,950-line file, with real regression
// risk to two live Meta channels, and it buys nothing until TikTok comments
// actually work — which is blocked on TikTok approving the API for Business app.
//
// So this module introduces the seam WITHOUT rewriting those SQL sites:
//
//   * normalizePlatform() keeps byte-for-byte identical behaviour for every
//     input the system can produce today. "instagram" -> instagram, and
//     everything else -> facebook, including empty, null, and garbage. Meta
//     semantics, pagination, counts, reply/hide/like behaviour are untouched.
//
//   * assertMetaPlatform() is the new safety property. The binary SQL sites are
//     correct for Meta and wrong for anything else — a TikTok row reaching them
//     would be silently treated as Facebook and would query the wrong channel.
//     Rather than leaving that as a latent bug for whoever turns TikTok on, the
//     guard makes it a loud failure at the boundary.
//
// The order matters: the guard has to exist BEFORE tiktok can ever be produced
// by normalizePlatform. That is why tiktok is registered here as a known
// platform but is not yet reachable through normalizePlatform — see
// PLATFORM_TIKTOK's `normalizable: false`.

const lower = (value = "") => String(value ?? "").trim().toLowerCase();

export const SOCIAL_COMMENT_PLATFORMS = Object.freeze({
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  TIKTOK: "tiktok",
});

// One entry per platform. `channel` is the canonical ai_channel_conversations
// value; `meta` marks the two platforms the existing binary SQL is valid for.
export const SOCIAL_COMMENT_PLATFORM_REGISTRY = Object.freeze({
  [SOCIAL_COMMENT_PLATFORMS.FACEBOOK]: Object.freeze({
    platform: SOCIAL_COMMENT_PLATFORMS.FACEBOOK,
    channel: "facebook_comment",
    meta: true,
    normalizable: true,
    available: true,
  }),
  [SOCIAL_COMMENT_PLATFORMS.INSTAGRAM]: Object.freeze({
    platform: SOCIAL_COMMENT_PLATFORMS.INSTAGRAM,
    channel: "instagram_comment",
    meta: true,
    normalizable: true,
    available: true,
  }),
  [SOCIAL_COMMENT_PLATFORMS.TIKTOK]: Object.freeze({
    platform: SOCIAL_COMMENT_PLATFORMS.TIKTOK,
    channel: "tiktok_comment",
    meta: false,
    // Flipped 2026-08-28, in the required order: the Center's entry points now
    // dispatch tiktok to tiktokBusinessCommentsSyncService BEFORE any binary
    // Meta SQL runs, and every Meta-only path asserts assertMetaPlatform. The
    // integration is real (TikTok Accounts > Account Comment approved); runtime
    // availability per tenant comes from tiktokBusinessCapabilityService.
    normalizable: true,
    available: true,
  }),
});

export const isKnownCommentPlatform = (value = "") =>
  Object.hasOwn(SOCIAL_COMMENT_PLATFORM_REGISTRY, lower(value));

export const commentPlatformDescriptor = (value = "") =>
  SOCIAL_COMMENT_PLATFORM_REGISTRY[lower(value)] || null;

// BEHAVIOUR CONTRACT (updated 2026-08-28, deliberately): "instagram" maps to
// instagram, "tiktok" maps to tiktok, and everything else — empty, null,
// garbage, "facebook" — maps to facebook exactly as before. The ONLY input
// whose output changed is the literal "tiktok", which no Meta code path emits;
// the Meta regression test pins every other input to the old behaviour.
export const normalizePlatform = (value = "") => {
  const normalized = lower(value);
  if (normalized === SOCIAL_COMMENT_PLATFORMS.INSTAGRAM) return SOCIAL_COMMENT_PLATFORMS.INSTAGRAM;
  if (normalized === SOCIAL_COMMENT_PLATFORMS.TIKTOK && SOCIAL_COMMENT_PLATFORM_REGISTRY[SOCIAL_COMMENT_PLATFORMS.TIKTOK].normalizable) {
    return SOCIAL_COMMENT_PLATFORMS.TIKTOK;
  }
  return SOCIAL_COMMENT_PLATFORMS.FACEBOOK;
};

export const isTikTok = (value = "") =>
  normalizePlatform(value) === SOCIAL_COMMENT_PLATFORMS.TIKTOK;

export const isInstagram = (value = "") =>
  normalizePlatform(value) === SOCIAL_COMMENT_PLATFORMS.INSTAGRAM;

export const isFacebook = (value = "") =>
  normalizePlatform(value) === SOCIAL_COMMENT_PLATFORMS.FACEBOOK;

export const commentChannelForPlatform = (value = "") =>
  SOCIAL_COMMENT_PLATFORM_REGISTRY[normalizePlatform(value)].channel;

export class NonMetaCommentPlatformError extends Error {
  constructor(platform = "", site = "") {
    super(
      `Social Comments platform "${platform}" is not a Meta platform and cannot use the Facebook/Instagram query path${site ? ` (${site})` : ""}`
    );
    this.name = "NonMetaCommentPlatformError";
    this.code = "NON_META_COMMENT_PLATFORM";
    this.status = 501;
    this.platform = lower(platform);
    this.site = String(site || "");
  }
}

// Call at the entry of any path backed by the binary Meta SQL. Today nothing can
// trip it, because normalizePlatform cannot yet yield a non-Meta value — which
// is exactly why it is safe to add now and valuable later.
export const assertMetaPlatform = (value = "", site = "") => {
  const descriptor = commentPlatformDescriptor(value);
  if (descriptor && !descriptor.meta) throw new NonMetaCommentPlatformError(value, site);
  return normalizePlatform(value);
};
