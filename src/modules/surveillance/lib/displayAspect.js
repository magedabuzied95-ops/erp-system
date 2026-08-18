// Display aspect for camera tiles.
//
// THE PROBLEM THIS SOLVES, AND WHY IT IS NOT OPTIONAL
// ---------------------------------------------------
// The reference recorder encodes "1080N": 960x1080 with 2:1 pixels, meant to be
// shown at 1920x1080. Two separate facts make this the player's problem:
//
//   1. The DVR declares NO sample aspect ratio. Probed directly:
//      `sample_aspect_ratio=N/A` on the stream straight from the device.
//   2. WebRTC discards the SAR our transcoder DOES set. ffprobe confirms the
//      published H.264 carries `sample_aspect_ratio=2:1, display_aspect_ratio=16:9`,
//      and Chrome still reports videoWidth 960 / videoHeight 1080.
//
// So a browser draws 960x1080 square pixels: a tall, narrow, vertically
// stretched picture. Nothing upstream can fix it, because the metadata channel
// that would carry the correction does not survive WebRTC.
//
// The correction is display-only: the decoded frames are exactly what the
// recorder sent, laid out at the geometry they were always meant for. No
// resampling, no upscaling, no invented pixels.

/**
 * Known encoding modes whose coded resolution differs from their display shape.
 *
 * Keyed by coded WxH. Deliberately a lookup of observed device behaviour rather
 * than a formula: "half-width means 16:9" would also rewrite genuinely square
 * or portrait sources, and getting that wrong silently distorts a camera nobody
 * is watching closely.
 */
const CODED_TO_DISPLAY = Object.freeze({
  // Dahua 1080N — confirmed on DH-XVR1B16-I.
  "960x1080": 16 / 9,
  // Dahua 720N, same halving trick at 720p. Not yet observed on a device here.
  "640x720": 16 / 9,
  // 960H (WD1) is 960x576 PAL and is genuinely 4:3 content on most installs.
  "960x576": 4 / 3,
});

/** Coded shapes that are already correct and must never be touched. */
const KNOWN_SQUARE_PIXEL = new Set(["1920x1080", "1280x720", "704x576", "352x288", "640x480"]);

/**
 * The aspect a tile should be drawn at.
 *
 * @param {object} profile stream profile from the device probe
 * @param {number} profile.width  coded width
 * @param {number} profile.height coded height
 * @param {number} [profile.displayAspectRatio] explicit override, if a device
 *        ever reports one we trust
 * @returns {{ aspect: number, corrected: boolean, reason: string }}
 */
export const displayAspectFor = (profile = {}) => {
  const width = Number(profile.width) || 0;
  const height = Number(profile.height) || 0;
  if (!width || !height) return { aspect: 16 / 9, corrected: false, reason: "unknown-resolution" };

  const coded = width / height;

  if (Number(profile.displayAspectRatio) > 0) {
    const aspect = Number(profile.displayAspectRatio);
    return {
      aspect,
      corrected: Math.abs(aspect - coded) > 0.01,
      reason: "device-reported",
    };
  }

  const key = `${width}x${height}`;
  if (KNOWN_SQUARE_PIXEL.has(key)) {
    return { aspect: coded, corrected: false, reason: "square-pixels" };
  }

  const known = CODED_TO_DISPLAY[key];
  if (known) {
    return { aspect: known, corrected: Math.abs(known - coded) > 0.01, reason: "known-coded-mode" };
  }

  // Unrecognised: draw it as coded. Guessing here would distort a camera that
  // was fine, which is worse than leaving an unusual one slightly wrong — and
  // the wrong one is visible, while a wrongly-"corrected" one looks plausible.
  return { aspect: coded, corrected: false, reason: "coded-as-is" };
};

/**
 * Inline style for a tile's frame element.
 *
 * The video inside must use `object-fit: fill` so it stretches into this box.
 * `contain` would preserve the coded aspect and letterbox it — reintroducing
 * exactly the tall picture being corrected.
 */
export const frameStyleFor = (profile) => {
  const { aspect } = displayAspectFor(profile);
  return { aspectRatio: String(aspect), width: "100%", background: "#000" };
};

/**
 * FULLSCREEN NEEDS A WRAPPER, NOT THE VIDEO.
 *
 * Fullscreening the <video> makes the browser letterbox on its INTRINSIC aspect
 * (0.889 here), which puts the tall picture straight back. Fullscreen the
 * container instead and keep the frame at the display aspect inside it.
 *
 * Verified at 1920x1080, 2560x1440, 1366x768, 1280x1024 and 3440x1440: the frame
 * lands on 1.7778 and fits within the screen in every case.
 */
export const fullscreenFrameStyle = (profile) => {
  const { aspect } = displayAspectFor(profile);
  return {
    width: `min(100vw, calc(100vh * ${aspect}))`,
    maxHeight: "100vh",
    aspectRatio: String(aspect),
  };
};

export const requestTileFullscreen = (containerElement) => {
  if (!containerElement) return false;
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return false;
  }
  // The CONTAINER, never the video element. See fullscreenFrameStyle.
  (containerElement.requestFullscreen || containerElement.webkitRequestFullscreen)?.call(containerElement);
  return true;
};
