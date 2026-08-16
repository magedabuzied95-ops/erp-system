// Surveillance Center — stream profiles and selection policy.
//
// WHY "grid = sub, fullscreen = main" IS NOT THE RULE
// ---------------------------------------------------
// The reference recorder caps its sub stream at CIF (352x288) and 7 fps, so on
// that device a 16-up grid really does end up on a tiny second stream. It would
// be easy to hardcode that conclusion. It would also be wrong the moment a
// second device exists:
//
//   * a newer recorder offers a D1 or 720p sub stream at 25 fps
//   * an NVR exposes THREE profiles, not two
//   * an IP camera exposes a third stream sized specifically for grids
//   * a channel is configured differently from its neighbours on the same device
//
// So neither the schema, the gateway, nor the UI names "sub". They handle a
// LIST of profiles discovered per channel, and selection is a budget decision
// made against whatever that list contains. On the reference device the policy
// happens to pick the CIF profile for a 16-up grid — as an outcome, not an
// assumption.
//
// THE BUDGET IS THE REAL INPUT
// ----------------------------
// The binding constraint measured in Phase 2A is the store's upload, not the
// recorder and not the viewer. A 16-up grid of CIF streams is ~3.4 Mbps; the
// same grid on main streams is ~25 Mbps and would saturate a typical shop
// connection. Selection therefore takes a bandwidth budget and fits within it,
// which is a rule that keeps working when a device offers better profiles than
// this one does.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";

/**
 * What the browser can actually decode.
 *
 * H.264 is universal in WebRTC. H.265 is not: browser support is close to
 * absent, so an H.265 profile can only be shown by transcoding, which is a
 * per-stream CPU cost we refuse to pay for a grid.
 *
 * Dahua's "H.264+"/"H.265+" and "AI Coding" are smart-encoding variants. They
 * usually decode as their base codec, but "usually" is not a property to bet a
 * grid on, so they are normalised to the base and flagged.
 */
export const BROWSER_NATIVE_CODECS = Object.freeze(["h264"]);
export const TRANSCODE_REQUIRED_CODECS = Object.freeze(["h265", "mjpeg", "mpeg4"]);

export const normalizeCodec = (value = "") => {
  // The dot matters: Dahua reports "H.264" and "H.265+", ONVIF reports "H264"
  // and "H265". Both must land on the same token, or a codec check silently
  // fails for one vendor and the browser gets a stream it cannot decode.
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s_.-]/g, "");
  if (!raw) return { codec: "", smart: false, browserNative: false };
  const smart = raw.endsWith("+") || raw.includes("plus") || raw.includes("aicoding");
  const base = raw
    .replace(/\+$/, "")
    .replace(/plus$/, "")
    .replace(/aicoding/, "")
    .replace(/^avc$/, "h264")
    .replace(/^hevc$/, "h265");
  const codec = base || (smart ? "h264" : "");
  return { codec, smart, browserNative: BROWSER_NATIVE_CODECS.includes(codec) };
};

/**
 * One playable stream on one channel.
 *
 * `key` is the vendor's addressing token — for Dahua the RTSP `subtype`, for
 * ONVIF a profile token. The core never interprets it; it hands it back to the
 * adapter. That is what keeps "main"/"sub" out of everything above the adapter.
 */
export const normalizeStreamProfile = (raw = {}) => {
  const { codec, smart, browserNative } = normalizeCodec(raw.codec);
  const width = Number(raw.width) || 0;
  const height = Number(raw.height) || 0;
  return {
    key: String(raw.key ?? "").trim(),
    label: String(raw.label ?? "").trim(),
    codec,
    codec_smart: smart,
    browser_native: browserNative,
    width,
    height,
    fps: Number(raw.fps) || 0,
    // kbps. The single most useful number for selection, and the one a device
    // reports most reliably.
    bitrate_kbps: Number(raw.bitrateKbps ?? raw.bitrate_kbps) || 0,
    pixels: width * height,
  };
};

export const normalizeStreamProfiles = (list = []) =>
  (Array.isArray(list) ? list : [])
    .map(normalizeStreamProfile)
    .filter((profile) => profile.key);

/** Purposes a caller can ask for. Deliberately about intent, not stream names. */
export const STREAM_PURPOSES = Object.freeze({
  GRID: "grid",
  FULLSCREEN: "fullscreen",
  SNAPSHOT: "snapshot",
  PLAYBACK: "playback",
});

/**
 * Estimated cost of showing `profile` in a tile.
 *
 * Falls back to a pixel-rate estimate when the device does not report a bitrate,
 * because selecting on a missing number would silently prefer whichever profile
 * happened to omit it.
 */
export const estimateBitrateKbps = (profile) => {
  if (profile.bitrate_kbps > 0) return profile.bitrate_kbps;
  const pixels = profile.pixels || 0;
  const fps = profile.fps || 15;
  if (!pixels) return 1024;
  // ~0.08 bits per pixel per frame for H.264 at surveillance quality.
  return Math.round((pixels * fps * 0.08) / 1000);
};

/**
 * Pick the best profile for a purpose within a budget.
 *
 * @param {object} options
 * @param {Array}  options.profiles       discovered profiles for this channel
 * @param {string} options.purpose        one of STREAM_PURPOSES
 * @param {number} options.tileCount      how many tiles share the budget
 * @param {number} options.budgetKbps     total budget for the whole view
 * @param {boolean} options.allowTranscode whether a non-native codec is usable
 *
 * @returns {{ profile: object, reason: string }}
 */
export const selectStreamProfile = ({
  profiles = [],
  purpose = STREAM_PURPOSES.GRID,
  tileCount = 1,
  budgetKbps = 0,
  allowTranscode = false,
} = {}) => {
  const available = normalizeStreamProfiles(profiles);
  if (!available.length) {
    throw new SurveillanceError("no stream profiles discovered for this channel", {
      code: SURVEILLANCE_ERROR_CODES.CAPABILITY_UNKNOWN,
      status: 409,
      details: { purpose },
    });
  }

  // Playable at all. A non-native codec is only a candidate when the caller is
  // willing to pay for transcoding — which the grid never is.
  const playable = available.filter((profile) => profile.browser_native || allowTranscode);
  if (!playable.length) {
    throw new SurveillanceError("no browser-playable stream profile on this channel", {
      code: SURVEILLANCE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
      status: 409,
      details: {
        purpose,
        // Enough for the UI to say "this channel records H.265, which browsers
        // cannot play" rather than showing a broken tile.
        codecs: [...new Set(available.map((profile) => profile.codec))].filter(Boolean),
      },
    });
  }

  const tiles = Math.max(1, Number(tileCount) || 1);
  const perTileBudget = budgetKbps > 0 ? budgetKbps / tiles : 0;

  // Highest quality first; "quality" is pixels then fps then bitrate.
  const ranked = [...playable].sort(
    (a, b) => b.pixels - a.pixels || b.fps - a.fps || estimateBitrateKbps(b) - estimateBitrateKbps(a),
  );

  if (purpose === STREAM_PURPOSES.FULLSCREEN || purpose === STREAM_PURPOSES.PLAYBACK) {
    // One tile: take the best playable profile. A budget still applies if one
    // was given, but a single stream rarely breaches it.
    const within = perTileBudget > 0 ? ranked.find((p) => estimateBitrateKbps(p) <= perTileBudget) : null;
    return {
      profile: within || ranked[0],
      reason: within ? "best-within-budget" : "best-playable",
    };
  }

  if (purpose === STREAM_PURPOSES.SNAPSHOT) {
    return { profile: ranked[0], reason: "best-playable" };
  }

  // GRID. Fit the budget; if nothing fits, take the cheapest playable profile
  // rather than refusing — a degraded tile beats a blank one, and the caller is
  // told the budget was exceeded so the UI can say so.
  if (perTileBudget > 0) {
    const within = ranked.find((profile) => estimateBitrateKbps(profile) <= perTileBudget);
    if (within) return { profile: within, reason: "best-within-budget" };
    const cheapest = ranked[ranked.length - 1];
    return { profile: cheapest, reason: "over-budget-cheapest" };
  }

  // No budget declared: for a multi-tile view prefer the cheapest, for a single
  // tile prefer the best. This is where "grid = sub" would have been hardcoded;
  // instead it falls out of the tile count.
  return tiles > 1
    ? { profile: ranked[ranked.length - 1], reason: "cheapest-for-grid" }
    : { profile: ranked[0], reason: "best-playable" };
};

/**
 * Total estimated cost of a layout, for the UI's bandwidth hint and for the
 * per-tenant stream budget.
 */
export const estimateLayoutKbps = (selections = []) =>
  selections.reduce((total, profile) => total + estimateBitrateKbps(normalizeStreamProfile(profile)), 0);
