// Pure TikTok publishing rules for the Social Publisher composer.
//
// Extracted from the component so the compliance rules are unit-testable and
// cannot drift between the composer, the preview, and the payload builder.
// Everything here is derived from what TikTok returns from
// /tiktok/posting-options (creator_info) — nothing about a creator's
// capabilities is hardcoded. The only hardcoded things are TikTok's own fixed
// vocabulary (privacy level names) and TikTok's published UX rules.
//
// TikTok UX requirements implemented here, per the official content-sharing
// guidelines:
//   * The commercial-disclosure toggle is OFF by default.
//   * With it on, at least one of "Your Brand" / "Branded Content" must be
//     selected or publishing is blocked.
//   * Branded Content cannot be SELF_ONLY — that privacy option is disabled
//     rather than silently rewritten.
//   * The compliance statement text has three variants driven by the selection.
//   * No privacy level is preselected: the user must choose one.

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const TIKTOK_PRIVACY_LEVELS = Object.freeze([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

// TikTok's own enum values map to our i18n keys; unknown future values fall back
// to the raw value so a new TikTok option is still selectable, not hidden.
export const TIKTOK_PRIVACY_LABEL_KEY = Object.freeze({
  PUBLIC_TO_EVERYONE: "marketing.tiktok.privacy.public",
  MUTUAL_FOLLOW_FRIENDS: "marketing.tiktok.privacy.friends",
  FOLLOWER_OF_CREATOR: "marketing.tiktok.privacy.followers",
  SELF_ONLY: "marketing.tiktok.privacy.selfOnly",
});

export const TIKTOK_POST_MODES = Object.freeze({
  DIRECT_POST: "DIRECT_POST",
  INBOX_UPLOAD: "INBOX_UPLOAD",
});

// Disclosure OFF, nothing preselected, interactions allowed. Matches the
// TikTok-mandated default state of a fresh composer.
export const defaultTikTokOptions = () => ({
  privacy_level: "",
  disable_comment: false,
  disable_duet: false,
  disable_stitch: false,
  commercial_content_toggle: false,
  brand_organic_toggle: false,
  brand_content_toggle: false,
});

// ---------------------------------------------------------------------------
// Account readiness
// ---------------------------------------------------------------------------

// Maps GET /tiktok/status into a single publishable/not decision plus the reason
// the composer should show. Anything other than a live, direct-post-capable
// connection blocks publishing rather than failing at the API.
export const tiktokAccountReadiness = (status) => {
  if (!status) return { ready: false, reasonKey: "marketing.tiktok.blocked.unknown", needsSettings: true };
  const config = status.config || null;
  if (config && config.enabled === false) {
    return { ready: false, reasonKey: "marketing.tiktok.blocked.disabled", needsSettings: false };
  }
  if (config && config.configured === false) {
    return { ready: false, reasonKey: "marketing.tiktok.blocked.notConfigured", needsSettings: false };
  }
  if (status.reconnect_required) {
    return { ready: false, reasonKey: "marketing.tiktok.blocked.reconnectRequired", needsSettings: true };
  }
  if (!status.connected) {
    return { ready: false, reasonKey: "marketing.tiktok.blocked.notConnected", needsSettings: true };
  }
  // Connected but the creator never granted video.publish: Direct Post would be
  // rejected by TikTok, so it is blocked here with an accurate reason.
  if (!status.account?.capabilities?.direct_post) {
    return { ready: false, reasonKey: "marketing.tiktok.blocked.missingPublishScope", needsSettings: true };
  }
  return { ready: true, reasonKey: "", needsSettings: false };
};

// ---------------------------------------------------------------------------
// Dynamic option availability
// ---------------------------------------------------------------------------

// Creator info uses *disable* flags. A creator with comment_disabled=true cannot
// allow comments at all, so the UI control is disabled rather than sending a
// value TikTok would reject.
export const deriveTikTokOptionAvailability = (creatorInfo = {}, options = {}) => {
  const privacyOptions = asArray(creatorInfo.privacy_level_options).map((item) => text(item)).filter(Boolean);
  // Branded Content forbids SELF_ONLY. The option stays visible but disabled
  // with an explanation, which is what TikTok's guidelines ask for.
  const selfOnlyBlockedByBrandedContent = Boolean(options.brand_content_toggle);

  return {
    privacy_levels: privacyOptions.map((level) => ({
      value: level,
      labelKey: TIKTOK_PRIVACY_LABEL_KEY[level] || "",
      disabled: level === "SELF_ONLY" && selfOnlyBlockedByBrandedContent,
      disabledReasonKey: level === "SELF_ONLY" && selfOnlyBlockedByBrandedContent
        ? "marketing.tiktok.brandedContentSelfOnly"
        : "",
    })),
    // `can*` = the creator permits it, so the toggle is interactive.
    canAllowComment: !creatorInfo.comment_disabled,
    canAllowDuet: !creatorInfo.duet_disabled,
    canAllowStitch: !creatorInfo.stitch_disabled,
    maxDurationSec: Number(creatorInfo.max_video_post_duration_sec) || 0,
  };
};

// When a creator disables an interaction, the outgoing payload must say
// disabled regardless of what the (inert) control shows.
export const reconcileTikTokOptions = (options = {}, creatorInfo = {}) => {
  const next = { ...defaultTikTokOptions(), ...options };
  if (creatorInfo.comment_disabled) next.disable_comment = true;
  if (creatorInfo.duet_disabled) next.disable_duet = true;
  if (creatorInfo.stitch_disabled) next.disable_stitch = true;
  // Turning the disclosure off must clear both sub-selections so a stale
  // branded flag cannot survive into the payload.
  if (!next.commercial_content_toggle) {
    next.brand_organic_toggle = false;
    next.brand_content_toggle = false;
  }
  // Selecting Branded Content while SELF_ONLY was already chosen clears the
  // now-illegal privacy choice instead of posting it.
  if (next.brand_content_toggle && next.privacy_level === "SELF_ONLY") {
    next.privacy_level = "";
  }
  return next;
};

// ---------------------------------------------------------------------------
// Compliance statement
// ---------------------------------------------------------------------------

// Three official variants. Branded Content (alone or with Your Brand) adds the
// Branded Content Policy; everything else is the Music Usage Confirmation only.
export const tiktokComplianceStatementKey = (options = {}) => {
  if (!options.commercial_content_toggle) return "marketing.tiktok.consent.music";
  if (options.brand_content_toggle) return "marketing.tiktok.consent.brandedAndMusic";
  return "marketing.tiktok.consent.music";
};

export const tiktokContentLabelKey = (options = {}) => {
  if (!options.commercial_content_toggle) return "";
  if (options.brand_content_toggle) return "marketing.tiktok.label.paidPartnership";
  if (options.brand_organic_toggle) return "marketing.tiktok.label.promotionalContent";
  return "";
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// TikTok accepts MP4/MOV/WEBM for video uploads. Enforced client-side so the
// user gets a real message instead of an opaque API rejection after an upload.
export const TIKTOK_VIDEO_EXTENSIONS = Object.freeze(["mp4", "mov", "webm"]);
export const TIKTOK_MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

export const validateTikTokVideo = ({ mediaType, fileName = "", fileSize = 0, durationSec = 0, maxDurationSec = 0 } = {}) => {
  const errors = [];
  if (text(mediaType).toLowerCase() !== "video") {
    errors.push({ key: "marketing.tiktok.errors.videoRequired" });
    // Everything below is video-specific; reporting it for an image would be noise.
    return { valid: false, errors };
  }
  const extension = text(fileName).split(".").pop().toLowerCase();
  if (extension && !TIKTOK_VIDEO_EXTENSIONS.includes(extension)) {
    errors.push({ key: "marketing.tiktok.errors.unsupportedFormat", params: { formats: TIKTOK_VIDEO_EXTENSIONS.join(", ") } });
  }
  if (fileSize > TIKTOK_MAX_VIDEO_BYTES) {
    errors.push({ key: "marketing.tiktok.errors.fileTooLarge" });
  }
  // Only enforced when both are known: creator_info may omit the cap, and the
  // browser may fail to read the duration.
  if (maxDurationSec > 0 && durationSec > 0 && durationSec > maxDurationSec) {
    errors.push({ key: "marketing.tiktok.errors.tooLong", params: { max: maxDurationSec } });
  }
  return { valid: errors.length === 0, errors };
};

// The single gate the composer asks before enabling the Publish button.
export const validateTikTokComposerOptions = ({
  options = {},
  creatorInfo = {},
  postMode = TIKTOK_POST_MODES.DIRECT_POST,
  video = null,
} = {}) => {
  const errors = [];

  // A draft carries no caption, privacy, or disclosure — the creator sets those
  // inside the TikTok app. Only the video itself is validated.
  if (postMode === TIKTOK_POST_MODES.INBOX_UPLOAD) {
    if (video) errors.push(...validateTikTokVideo(video).errors);
    return { valid: errors.length === 0, errors };
  }

  const privacy = text(options.privacy_level);
  const allowed = asArray(creatorInfo.privacy_level_options).map((item) => text(item));
  if (!privacy) {
    errors.push({ key: "marketing.tiktok.errors.privacyRequired" });
  } else if (allowed.length && !allowed.includes(privacy)) {
    errors.push({ key: "marketing.tiktok.errors.privacyUnavailable" });
  }

  if (options.commercial_content_toggle && !options.brand_organic_toggle && !options.brand_content_toggle) {
    errors.push({ key: "marketing.tiktok.errors.disclosureSelectionRequired" });
  }
  if (options.brand_content_toggle && privacy === "SELF_ONLY") {
    errors.push({ key: "marketing.tiktok.errors.brandedContentSelfOnly" });
  }
  if ((options.brand_organic_toggle || options.brand_content_toggle) && !options.commercial_content_toggle) {
    errors.push({ key: "marketing.tiktok.errors.disclosureRequired" });
  }

  if (video) errors.push(...validateTikTokVideo(video).errors);

  return { valid: errors.length === 0, errors };
};

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

// Produces the `publish_settings.tiktok` block only. Meta settings are built
// separately and are never merged with these, so a TikTok option can never
// reach the Graph API payload.
export const buildTikTokPublishSettings = ({ options = {}, creatorInfo = {}, postMode = TIKTOK_POST_MODES.DIRECT_POST, durationSec = 0 } = {}) => {
  const reconciled = reconcileTikTokOptions(options, creatorInfo);
  if (postMode === TIKTOK_POST_MODES.INBOX_UPLOAD) {
    return { post_mode: TIKTOK_POST_MODES.INBOX_UPLOAD };
  }
  return {
    post_mode: TIKTOK_POST_MODES.DIRECT_POST,
    privacy_level: text(reconciled.privacy_level),
    disable_comment: Boolean(reconciled.disable_comment),
    disable_duet: Boolean(reconciled.disable_duet),
    disable_stitch: Boolean(reconciled.disable_stitch),
    commercial_content_toggle: Boolean(reconciled.commercial_content_toggle),
    brand_organic_toggle: Boolean(reconciled.brand_organic_toggle),
    brand_content_toggle: Boolean(reconciled.brand_content_toggle),
    video_duration_sec: Number(durationSec) || 0,
  };
};

// ---------------------------------------------------------------------------
// Publish status
// ---------------------------------------------------------------------------

// Backend job statuses -> what the composer shows. `uploaded` deliberately maps
// to "processing", not success: TikTok has the bytes but has not published yet,
// and reporting success there would be a lie the user acts on.
export const TIKTOK_TERMINAL_STATUSES = Object.freeze(["published", "draft_ready", "failed"]);

export const tiktokStatusPresentation = (status = "") => {
  switch (text(status).toLowerCase()) {
    case "pending":
    case "processing_upload":
    case "uploading":
      return { tone: "info", labelKey: "marketing.tiktok.status.uploading", terminal: false };
    case "uploaded":
    case "processing":
      return { tone: "info", labelKey: "marketing.tiktok.status.processing", terminal: false };
    case "published":
      return { tone: "success", labelKey: "marketing.tiktok.status.published", terminal: true };
    case "draft_ready":
      return { tone: "success", labelKey: "marketing.tiktok.status.draftReady", terminal: true };
    case "failed":
      return { tone: "error", labelKey: "marketing.tiktok.status.failed", terminal: true };
    default:
      return { tone: "info", labelKey: "marketing.tiktok.status.processing", terminal: false };
  }
};
