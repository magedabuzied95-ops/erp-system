import sharp from "sharp";

import {
  THERMAL_ARTWORK_DEFAULTS,
  THERMAL_ARTWORK_STYLES,
  normalizeThermalInkLevel,
  normalizeThermalStyle,
} from "../../shared/thermalArtworkSettings.js";

/**
 * Local thermal artwork engine.
 *
 * Turns an ordinary product photo into the pure black-and-white artwork a
 * 203 dpi direct thermal label printer can burn, without calling OpenAI or any
 * other external model. Everything here is plain image processing on top of
 * sharp: flood-fill background removal, percentile contrast stretch, a Sauvola
 * adaptive threshold (or Floyd-Steinberg / Sobel / silhouette), speckle
 * removal, and a tight auto-crop that fills the label slot.
 *
 * The pipeline is deliberately deterministic: the same photo and the same
 * options always produce the same bytes, so the caller's file cache stays
 * meaningful.
 */

export const THERMAL_LOCAL_ENGINE_VERSION = "v3-local-lineart";

export const THERMAL_LOCAL_STYLES = THERMAL_ARTWORK_STYLES;
export const DEFAULT_THERMAL_LOCAL_STYLE = THERMAL_ARTWORK_DEFAULTS.style;

// Match the dot grid the head actually burns. The image slot on a 50x100mm
// label is roughly 47mm wide, which is ~376 dots at 203 dpi; rendering far
// above that and letting the browser scale down averages the artwork back into
// grey and then re-thresholds it, which is what turned dark products into
// featureless blobs on the label.
const DEFAULT_CANVAS = 448;
// Below this share of dark pixels the product reads as line art; at or above it
// the interior is a solid mass that only halftone can carry. Measured across
// the catalogue the two groups sit at <=0.50 and >=0.69, so the cut is wide.
const AUTO_STYLE_DARK_SHARE = 0.6;
const AUTO_STYLE_DARK_LEVEL = 96;
// Between this and the halftone cut the shoe carries enough black trim that the
// sketch would fill it as solid blobs; the adaptive threshold keeps its texture.
const AUTO_STYLE_TRIM_SHARE = 0.35;
const DEFAULT_FILL = 0.94;
const DEFAULT_BACKGROUND_THRESHOLD = 238;
const SAUVOLA_K = 0.2;
const SAUVOLA_R = 128;
// A label that is nearly blank cannot be read across a stockroom, and one that
// is nearly solid burns the head and smears. Both bounds retry with a nudged
// threshold instead of shipping the bad frame.
const INK_RATIO_MIN = 0.045;
const INK_RATIO_MAX = 0.5;
const INK_RETRY_STEP = 26;
const INK_RETRY_PASSES = 5;
const HALFTONE_TONE_STEPS = 7;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toOdd = (value) => (value % 2 === 0 ? value + 1 : value);

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Internal only: the illustration service's page comes back through the
// engine under this style. It is never offered in settings, and it must not be
// normalised away — coerced to "auto" it would re-enter the service and loop.
const INTERNAL_STYLES = new Set(["traced"]);

export const normalizeThermalLocalOptions = (options = {}) => {
  const requested = String(options.style || "").trim().toLowerCase();
  return {
    style: INTERNAL_STYLES.has(requested) ? requested : normalizeThermalStyle(requested),
    canvas: clamp(Math.round(numberOr(options.canvas, DEFAULT_CANVAS)), 256, 2048),
    fill: clamp(numberOr(options.fill, DEFAULT_FILL), 0.5, 1),
    // 0 = lightest possible burn, 100 = heaviest. 50 is the neutral setting.
    inkLevel: normalizeThermalInkLevel(options.inkLevel),
    backgroundThreshold: clamp(Math.round(numberOr(options.backgroundThreshold, DEFAULT_BACKGROUND_THRESHOLD)), 150, 254),
    despeckle: options.despeckle !== false,
    outline: options.outline !== false,
    // Internal: the cut level for the "traced" style, 0 = its default.
    tracedLevel: clamp(Math.round(numberOr(options.tracedLevel, 0)), 0, 255),
    // Keep only the front shoe when a second one stands behind it.
    singleItem: options.singleItem !== false && String(options.singleItem ?? "").toLowerCase() !== "false",
  };
};

/** A stable string for cache keys: any option change must produce new artwork. */
export const thermalLocalOptionsFingerprint = (options = {}) => {
  const normalized = normalizeThermalLocalOptions(options);
  return [
    THERMAL_LOCAL_ENGINE_VERSION,
    normalized.style,
    normalized.canvas,
    normalized.fill,
    normalized.inkLevel,
    normalized.backgroundThreshold,
    normalized.despeckle ? "despeckle" : "raw",
    normalized.outline ? "outline" : "flat",
    normalized.singleItem ? "single" : "all",
  ].join(":");
};

const readGrayscale = async (input, canvas) => {
  const { data, info } = await sharp(input, { animated: false, failOn: "none" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: canvas, height: canvas, fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  const channels = Number(info.channels || 3);
  if (!width || !height) return null;

  // Keep the colour plane too: the line-drawing model wants RGB, while every
  // filter here works on luminance.
  const pixels = width * height;
  const gray = new Uint8Array(pixels);
  const rgb = new Uint8Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels;
    const red = data[offset];
    const green = channels > 1 ? data[offset + 1] : red;
    const blue = channels > 2 ? data[offset + 2] : red;
    rgb[index * 3] = red;
    rgb[(index * 3) + 1] = green;
    rgb[(index * 3) + 2] = blue;
    gray[index] = Math.round((red * 0.299) + (green * 0.587) + (blue * 0.114));
  }
  return { gray, rgb, width, height };
};

/**
 * Everything reachable from the frame edge through near-white pixels is the
 * studio backdrop. Interior white — a white midsole, the gap inside a handle —
 * is unreachable, so it survives as part of the subject, which is exactly what
 * a naive "white is background" threshold gets wrong.
 */
const floodBackground = (gray, width, height, threshold, inset = 0) => {
  const total = width * height;
  const background = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;

  const push = (index) => {
    if (background[index]) return;
    if (gray[index] < threshold) return;
    background[index] = 1;
    stack[top] = index;
    top += 1;
  };

  const seedLeft = clamp(inset, 0, Math.floor((width - 1) / 2));
  const seedTop = clamp(inset, 0, Math.floor((height - 1) / 2));
  const seedRight = width - 1 - seedLeft;
  const seedBottom = height - 1 - seedTop;

  for (let x = seedLeft; x <= seedRight; x += 1) {
    push((seedTop * width) + x);
    push((seedBottom * width) + x);
  }
  for (let y = seedTop; y <= seedBottom; y += 1) {
    push((y * width) + seedLeft);
    push((y * width) + seedRight);
  }

  while (top > 0) {
    top -= 1;
    const index = stack[top];
    const y = Math.floor(index / width);
    const x = index - (y * width);
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  return background;
};

/**
 * Keep only the front shoe.
 *
 * Point prompts come from the subject box: three inside the lower part of the
 * box (the front shoe lies there), one near the top (the pair stands there).
 * Of the model's three candidate masks the largest confident one wins. Two
 * guards keep this from harming a photo it does not apply to: a mask that
 * covers almost all of the subject means there was one shoe to begin with,
 * and a mask that covers too little means the points missed — both leave the
 * photo untouched.
 *
 * Removed pixels are folded into `background` and painted white in `rgb`, so
 * neither the drawing model nor the illustration service sees the pair.
 */
const SINGLE_ITEM_KEEP_MIN = 0.3;
const SINGLE_ITEM_KEEP_MAX = 0.85;
// The Shox pair scored just under 0.75 on the production (WebAssembly) runtime
// and was left as a pair; the share and position guards below are what
// actually protect the product, so the confidence bar can sit lower.
const SINGLE_ITEM_MIN_IOU = 0.65;
// The segmentation model sees the photo decoded fresh at this size, not the
// label canvas upscaled: fed the 448 px canvas it lumped the pair together
// with the front shoe, fed a clean 512 px decode it separates them.
const SINGLE_ITEM_LONG_SIDE = 512;
// The front shoe lies in the lower part of the subject box; the pair stands
// above it. The box prompt starts this far down the subject.
const SINGLE_ITEM_BOX_TOP = 0.38;

const isolateFrontItem = async (input, rgb, gray, width, height, background, bounds) => {
  const { isSegmentModelAvailable, segmentFromPoints } = await import("./thermalSegmentModel.js");
  if (!(await isSegmentModelAvailable())) return { applied: false, reason: "unavailable" };

  const { data: segData, info: segInfo } = await sharp(input, { animated: false, failOn: "none" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: SINGLE_ITEM_LONG_SIDE, height: SINGLE_ITEM_LONG_SIDE, fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const segWidth = Number(segInfo.width || 0);
  const segHeight = Number(segInfo.height || 0);
  if (!segWidth || !segHeight) return { applied: false, reason: "decode-failed" };
  // Both grids are "inside" fits of the same photo, so one factor maps them.
  const scale = segWidth / width;
  const segChannels = Number(segInfo.channels || 3);
  const segRgb = new Uint8Array(segWidth * segHeight * 3);
  for (let index = 0; index < segWidth * segHeight; index += 1) {
    segRgb[index * 3] = segData[index * segChannels];
    segRgb[(index * 3) + 1] = segData[(index * segChannels) + 1];
    segRgb[(index * 3) + 2] = segData[(index * segChannels) + 2];
  }

  const left = bounds.left * scale;
  const top = bounds.top * scale;
  const right = (bounds.left + bounds.width - 1) * scale;
  const bottom = (bounds.top + bounds.height - 1) * scale;
  const spanY = bottom - top;
  // A box prompt over the lower part of the subject (labels 2 and 3 are the
  // box corners). Point prompts inside the front shoe, even with negatives on
  // the one behind, returned the pair as one object every time; the box
  // returns the front shoe on its own, tongue and collar included.
  const points = [
    [Math.round(left), Math.round(top + (spanY * SINGLE_ITEM_BOX_TOP)), 2],
    [Math.round(right), Math.round(bottom), 3],
  ];

  try {
    const result = await segmentFromPoints({ rgb: segRgb, width: segWidth, height: segHeight, points });
    let subjectPixels = 0;
    for (let index = 0; index < background.length; index += 1) if (!background[index]) subjectPixels += 1;
    if (!subjectPixels) return { applied: false, reason: "empty" };

    // Bring each candidate back to the canvas grid before measuring it
    // against the subject.
    const candidates = [];
    for (let k = 0; k < result.masks.length; k += 1) {
      if (result.ious[k] < SINGLE_ITEM_MIN_IOU) continue;
      const plane = new Uint8Array(result.masks[k].length);
      for (let index = 0; index < plane.length; index += 1) plane[index] = result.masks[k][index] ? 255 : 0;
      const back = await resizePlane(plane, result.width, result.height, width, height, sharp.kernel.nearest);
      const mask = new Uint8Array(width * height);
      let area = 0;
      for (let index = 0; index < mask.length; index += 1) {
        mask[index] = back[index] >= 128 ? 1 : 0;
        if (mask[index] && !background[index]) area += 1;
      }
      candidates.push({ mask, area, iou: result.ious[k] });
    }
    if (process.env.THERMAL_DEBUG_SINGLE) {
      console.log("SINGLE_ITEM_DEBUG", { segWidth, segHeight, points, ious: result.ious.map((v) => Number(v.toFixed(3))), areas: candidates.map((c) => c.area), subjectPixels });
    }
    if (!candidates.length) return { applied: false, reason: "no-confident-mask", runtime: result.runtime, durationMs: result.durationMs };
    // The model's own confidence picks; when two are within a hair, the
    // larger one is the whole shoe rather than the shoe minus its tongue.
    candidates.sort((a, b) => (Math.abs(b.iou - a.iou) < 0.02 ? b.area - a.area : b.iou - a.iou));
    const chosenArea = candidates[0].area;

    const keepShare = chosenArea / subjectPixels;
    if (keepShare > SINGLE_ITEM_KEEP_MAX) return { applied: false, reason: "already-single", keepShare, runtime: result.runtime, durationMs: result.durationMs };
    if (keepShare < SINGLE_ITEM_KEEP_MIN) return { applied: false, reason: "mask-too-small", keepShare, runtime: result.runtime, durationMs: result.durationMs };

    // Close pin holes in the kept mask, then fold everything else into the backdrop.
    let keep = candidates[0].mask;
    keep = dilateInk(keep, width, height, 2);
    keep = erodeInk(keep, width, height, 2);

    // What goes must be the shoe standing behind: its pixels sit above the
    // front shoe. If most of the would-be removed area is not in the upper
    // part of the subject box, the model split the product itself and the
    // photo is left alone.
    const upperCut = bounds.top + Math.round(bounds.height * 0.55);
    let removedTotal = 0;
    let removedUpper = 0;
    for (let index = 0; index < background.length; index += 1) {
      if (background[index] || keep[index]) continue;
      removedTotal += 1;
      if (Math.floor(index / width) < upperCut) removedUpper += 1;
    }
    if (removedTotal && removedUpper / removedTotal < 0.7) {
      return { applied: false, reason: "removed-not-above", keepShare, runtime: result.runtime, durationMs: result.durationMs };
    }
    let removed = 0;
    for (let index = 0; index < background.length; index += 1) {
      if (background[index] || keep[index]) continue;
      background[index] = 1;
      removed += 1;
      rgb[index * 3] = 255;
      rgb[(index * 3) + 1] = 255;
      rgb[(index * 3) + 2] = 255;
      gray[index] = 255;
    }
    return { applied: true, reason: "", keepShare, removed, runtime: result.runtime, durationMs: result.durationMs };
  } catch (error) {
    console.warn("[thermal-artwork] single-item segmentation failed, keeping the whole photo", { message: error?.message || String(error) });
    return { applied: false, reason: `error: ${error?.message || String(error)}` };
  }
};

/**
 * Split the non-background pixels into blobs and keep only the ones that are
 * really the product. Two things get thrown away: dust and JPEG noise, and the
 * faint frame some supplier photos carry — a ring that spans the whole canvas
 * but fills almost none of it, which would otherwise pin the crop to the full
 * frame and get traced as a dashed border.
 *
 * Discarded blobs are folded back into the background so the rest of the
 * pipeline never sees them.
 */
/**
 * Peel the floor shadow off the subject mask.
 *
 * A studio shadow is neutral grey, sits in the lower part of the product's
 * box, is nowhere near anything dark (the sole always has a dark edge or
 * tread, the shadow floats a few pixels below it), and touches the backdrop.
 * Every pixel that satisfies all four and can be reached from the backdrop
 * through pixels like it is folded back into the background. A guard reverts
 * the whole thing if it would eat a large share of the product — a shadow is
 * small next to a shoe, so a big bite means the rule caught the product.
 *
 * @returns {number} pixels removed (0 when reverted or nothing matched)
 */
const removeFloorShadow = (gray, rgb, width, height, background, bounds) => {
  const total = width * height;
  // A shadow is never taller than this share of the product; a longer run of
  // "shadow-like" pixels is a white side panel and must stay.
  const maxRun = Math.max(6, Math.round(bounds.height * 0.28));
  const bandTop = bounds.top + Math.round(bounds.height * 0.45);

  const isShadowLike = (index, below) => {
    const value = gray[index];
    if (value < 150) return false;
    const offset = index * 3;
    const red = rgb[offset];
    const green = rgb[offset + 1];
    const blue = rgb[offset + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 30) return false;
    // Shadows fade smoothly; a jump means a seam, an edge, a sole line.
    return below < 0 || Math.abs(value - gray[below]) <= 12;
  };

  // Peel upward from the bottom edge of the mask, one column at a time. The
  // walk stops at the first pixel that is not shadow-like — the sole's dark
  // contact line, a coloured outsole, a stitched edge — so the product's own
  // white panels are never reached from below.
  const removed = new Uint8Array(total);
  let count = 0;
  let subjectPixels = 0;
  for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
    let y = bounds.top + bounds.height - 1;
    // Find the bottom of the subject in this column.
    while (y >= bounds.top && background[(y * width) + x]) y -= 1;
    if (y < bounds.top) continue;
    const columnBottom = y;
    let columnPixels = 0;
    for (let yy = bounds.top; yy <= columnBottom; yy += 1) {
      if (!background[(yy * width) + x]) columnPixels += 1;
    }
    subjectPixels += columnPixels;
    if (columnBottom < bandTop) continue;

    let run = 0;
    let below = -1;
    while (y >= bounds.top) {
      const index = (y * width) + x;
      if (background[index] || !isShadowLike(index, below)) break;
      run += 1;
      below = index;
      y -= 1;
    }
    const reachedTop = y < bounds.top || background[(y * width) + x];
    // A column that is shadow all the way through (the ellipse spilling out
    // beside the shoe) is removed whole; otherwise the run must be short. A
    // run of one or two pixels is the anti-aliased fringe of the sole itself.
    if (run < 3 || (!reachedTop && run > maxRun)) continue;
    for (let yy = columnBottom; yy > columnBottom - run; yy -= 1) {
      removed[(yy * width) + x] = 1;
    }
    count += run;
  }

  if (!count || count > subjectPixels * 0.3) return 0;
  for (let index = 0; index < total; index += 1) {
    if (removed[index]) background[index] = 1;
  }
  return count;
};

const keepProductComponents = (background, width, height) => {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const component = new Int32Array(total);
  const minArea = Math.max(48, Math.round(total * 0.0005));
  const kept = [];

  for (let start = 0; start < total; start += 1) {
    if (background[start] || visited[start]) continue;

    let top = 0;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    visited[start] = 1;
    stack[top] = start;
    top += 1;

    while (top > 0) {
      top -= 1;
      const index = stack[top];
      component[size] = index;
      size += 1;
      const y = Math.floor(index / width);
      const x = index - (y * width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !background[index - 1] && !visited[index - 1]) { visited[index - 1] = 1; stack[top] = index - 1; top += 1; }
      if (x < width - 1 && !background[index + 1] && !visited[index + 1]) { visited[index + 1] = 1; stack[top] = index + 1; top += 1; }
      if (y > 0 && !background[index - width] && !visited[index - width]) { visited[index - width] = 1; stack[top] = index - width; top += 1; }
      if (y < height - 1 && !background[index + width] && !visited[index + width]) { visited[index + width] = 1; stack[top] = index + width; top += 1; }
    }

    const boxWidth = (maxX - minX) + 1;
    const boxHeight = (maxY - minY) + 1;
    const spansCanvas = boxWidth >= Math.floor(width * 0.92) && boxHeight >= Math.floor(height * 0.92);
    const hollow = size < (boxWidth * boxHeight * 0.2);
    const discard = size < minArea || (spansCanvas && hollow);

    if (discard) {
      for (let i = 0; i < size; i += 1) background[component[i]] = 1;
      continue;
    }
    kept.push({ minX, minY, maxX, maxY, size });
  }

  if (!kept.length) return null;

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (const blob of kept) {
    if (blob.minX < left) left = blob.minX;
    if (blob.minY < top) top = blob.minY;
    if (blob.maxX > right) right = blob.maxX;
    if (blob.maxY > bottom) bottom = blob.maxY;
  }
  return { left, top, width: (right - left) + 1, height: (bottom - top) + 1, components: kept.length };
};

const cropPlane = (source, width, bounds, stride = 1) => {
  const out = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceRow = ((bounds.top + y) * width) + bounds.left;
    const targetRow = y * bounds.width;
    for (let x = 0; x < bounds.width; x += 1) {
      out[targetRow + x] = source[(sourceRow + x) * stride];
    }
  }
  return out;
};

const rawBuffer = (plane) => Buffer.from(plane.buffer, plane.byteOffset, plane.byteLength);

/**
 * Resize a single-channel plane. sharp hands a one-channel raw input back as
 * three interleaved sRGB channels, so the result is de-interleaved rather than
 * trusted to still be one byte per pixel.
 */
const resizePlane = async (plane, width, height, targetWidth, targetHeight, kernel) => {
  if (width === targetWidth && height === targetHeight) return plane;
  const { data, info } = await sharp(rawBuffer(plane), { raw: { width, height, channels: 1 } })
    .resize({ width: targetWidth, height: targetHeight, fit: "fill", kernel })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = Number(info.channels || 1);
  const pixels = targetWidth * targetHeight;
  const out = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    out[index] = data[index * channels];
  }
  return out;
};

/**
 * Stretch the subject's own tonal range to full black-to-white. Product photos
 * are shot bright and flat; without this the adaptive threshold has almost no
 * contrast to work with and the shoe prints as a ghost.
 */
const stretchSubjectContrast = (gray, background) => {
  const histogram = new Uint32Array(256);
  let subjectCount = 0;
  for (let index = 0; index < gray.length; index += 1) {
    if (background[index]) continue;
    histogram[gray[index]] += 1;
    subjectCount += 1;
  }
  if (subjectCount < 32) return { gray, subjectCount };

  const lowCut = Math.floor(subjectCount * 0.02);
  const highCut = Math.floor(subjectCount * 0.02);
  let low = 0;
  let high = 255;
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value];
    if (seen > lowCut) {
      low = value;
      break;
    }
  }
  seen = 0;
  for (let value = 255; value >= 0; value -= 1) {
    seen += histogram[value];
    if (seen > highCut) {
      high = value;
      break;
    }
  }
  if (high - low < 8) return { gray, subjectCount };

  const scale = 255 / (high - low);
  const stretched = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    if (background[index]) {
      stretched[index] = 255;
      continue;
    }
    stretched[index] = clamp(Math.round((gray[index] - low) * scale), 0, 255);
  }
  return { gray: stretched, subjectCount };
};

const buildIntegrals = (gray, width, height) => {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sumSquares = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSumSquares = 0;
    const sourceRow = y * width;
    const targetRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      const value = gray[sourceRow + x];
      rowSum += value;
      rowSumSquares += value * value;
      sum[targetRow + x + 1] = sum[previousRow + x + 1] + rowSum;
      sumSquares[targetRow + x + 1] = sumSquares[previousRow + x + 1] + rowSumSquares;
    }
  }
  return { sum, sumSquares, stride };
};

/**
 * Sauvola adaptive threshold. A global cut turns a dark shoe into a solid blob
 * and a pale one into nothing; Sauvola judges each pixel against its own
 * neighbourhood, so laces, stitching and sole grooves survive as line work.
 */
const sauvolaBinarize = (gray, width, height, background, bias) => {
  const window = clamp(toOdd(Math.round(Math.min(width, height) / 8)), 15, 151);
  const radius = (window - 1) / 2;
  const { sum, sumSquares, stride } = buildIntegrals(gray, width, height);
  const ink = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      if (background[index]) continue;
      const value = gray[index];
      if (value >= 250) continue;

      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = ((y1 + 1) * stride) + x1 + 1;
      const b = (y0 * stride) + x1 + 1;
      const c = ((y1 + 1) * stride) + x0;
      const d = (y0 * stride) + x0;
      const windowSum = sum[a] - sum[b] - sum[c] + sum[d];
      const windowSumSquares = sumSquares[a] - sumSquares[b] - sumSquares[c] + sumSquares[d];
      const mean = windowSum / area;
      const variance = Math.max(0, (windowSumSquares / area) - (mean * mean));
      const deviation = Math.sqrt(variance);
      const threshold = (mean * (1 + (SAUVOLA_K * ((deviation / SAUVOLA_R) - 1)))) + bias;
      if (value < threshold) ink[index] = 1;
    }
  }
  return ink;
};

/**
 * Floyd-Steinberg error diffusion: photographic greys simulated in pure dots.
 *
 * Error diffusion is self-correcting, so moving the threshold barely changes how
 * much ink lands — the accumulated error drags the coverage straight back to
 * (255 - mean)/255. The only way to lighten or darken a halftone is to move the
 * tone itself before diffusing, which is what `tone` does: positive lifts the
 * product toward white, negative pushes it toward black.
 */
const halftoneBinarize = (gray, width, height, background, bias, tone = 0) => {
  const buffer = new Float32Array(gray.length);
  const shift = clamp(tone, -1, 1) * 0.75;
  for (let index = 0; index < gray.length; index += 1) {
    const value = gray[index];
    buffer[index] = shift >= 0
      ? 255 - ((255 - value) * (1 - shift))
      : value * (1 + shift);
  }
  const ink = new Uint8Array(gray.length);
  const cut = clamp(128 + bias, 24, 232);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    const leftToRight = y % 2 === 0;
    for (let step = 0; step < width; step += 1) {
      const x = leftToRight ? step : width - 1 - step;
      const index = rowOffset + x;
      if (background[index]) continue;
      const value = buffer[index];
      const black = value < cut;
      if (black) ink[index] = 1;
      const error = value - (black ? 0 : 255);
      const forward = leftToRight ? 1 : -1;

      const spread = (targetX, targetY, weight) => {
        if (targetX < 0 || targetX >= width || targetY >= height) return;
        const targetIndex = (targetY * width) + targetX;
        if (background[targetIndex]) return;
        buffer[targetIndex] += error * weight;
      };

      spread(x + forward, y, 7 / 16);
      spread(x - forward, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + forward, y + 1, 1 / 16);
    }
  }
  return ink;
};

/** Sobel gradient magnitude, cut at the subject's own mean + deviation. */
const edgeBinarize = (gray, width, height, background, bias) => {
  const magnitude = new Float32Array(gray.length);
  let sum = 0;
  let sumSquares = 0;
  let counted = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width) + x;
      const topLeft = gray[index - width - 1];
      const top = gray[index - width];
      const topRight = gray[index - width + 1];
      const left = gray[index - 1];
      const right = gray[index + 1];
      const bottomLeft = gray[index + width - 1];
      const bottom = gray[index + width];
      const bottomRight = gray[index + width + 1];
      const gx = (topRight + (2 * right) + bottomRight) - (topLeft + (2 * left) + bottomLeft);
      const gy = (bottomLeft + (2 * bottom) + bottomRight) - (topLeft + (2 * top) + topRight);
      const value = Math.sqrt((gx * gx) + (gy * gy));
      magnitude[index] = value;
      if (background[index]) continue;
      sum += value;
      sumSquares += value * value;
      counted += 1;
    }
  }

  const ink = new Uint8Array(gray.length);
  if (!counted) return ink;
  const mean = sum / counted;
  const deviation = Math.sqrt(Math.max(0, (sumSquares / counted) - (mean * mean)));
  const cut = Math.max(12, mean + deviation - (bias * 1.5));
  for (let index = 0; index < ink.length; index += 1) {
    if (background[index]) continue;
    if (magnitude[index] >= cut) ink[index] = 1;
  }
  return ink;
};

const silhouetteBinarize = (gray, width, height, background) => {
  const ink = new Uint8Array(gray.length);
  for (let index = 0; index < ink.length; index += 1) {
    if (!background[index]) ink[index] = 1;
  }
  return ink;
};

/** Run sharp's raster filters over a one-channel plane and get a plane back. */
const filterPlane = async (plane, width, height, apply) => {
  const pipeline = apply(sharp(rawBuffer(plane), { raw: { width, height, channels: 1 } }));
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const channels = Number(info.channels || 1);
  const out = new Uint8Array(width * height);
  for (let index = 0; index < out.length; index += 1) out[index] = data[index * channels];
  return out;
};

/**
 * Canny edges: Sobel gradient, non-maximum suppression down to one-pixel
 * ridges, then hysteresis so a contour that fades in the middle still connects
 * through its weak stretch instead of breaking into dashes. Thresholds come
 * from the subject's own gradient distribution, so a flat pale shoe and a
 * busy dark one get the same amount of line work.
 */
const cannyEdges = (gray, width, height, background, { highPercentile = 0.9, lowRatio = 0.4, highAbsolute = 0, lowAbsolute = 0 } = {}) => {
  const total = width * height;
  const magnitude = new Float32Array(total);
  const direction = new Uint8Array(total);
  const samples = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width) + x;
      const tl = gray[index - width - 1];
      const t = gray[index - width];
      const tr = gray[index - width + 1];
      const l = gray[index - 1];
      const r = gray[index + 1];
      const bl = gray[index + width - 1];
      const b = gray[index + width];
      const br = gray[index + width + 1];
      const gx = (tr + (2 * r) + br) - (tl + (2 * l) + bl);
      const gy = (bl + (2 * b) + br) - (tl + (2 * t) + tr);
      const value = Math.sqrt((gx * gx) + (gy * gy));
      magnitude[index] = value;
      // Quantise the gradient direction to the four neighbour axes.
      const angle = Math.atan2(gy, gx);
      const degrees = ((angle * 180) / Math.PI + 180) % 180;
      direction[index] = degrees < 22.5 || degrees >= 157.5 ? 0 : degrees < 67.5 ? 1 : degrees < 112.5 ? 2 : 3;
      if (!background[index] && value > 0) samples.push(value);
    }
  }

  const edges = new Uint8Array(total);
  if (!samples.length) return edges;
  samples.sort((a, b) => a - b);
  // Absolute thresholds when given: a percentile cut lets one black stripe
  // raise the bar above every pale seam on the same shoe. The percentile
  // stays as a floor so a flat, textureless photo does not fill with noise.
  const percentileHigh = Math.max(8, samples[Math.min(samples.length - 1, Math.floor(samples.length * highPercentile))]);
  const high = highAbsolute > 0 ? Math.max(highAbsolute, percentileHigh * 0.35) : percentileHigh;
  const low = lowAbsolute > 0 ? Math.min(lowAbsolute, high * 0.9) : high * lowRatio;

  // Non-maximum suppression: keep a pixel only if it is the ridge of its
  // gradient, compared against the two neighbours along the gradient direction.
  const ridge = new Uint8Array(total);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width) + x;
      const value = magnitude[index];
      if (value < low) continue;
      let a;
      let b;
      switch (direction[index]) {
        case 0: a = magnitude[index - 1]; b = magnitude[index + 1]; break;
        case 1: a = magnitude[index - width + 1]; b = magnitude[index + width - 1]; break;
        case 2: a = magnitude[index - width]; b = magnitude[index + width]; break;
        default: a = magnitude[index - width - 1]; b = magnitude[index + width + 1]; break;
      }
      if (value >= a && value >= b) ridge[index] = value >= high ? 2 : 1;
    }
  }

  // Hysteresis: strong ridges seed, weak ridges join only when connected.
  const stack = new Int32Array(total);
  let top = 0;
  for (let index = 0; index < total; index += 1) {
    if (ridge[index] !== 2 || edges[index]) continue;
    edges[index] = 1;
    stack[top] = index;
    top += 1;
    while (top > 0) {
      top -= 1;
      const current = stack[top];
      const y = Math.floor(current / width);
      const x = current - (y * width);
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = (ny * width) + nx;
          if (!ridge[next] || edges[next]) continue;
          edges[next] = 1;
          stack[top] = next;
          top += 1;
        }
      }
    }
  }

  return edges;
};

/** Drop edge fragments too short to describe anything — texture, glints, noise. */
const dropShortStrokes = (edges, width, height, minLength) => despeckleInk(edges, width, height, minLength, 8);

/**
 * Solid regions dark enough and large enough to be a design element — the
 * three stripes, a swoosh, a black heel tab — are filled rather than outlined,
 * so the brand still reads at a glance.
 */
const darkFills = (gray, width, height, background, { level = 60, minArea = 64 } = {}) => {
  const total = width * height;
  const dark = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (!background[index] && gray[index] < level) dark[index] = 1;
  }
  return despeckleInk(dark, width, height, minArea);
};

const dilateInk = (ink, width, height, radius = 1) => {
  const out = new Uint8Array(ink.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      if (!ink[index]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          out[(ny * width) + nx] = 1;
        }
      }
    }
  }
  return out;
};

/**
 * Fit Bézier curves to a stroke mask with potrace and return a standalone SVG
 * whose viewBox is the mask's pixel grid. Every stroke outline becomes a
 * smooth path; specks below `turdSize` pixels are dropped by the tracer.
 */
const traceStrokesToSvg = async (strokes, width, height, { strokeWidth = 0 } = {}) => {
  const potrace = (await import("potrace")).default;
  const png = await sharp(rawBuffer(strokes.map((value) => (value ? 0 : 255))), { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const tracer = new potrace.Potrace({
    threshold: 128,
    blackOnWhite: true,
    turdSize: Math.max(8, Math.round(width * height * 0.00004)),
    alphaMax: 1,
    optCurve: true,
    optTolerance: 0.2,
    turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY,
    color: "#000000",
    background: "transparent",
  });
  await new Promise((resolve, reject) => {
    tracer.loadImage(png, (error) => (error ? reject(error) : resolve()));
  });
  // Weight is added as a vector stroke on the traced outline rather than by
  // dilating pixels: the curves stay smooth, corners stay round, and two
  // strokes that run close together thicken toward each other without
  // fusing into one blob the way a raster dilation does.
  const weight = strokeWidth > 0
    ? ` stroke="#000000" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`
    : "";
  // potrace emits its own stroke="none"; drop it before adding ours.
  const pathTag = tracer.getPathTag()
    .replace(/\s+stroke="[^"]*"/g, "")
    .replace(/<path\b/, `<path${weight}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${pathTag}</svg>`;
};

/** Render an SVG at a target size and hand back one grey byte per pixel. */
const rasterizeSvgPlane = async (svg, width, height) => {
  const sized = svg.replace(/ width="\d+" height="\d+"/, ` width="${width}" height="${height}"`);
  const { data, info } = await sharp(Buffer.from(sized), { density: 96 })
    .resize({ width, height, fit: "fill" })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = Number(info.channels || 1);
  const plane = new Uint8Array(width * height);
  for (let index = 0; index < plane.length; index += 1) plane[index] = data[index * channels];
  return plane;
};

const erodeInk = (ink, width, height, radius = 1) => {
  const out = new Uint8Array(ink.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x;
      if (!ink[index]) continue;
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) { keep = 0; break; }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || !ink[(ny * width) + nx]) { keep = 0; break; }
        }
      }
      out[index] = keep;
    }
  }
  return out;
};

/**
 * Sketch: the illustrated look — clean contour lines of one weight on a white
 * body, with only the genuinely black design elements filled. Texture is
 * smoothed away before the edges are found, so leather grain and mesh do not
 * come through as scribble, and the strokes are rounded after dilation so the
 * head prints curves rather than staircases.
 */
const sketchBinarize = async (gray, width, height, background, { inkOffset = 0 } = {}) => {
  // Work at twice the label resolution and come back down at the end: the
  // downsample anti-aliases the strokes before the final threshold, which is
  // what turns pixel stairs into the smooth curves of a drawn illustration.
  const scale = 2;
  const w = width * scale;
  const h = height * scale;
  const bigGray = await resizePlane(gray, width, height, w, h, sharp.kernel.lanczos3);
  const maskPlane = new Uint8Array(background.length);
  for (let index = 0; index < maskPlane.length; index += 1) maskPlane[index] = background[index] ? 255 : 0;
  const bigMaskRaw = await resizePlane(maskPlane, width, height, w, h, sharp.kernel.nearest);
  const bigBackground = new Uint8Array(w * h);
  for (let index = 0; index < bigBackground.length; index += 1) bigBackground[index] = bigMaskRaw[index] >= 128 ? 1 : 0;

  // Enough smoothing to lose leather grain and mesh, not the seams.
  const smoothed = await filterPlane(bigGray, w, h, (image) => image.median(3).blur(1.0));

  // Ink level widens or narrows how much edge work survives. The thresholds
  // are in Sobel units on the smoothed plane: a seam between two whites sits
  // around 60-120, leather grain below 40, a black stripe edge well over 600.
  const highAbsolute = clamp(Math.round(72 - (inkOffset * 40)), 36, 160);
  const lowAbsolute = Math.round(highAbsolute * 0.35);
  let edges = cannyEdges(smoothed, w, h, bigBackground, { highPercentile: 0.8, highAbsolute, lowAbsolute });
  edges = dropShortStrokes(edges, w, h, Math.max(16, Math.round(Math.min(w, h) * 0.035)));

  const fills = darkFills(smoothed, w, h, bigBackground, {
    level: clamp(60 + (inkOffset * 25), 30, 110),
    minArea: Math.max(96, Math.round(w * h * 0.0015)),
  });

  // Three pixels here is a pixel and a half on the label: one clean stroke.
  const stroke = dilateInk(edges, w, h, 1);
  const combined = new Uint8Array(w * h);
  for (let index = 0; index < combined.length; index += 1) {
    if (bigBackground[index]) continue;
    if (stroke[index] || fills[index]) combined[index] = 1;
  }

  const plane = new Uint8Array(combined.length);
  for (let index = 0; index < plane.length; index += 1) plane[index] = combined[index] ? 0 : 255;
  const small = await resizePlane(plane, w, h, width, height, sharp.kernel.lanczos3);
  const ink = new Uint8Array(width * height);
  for (let index = 0; index < ink.length; index += 1) {
    if (!background[index] && small[index] < 150) ink[index] = 1;
  }
  return ink;
};

/** Trace the subject outline so the shape reads even when the interior is open. */
const reinforceOutline = (ink, background, width, height, thickness = 1) => {
  const boundary = new Uint8Array(ink.length);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      if (background[index]) continue;
      const edge =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        background[index - 1] || background[index + 1] ||
        background[index - width] || background[index + width];
      if (edge) boundary[index] = 1;
    }
  }
  for (let index = 0; index < ink.length; index += 1) {
    if (boundary[index]) ink[index] = 1;
  }
  if (thickness > 1) {
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        if (!boundary[rowOffset + x]) continue;
        for (let dy = -(thickness - 1); dy <= thickness - 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -(thickness - 1); dx <= thickness - 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (background[(ny * width) + nx]) continue;
            ink[(ny * width) + nx] = 1;
          }
        }
      }
    }
  }
  return ink;
};

/** Drop black islands too small to survive a print head — dust, JPEG noise. */
const despeckleInk = (ink, width, height, minArea, connectivity = 4) => {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const component = new Int32Array(total);
  // A one-pixel Canny ridge running diagonally touches its neighbours only at
  // the corners. Under 4-connectivity every pixel of it is its own island and
  // the whole line is thrown away as dust; strokes must be measured 8-connected.
  const diagonal = connectivity === 8;

  for (let start = 0; start < total; start += 1) {
    if (!ink[start] || visited[start]) continue;
    let top = 0;
    let size = 0;
    visited[start] = 1;
    stack[top] = start;
    top += 1;

    while (top > 0) {
      top -= 1;
      const index = stack[top];
      component[size] = index;
      size += 1;
      const y = Math.floor(index / width);
      const x = index - (y * width);
      const left = x > 0;
      const right = x < width - 1;
      const up = y > 0;
      const down = y < height - 1;
      if (left && ink[index - 1] && !visited[index - 1]) { visited[index - 1] = 1; stack[top] = index - 1; top += 1; }
      if (right && ink[index + 1] && !visited[index + 1]) { visited[index + 1] = 1; stack[top] = index + 1; top += 1; }
      if (up && ink[index - width] && !visited[index - width]) { visited[index - width] = 1; stack[top] = index - width; top += 1; }
      if (down && ink[index + width] && !visited[index + width]) { visited[index + width] = 1; stack[top] = index + width; top += 1; }
      if (diagonal) {
        if (up && left && ink[index - width - 1] && !visited[index - width - 1]) { visited[index - width - 1] = 1; stack[top] = index - width - 1; top += 1; }
        if (up && right && ink[index - width + 1] && !visited[index - width + 1]) { visited[index - width + 1] = 1; stack[top] = index - width + 1; top += 1; }
        if (down && left && ink[index + width - 1] && !visited[index + width - 1]) { visited[index + width - 1] = 1; stack[top] = index + width - 1; top += 1; }
        if (down && right && ink[index + width + 1] && !visited[index + width + 1]) { visited[index + width + 1] = 1; stack[top] = index + width + 1; top += 1; }
      }
    }

    if (size < minArea) {
      for (let i = 0; i < size; i += 1) ink[component[i]] = 0;
    }
  }
  return ink;
};

const inkRatio = (ink, background) => {
  let inkCount = 0;
  let subjectCount = 0;
  for (let index = 0; index < ink.length; index += 1) {
    if (background[index]) continue;
    subjectCount += 1;
    if (ink[index]) inkCount += 1;
  }
  if (!subjectCount) return 0;
  return inkCount / subjectCount;
};

/**
 * Choose between line art and halftone from the product's own tone, measured
 * before the contrast stretch normalises it away.
 */
const resolveAutoStyle = (gray, background) => {
  let dark = 0;
  let subject = 0;
  for (let index = 0; index < gray.length; index += 1) {
    if (background[index]) continue;
    subject += 1;
    if (gray[index] < AUTO_STYLE_DARK_LEVEL) dark += 1;
  }
  const darkShare = subject ? dark / subject : 0;
  // Three bands. A black shoe only survives as halftone. A shoe with a lot of
  // black trim keeps the texture inside that trim under the adaptive
  // threshold, where the sketch would fill it as blobs. A mostly pale shoe
  // gets the illustrated look: clean contours and only its real black
  // accents filled.
  const style = darkShare >= AUTO_STYLE_DARK_SHARE
    ? "halftone"
    : darkShare >= AUTO_STYLE_TRIM_SHARE
      ? "detail"
      : "sketch";
  return { style, darkShare };
};

/**
 * Lineart: the drawn look from the line-drawing model in thermalLineartModel.
 * The colour crop goes to the network at its own aspect ratio (long side 512,
 * dimensions rounded to the stride of the network), the returned ink map is
 * cut at a fixed level — the model already decided what is a stroke — and
 * masked to the product so a drawn floor shadow never reaches the label.
 */
const LINEART_MODEL_LONG_SIDE = 512;
const LINEART_MODEL_STRIDE = 8;
// Faint grey strokes in the model's map are hedges — texture it was unsure
// about. Cutting a little tighter keeps the confident black lines only, and
// the vector stroke below gives those the weight the label needs.
const LINEART_INK_CUT = 0.56;
const LINEART_STROKE_WEIGHT = 3;

const lineartBinarize = async (rgb, width, height, background, { inkOffset = 0 } = {}) => {
  const { result, modelWidth, modelHeight } = await computeLineartMap(rgb, width, height);

  // Ink level moves the cut: heavier keeps the model's fainter strokes.
  const baseCut = clamp(LINEART_INK_CUT + (inkOffset * 0.18), 0.35, 0.85);

  // The model's map is soft. Cutting it at model resolution and scaling down
  // leaves stair-stepped, broken strokes on the label. Instead the soft map is
  // enlarged first (smooth interpolation, no stairs), cut there, closed so the
  // small gaps between neighbouring strokes bridge, blurred and re-cut so the
  // corners round off like a pen line, and only then brought down to size.
  const upscale = 2;
  const bigWidth = result.width * upscale;
  const bigHeight = result.height * upscale;
  const mapPlane = new Uint8Array(result.width * result.height);
  for (let index = 0; index < mapPlane.length; index += 1) mapPlane[index] = Math.round(result.map[index] * 255);
  const bigMap = await resizePlane(mapPlane, result.width, result.height, bigWidth, bigHeight, sharp.kernel.lanczos3);

  const cutAt = async (cut) => {
    const level = Math.round(cut * 255);
    let strokes = new Uint8Array(bigWidth * bigHeight);
    for (let index = 0; index < strokes.length; index += 1) {
      strokes[index] = bigMap[index] < level ? 1 : 0;
    }
    // Closing: dilate then erode. Bridges hairline breaks and gives the
    // stroke a body that survives the downscale to the label's dot grid.
    strokes = dilateInk(strokes, bigWidth, bigHeight, 3);
    strokes = erodeInk(strokes, bigWidth, bigHeight, 2);

    // Vectorise the strokes: potrace fits Bézier curves to the outline of
    // every stroke, so the label gets true curves rather than pixel stairs,
    // and the same drawing can be rendered at any print size later.
    let svg = "";
    let plane;
    try {
      // Stroke weight in model-grid units (the viewBox): 3 here is about 1.3
      // dots at 203 dpi added around every line. Ink level moves it.
      const traced = await traceStrokesToSvg(strokes, bigWidth, bigHeight, {
        strokeWidth: clamp(LINEART_STROKE_WEIGHT + (inkOffset * 2.5), 0, 8),
      });
      plane = await rasterizeSvgPlane(traced, width, height);
      svg = traced;
    } catch (error) {
      console.warn("[thermal-artwork] vectorising failed, keeping the raster strokes", { message: error?.message || String(error) });
      const raster = new Uint8Array(strokes.length);
      for (let index = 0; index < raster.length; index += 1) raster[index] = strokes[index] ? 0 : 255;
      const rounded = await filterPlane(raster, bigWidth, bigHeight, (image) => image.blur(1.2));
      plane = await resizePlane(rounded, bigWidth, bigHeight, width, height, sharp.kernel.lanczos3);
    }

    let ink = new Uint8Array(width * height);
    for (let index = 0; index < ink.length; index += 1) {
      if (!background[index] && plane[index] < 150) ink[index] = 1;
    }
    ink = despeckleInk(ink, width, height, Math.max(8, Math.round(Math.min(width, height) * 0.02)), 8);
    return { ink, svg };
  };

  // A black shoe comes back as dense hatching. Tightening the cut keeps the
  // strong strokes and drops the faint ones, on the same map — no second run
  // of the network.
  let cut = baseCut;
  let traced = await cutAt(cut);
  let passes = 1;
  while (passes < 4 && inkRatio(traced.ink, background) > INK_RATIO_MAX && cut > 0.25) {
    cut = Math.max(0.2, cut - 0.1);
    traced = await cutAt(cut);
    passes += 1;
  }
  return { ink: traced.ink, svg: traced.svg, runtime: result.runtime, durationMs: result.durationMs, modelWidth, modelHeight, cut, passes };
};

/**
 * Run the line-drawing model over a colour crop and return its soft map at
 * model resolution (long side 512, sides rounded to the network stride).
 */
const computeLineartMap = async (rgb, width, height) => {
  const scale = LINEART_MODEL_LONG_SIDE / Math.max(width, height);
  const modelWidth = Math.max(LINEART_MODEL_STRIDE, Math.round((width * scale) / LINEART_MODEL_STRIDE) * LINEART_MODEL_STRIDE);
  const modelHeight = Math.max(LINEART_MODEL_STRIDE, Math.round((height * scale) / LINEART_MODEL_STRIDE) * LINEART_MODEL_STRIDE);

  const { data, info } = await sharp(rawBuffer(rgb), { raw: { width, height, channels: 3 } })
    .resize({ width: modelWidth, height: modelHeight, fit: "fill", kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = Number(info.channels || 3);
  const modelRgb = new Uint8Array(modelWidth * modelHeight * 3);
  for (let index = 0; index < modelWidth * modelHeight; index += 1) {
    modelRgb[index * 3] = data[index * channels];
    modelRgb[(index * 3) + 1] = data[(index * channels) + 1];
    modelRgb[(index * 3) + 2] = data[(index * channels) + 2];
  }

  const { renderLineartMap } = await import("./thermalLineartModel.js");
  const result = await renderLineartMap({ rgb: modelRgb, width: modelWidth, height: modelHeight });
  return { result, modelWidth, modelHeight };
};

/**
 * Traced: for an image that is already a clean drawing on white — the
 * illustration service's output. No model, no edge finding: cut the page at a
 * fixed level, close hairline gaps, and trace the strokes to vector with the
 * same pen weight the other drawing styles get.
 */
// The service's outlines are soft mid greys; cutting at 150 caught only their
// darkest cores and the label got dashes. 185 takes the whole stroke.
const TRACED_INK_LEVEL = 185;

/**
 * Turn filled masses into their outlines. A pen line is never wider than a
 * few pixels, so anything that survives an erosion by `halfWidth` is a fill:
 * the fill is removed and only a band of `halfWidth` at its edge is kept,
 * which is what an illustrator draws for a black panel — its contour.
 */
const hollowSolidRegions = (ink, width, height, halfWidth, minArea = 0) => {
  let core = erodeInk(ink, width, height, halfWidth);
  // Small solid shapes — three stripes, a swoosh, a heel tab — are design
  // elements an illustrator fills. Only masses larger than `minArea` are
  // hollowed; the small ones keep their fill.
  if (minArea > 0) core = despeckleInk(core, width, height, minArea, 8);
  let any = false;
  for (let index = 0; index < core.length; index += 1) {
    if (core[index]) { any = true; break; }
  }
  if (!any) return ink;
  // Grow the core back by (halfWidth - 1): the ring left between the grown
  // core and the original mass is the outline we keep.
  const inner = dilateInk(core, width, height, Math.max(0, halfWidth - 1));
  const out = new Uint8Array(ink.length);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = ink[index] && !inner[index] ? 1 : 0;
  }
  return out;
};

// The level the first accepted Samba drawing was cut at: strokes plus the
// solid accents, and the gum sole's hatching kept as tone.
const TRACED_INK_LEVEL_PALE = 150;

const tracedBinarize = async (gray, width, height, background, { inkOffset = 0, level: levelOverride = 0 } = {}) => {
  const upscale = 2;
  const bigWidth = width * upscale;
  const bigHeight = height * upscale;
  const big = await resizePlane(gray, width, height, bigWidth, bigHeight, sharp.kernel.lanczos3);
  const level = clamp(Math.round((levelOverride > 0 ? levelOverride : TRACED_INK_LEVEL) + (inkOffset * 50)), 60, 220);

  let strokes = new Uint8Array(bigWidth * bigHeight);
  for (let index = 0; index < strokes.length; index += 1) strokes[index] = big[index] < level ? 1 : 0;
  strokes = dilateInk(strokes, bigWidth, bigHeight, 3);
  strokes = erodeInk(strokes, bigWidth, bigHeight, 2);
  // A black shoe comes back from the illustration service as a black shoe.
  // Solid masses are not line work: keep only their edges, so the drawing
  // stays an outline drawing however dark the product is.
  strokes = hollowSolidRegions(
    strokes,
    bigWidth,
    bigHeight,
    Math.max(4, Math.round(Math.min(bigWidth, bigHeight) * 0.006)),
    Math.round(bigWidth * bigHeight * 0.015)
  );

  let svg = "";
  let plane;
  try {
    const traced = await traceStrokesToSvg(strokes, bigWidth, bigHeight, {
      strokeWidth: clamp(LINEART_STROKE_WEIGHT + (inkOffset * 2.5), 0, 8),
    });
    plane = await rasterizeSvgPlane(traced, width, height);
    svg = traced;
  } catch (error) {
    console.warn("[thermal-artwork] vectorising failed, keeping the raster strokes", { message: error?.message || String(error) });
    const raster = new Uint8Array(strokes.length);
    for (let index = 0; index < raster.length; index += 1) raster[index] = strokes[index] ? 0 : 255;
    plane = await resizePlane(raster, bigWidth, bigHeight, width, height, sharp.kernel.lanczos3);
  }

  let ink = new Uint8Array(width * height);
  for (let index = 0; index < ink.length; index += 1) {
    if (!background[index] && plane[index] < 150) ink[index] = 1;
  }
  ink = despeckleInk(ink, width, height, Math.max(8, Math.round(Math.min(width, height) * 0.02)), 8);
  return { ink, svg };
};

const binarizeForStyle = (style, gray, width, height, background, bias, tone = 0) => {
  if (style === "halftone") return halftoneBinarize(gray, width, height, background, bias, tone);
  if (style === "outline") return edgeBinarize(gray, width, height, background, bias);
  if (style === "silhouette") return silhouetteBinarize(gray, width, height, background);
  return sauvolaBinarize(gray, width, height, background, bias);
};

/**
 * Convert a product photo into print-ready thermal artwork.
 *
 * @returns {Promise<{ buffer: Buffer, meta: object }>}
 */
export const renderThermalArtwork = async (input, rawOptions = {}) => {
  const options = normalizeThermalLocalOptions(rawOptions);
  const loaded = await readGrayscale(input, options.canvas);
  if (!loaded) throw new Error("Thermal source image could not be decoded");

  const { gray, rgb, width, height } = loaded;

  const measureBackground = (mask) => {
    let pixels = 0;
    for (let index = 0; index < mask.length; index += 1) pixels += mask[index];
    return pixels / mask.length;
  };

  let background = floodBackground(gray, width, height, options.backgroundThreshold);
  let backgroundRatio = measureBackground(background);

  // A solid border — the thin frame some supplier photos carry, or a
  // letterboxed export — seals the backdrop off from the edge, so the flood
  // finds almost nothing. Seeding just inside that border reaches the real
  // backdrop instead of giving up and printing the whole frame.
  if (backgroundRatio < 0.03) {
    const inset = Math.max(3, Math.round(Math.min(width, height) * 0.02));
    const retry = floodBackground(gray, width, height, options.backgroundThreshold, inset);
    const retryRatio = measureBackground(retry);
    if (retryRatio > backgroundRatio) {
      background = retry;
      backgroundRatio = retryRatio;
    }
  }

  // A photo shot against a busy or dark backdrop leaves nothing to flood, and a
  // near-empty frame floods everything. Either way, fall back to the full frame
  // rather than cropping to noise.
  let backgroundRemoved = backgroundRatio >= 0.03 && backgroundRatio <= 0.985;
  let bounds = backgroundRemoved ? keepProductComponents(background, width, height) : null;
  if (!bounds || bounds.width < 16 || bounds.height < 16) {
    backgroundRemoved = false;
    background = new Uint8Array(background.length);
    bounds = { left: 0, top: 0, width, height };
  }

  // The soft floor shadow under the product is grey, so the flood left it as
  // part of the subject and it prints as an ellipse under the shoe. Peel it
  // off before cropping: see removeFloorShadow for what counts as shadow.
  let shadowRemoved = 0;
  if (backgroundRemoved) {
    shadowRemoved = removeFloorShadow(gray, rgb, width, height, background, bounds);
    if (shadowRemoved > 0) {
      bounds = keepProductComponents(background, width, height) || bounds;
    }
  }

  // One shoe on the label. When the photo has the pair standing behind the
  // front shoe, the segmentation model keeps the front one and the rest of
  // the subject joins the backdrop; the drawing step later completes what the
  // shoe behind was covering.
  let singleItem = { applied: false, reason: options.singleItem ? "" : "off" };
  if (options.singleItem && backgroundRemoved) {
    singleItem = await isolateFrontItem(input, rgb, gray, width, height, background, bounds);
    if (singleItem.applied) {
      bounds = keepProductComponents(background, width, height) || bounds;
    }
  }

  const pad = Math.max(2, Math.round(Math.min(bounds.width, bounds.height) * 0.01));
  const padded = {
    left: Math.max(0, bounds.left - pad),
    top: Math.max(0, bounds.top - pad),
  };
  padded.width = Math.min(width - padded.left, bounds.width + (2 * pad));
  padded.height = Math.min(height - padded.top, bounds.height + (2 * pad));

  const croppedGray = cropPlane(gray, width, padded);
  const croppedBackgroundRaw = cropPlane(background, width, padded);
  const croppedRgb = new Uint8Array(padded.width * padded.height * 3);
  for (let y = 0; y < padded.height; y += 1) {
    const sourceRow = (((padded.top + y) * width) + padded.left) * 3;
    croppedRgb.set(rgb.subarray(sourceRow, sourceRow + (padded.width * 3)), y * padded.width * 3);
  }

  const margin = Math.round((options.canvas * (1 - options.fill)) / 2);
  const artBox = Math.max(64, options.canvas - (2 * margin));
  const scale = artBox / Math.max(padded.width, padded.height);
  const artWidth = Math.max(16, Math.round(padded.width * scale));
  const artHeight = Math.max(16, Math.round(padded.height * scale));

  const scaledGray = await resizePlane(croppedGray, padded.width, padded.height, artWidth, artHeight, sharp.kernel.lanczos3);

  const maskSource = new Uint8Array(croppedBackgroundRaw.length);
  for (let index = 0; index < maskSource.length; index += 1) maskSource[index] = croppedBackgroundRaw[index] ? 255 : 0;
  const scaledMask = await resizePlane(maskSource, padded.width, padded.height, artWidth, artHeight, sharp.kernel.nearest);
  const scaledBackground = new Uint8Array(artWidth * artHeight);
  for (let index = 0; index < scaledBackground.length; index += 1) scaledBackground[index] = scaledMask[index] >= 128 ? 1 : 0;

  // The drawing model wins whenever it is installed: it is the only path that
  // draws what the photo merely implies. The tone-based pick stays as the
  // fallback for a box without the model, or a model that fails to run.
  const { isLineartModelAvailable } = await import("./thermalLineartModel.js");
  const modelAvailable = await isLineartModelAvailable();
  // The tone profile decides more than the automatic style: the illustration
  // service is driven differently for a black shoe than for a pale one.
  const toneProfile = resolveAutoStyle(scaledGray, scaledBackground);
  const darkProduct = toneProfile.darkShare >= AUTO_STYLE_DARK_SHARE;
  const auto = options.style === "auto" ? toneProfile : null;
  // Order of preference under "auto": the illustration service (a generative
  // redraw), then the local drawing model, then the tone-based filter pick.
  const { isDrawingServiceReady } = await import("./thermalDrawingClient.js");
  const serviceReady = options.style === "auto" || options.style === "diffusion" ? await isDrawingServiceReady() : false;
  let style = auto
    ? (serviceReady ? "diffusion" : modelAvailable ? "lineart" : auto.style)
    : options.style;
  let lineart = null;
  let lineartError = "";
  let diffusionError = "";

  const { gray: stretched, subjectCount } = stretchSubjectContrast(scaledGray, scaledBackground);

  // Ink level moves the knob each style actually responds to: the threshold for
  // the line-art family, the coverage target for halftone.
  const inkOffset = (options.inkLevel - 50) / 50;
  let tone = 0;
  let ink = null;

  if (style === "diffusion") {
    try {
      if (!modelAvailable) throw new Error("the drawing model is needed to guide the illustration service");
      const { result: control } = await computeLineartMap(croppedRgb, padded.width, padded.height);
      // A pale product gets the soft map: its greys carry the gum sole's tone
      // and the leather's texture, which the drawing keeps as hatching. A dark
      // product gets confident strokes only — its soft map is a field of grey
      // hatching that the diffusion model reads as "draw a dark textured shoe".
      const controlPlane = new Uint8Array(control.width * control.height);
      for (let index = 0; index < controlPlane.length; index += 1) {
        controlPlane[index] = darkProduct
          ? (control.map[index] < LINEART_INK_CUT ? 0 : 255)
          : Math.round(control.map[index] * 255);
      }
      const controlPng = await sharp(rawBuffer(controlPlane), { raw: { width: control.width, height: control.height, channels: 1 } })
        .png({ compressionLevel: 6 })
        .toBuffer();

      const { drawFromLineart } = await import("./thermalDrawingClient.js");
      const { LIGHT_PRODUCT_PROMPT, LIGHT_PRODUCT_NEGATIVE } = await import("./thermalDrawingClient.js");
      const drawn = await drawFromLineart({
        controlPng,
        seed: 1,
        // The service's own defaults are the "no fill" wording for dark
        // products; a pale product keeps its black accents filled.
        ...(darkProduct ? {} : { prompt: LIGHT_PRODUCT_PROMPT, negativePrompt: LIGHT_PRODUCT_NEGATIVE }),
      });

      // The service hands back a finished drawing on a near-white page. Treat
      // it as a fresh source: the same backdrop flood, shadow peel and crop
      // apply, and the line-drawing model runs over it — on a clean, simply
      // shaded illustration it returns continuous bold strokes with every
      // panel and seam, where a fixed cut of the page caught only the darkest
      // cores and left dashes. "traced" remains the fallback for a box
      // without the model.
      const page = await sharp(drawn.png).normalise({ lower: 1, upper: 99 }).png().toBuffer();
      // Pale products: cut the page directly — fills stay solid and the
      // sole's hatching reads as tone. Dark products: the line-drawing model
      // over the page, which gives continuous strokes where a cut of their
      // soft grey outlines left dashes.
      const postStyle = darkProduct && modelAvailable ? "lineart" : "traced";
      // singleItem off for the page: it already shows one shoe, and the box
      // prompt over a lone shoe keeps only its lower half.
      const traced = await renderThermalArtwork(page, { ...options, style: postStyle, tracedLevel: darkProduct ? 0 : TRACED_INK_LEVEL_PALE, singleItem: false });
      return {
        buffer: traced.buffer,
        svg: traced.svg,
        meta: {
          ...traced.meta,
          style: options.style,
          resolvedStyle: "diffusion",
          autoDarkShare: auto ? Number(auto.darkShare.toFixed(4)) : null,
          modelAvailable,
          serviceReady,
          diffusionServiceMs: drawn.ms,
          diffusionControlSize: `${control.width}x${control.height}`,
          diffusionError: "",
        },
      };
    } catch (error) {
      diffusionError = error?.message || String(error);
      console.warn("[thermal-artwork] illustration service failed, falling back to the drawing model", { message: diffusionError });
      style = modelAvailable ? "lineart" : (auto ? auto.style : "sketch");
    }
  }

  if (style === "traced") {
    // A clean drawing on white: cut it directly and trace the strokes.
    const traced = await tracedBinarize(stretched, artWidth, artHeight, scaledBackground, { inkOffset, level: options.tracedLevel });
    lineart = { ink: traced.ink, svg: traced.svg, runtime: "traced", durationMs: 0, modelWidth: artWidth, modelHeight: artHeight };
    ink = traced.ink;
  }

  if (style === "lineart") {
    try {
      const { data: artRgbData, info: artRgbInfo } = await sharp(rawBuffer(croppedRgb), { raw: { width: padded.width, height: padded.height, channels: 3 } })
        .resize({ width: artWidth, height: artHeight, fit: "fill", kernel: sharp.kernel.lanczos3 })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const artChannels = Number(artRgbInfo.channels || 3);
      const artRgb = new Uint8Array(artWidth * artHeight * 3);
      for (let index = 0; index < artWidth * artHeight; index += 1) {
        artRgb[index * 3] = artRgbData[index * artChannels];
        artRgb[(index * 3) + 1] = artRgbData[(index * artChannels) + 1];
        artRgb[(index * 3) + 2] = artRgbData[(index * artChannels) + 2];
      }
      lineart = await lineartBinarize(artRgb, artWidth, artHeight, scaledBackground, { inkOffset });
      ink = lineart.ink;
    } catch (error) {
      lineartError = error?.message || String(error);
      console.warn("[thermal-artwork] drawing model failed, falling back to the sketch filter", { message: lineartError });
      style = auto ? auto.style : "sketch";
    }
  }

  let bias = style === "halftone" ? 0 : inkOffset * 30;
  if (!ink) {
    ink = style === "sketch"
      ? await sketchBinarize(stretched, artWidth, artHeight, scaledBackground, { inkOffset })
      : binarizeForStyle(style, stretched, artWidth, artHeight, scaledBackground, bias, tone);
  }
  let ratio = inkRatio(ink, scaledBackground);
  let passes = 1;

  if (style === "sketch" || style === "lineart" || style === "traced") {
    // Coverage is not the goal of a drawing: a clean shoe is mostly white.
  } else if (style === "halftone") {
    // Stepping the tone coarsely overshoots: one nudge too many and a black
    // shoe washes out to a few scattered dots. Bisect instead, and stop at the
    // darkest tone that still fits the coverage target, which is where the
    // dither carries the most structure.
    const target = clamp(INK_RATIO_MAX * (options.inkLevel / 50), 0.12, 0.85);
    if (ratio > target) {
      let heavy = tone;
      let light = tone + 1;
      // The darkest tone that still fits the target — that is where the dither
      // carries the most structure.
      let chosen = null;
      // And the lightest tone reached at all. A target below what the tone
      // curve can produce used to snap the artwork back to the untouched,
      // near-solid frame; saturating at the lightest reachable print is what
      // the setting actually means.
      let lightest = null;

      for (let step = 0; step < HALFTONE_TONE_STEPS; step += 1) {
        const middle = (heavy + light) / 2;
        const candidate = binarizeForStyle(style, stretched, artWidth, artHeight, scaledBackground, bias, middle);
        const candidateRatio = inkRatio(candidate, scaledBackground);
        const entry = { ink: candidate, ratio: candidateRatio, tone: middle };
        passes += 1;

        if (!lightest || candidateRatio < lightest.ratio) lightest = entry;
        if (candidateRatio > target) {
          heavy = middle;
        } else {
          light = middle;
          if (!chosen || candidateRatio > chosen.ratio) chosen = entry;
        }
      }

      const picked = chosen || lightest;
      if (picked) {
        ink = picked.ink;
        ratio = picked.ratio;
        tone = picked.tone;
      }
    }
  } else if (style !== "silhouette") {
    while (passes < INK_RETRY_PASSES && (ratio < INK_RATIO_MIN || ratio > INK_RATIO_MAX)) {
      bias += ratio < INK_RATIO_MIN ? INK_RETRY_STEP : -INK_RETRY_STEP;
      ink = binarizeForStyle(style, stretched, artWidth, artHeight, scaledBackground, bias, tone);
      ratio = inkRatio(ink, scaledBackground);
      passes += 1;
    }
  }

  if (options.despeckle) {
    const minArea = Math.max(4, Math.round(artWidth * artHeight * 0.00003));
    ink = despeckleInk(ink, artWidth, artHeight, minArea);
  }

  if (options.outline && backgroundRemoved && style !== "silhouette") {
    const thickness = style === "sketch" || artBox >= 900 ? 2 : 1;
    ink = reinforceOutline(ink, scaledBackground, artWidth, artHeight, thickness);
  }

  const artPlane = new Uint8Array(ink.length);
  for (let index = 0; index < artPlane.length; index += 1) artPlane[index] = ink[index] ? 0 : 255;

  const outputWidth = artWidth + (2 * margin);
  const outputHeight = artHeight + (2 * margin);
  const artBuffer = await sharp(rawBuffer(artPlane), {
    raw: { width: artWidth, height: artHeight, channels: 1 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false, force: true })
    .toBuffer();

  const buffer = await sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: artBuffer, left: margin, top: margin }])
    .grayscale()
    .threshold(128)
    .png({ compressionLevel: 9, adaptiveFiltering: false, force: true })
    .toBuffer();

  return {
    buffer,
    // The traced drawing, when the style produced one: a standalone SVG whose
    // viewBox is the model grid, so it can be rendered at any print size.
    svg: lineart?.svg || "",
    meta: {
      engine: "local",
      engineVersion: THERMAL_LOCAL_ENGINE_VERSION,
      style: options.style,
      resolvedStyle: style,
      autoDarkShare: auto ? Number(auto.darkShare.toFixed(4)) : null,
      modelAvailable,
      lineartRuntime: lineart?.runtime || "",
      lineartMs: lineart?.durationMs ?? null,
      lineartModelSize: lineart ? `${lineart.modelWidth}x${lineart.modelHeight}` : "",
      lineartError,
      vectorised: Boolean(lineart?.svg),
      serviceReady,
      diffusionError,
      inkLevel: options.inkLevel,
      backgroundRemoved,
      backgroundRatio: Number(backgroundRatio.toFixed(4)),
      shadowRemoved,
      singleItem: singleItem.applied,
      singleItemReason: singleItem.reason || "",
      singleItemKeepShare: singleItem.keepShare !== undefined ? Number(singleItem.keepShare.toFixed(3)) : null,
      singleItemMs: singleItem.durationMs ?? null,
      sourceWidth: width,
      sourceHeight: height,
      artWidth,
      artHeight,
      outputWidth,
      outputHeight,
      subjectPixels: subjectCount,
      inkRatio: Number(ratio.toFixed(4)),
      thresholdBias: Number(bias.toFixed(2)),
      tone: Number(tone.toFixed(3)),
      passes,
    },
  };
};

export default {
  renderThermalArtwork,
  normalizeThermalLocalOptions,
  thermalLocalOptionsFingerprint,
  THERMAL_LOCAL_STYLES,
  THERMAL_LOCAL_ENGINE_VERSION,
  DEFAULT_THERMAL_LOCAL_STYLE,
};
