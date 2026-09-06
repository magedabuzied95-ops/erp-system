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

export const THERMAL_LOCAL_ENGINE_VERSION = "v1-local-sharp";

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

export const normalizeThermalLocalOptions = (options = {}) => {
  return {
    style: normalizeThermalStyle(options.style),
    canvas: clamp(Math.round(numberOr(options.canvas, DEFAULT_CANVAS)), 256, 2048),
    fill: clamp(numberOr(options.fill, DEFAULT_FILL), 0.5, 1),
    // 0 = lightest possible burn, 100 = heaviest. 50 is the neutral setting.
    inkLevel: normalizeThermalInkLevel(options.inkLevel),
    backgroundThreshold: clamp(Math.round(numberOr(options.backgroundThreshold, DEFAULT_BACKGROUND_THRESHOLD)), 150, 254),
    despeckle: options.despeckle !== false,
    outline: options.outline !== false,
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
  ].join(":");
};

const readGrayscale = async (input, canvas) => {
  const { data, info } = await sharp(input, { animated: false, failOn: "none" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: canvas, height: canvas, fit: "inside", withoutEnlargement: false })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  const channels = Number(info.channels || 1);
  if (!width || !height) return null;

  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = data[index * channels];
  }
  return { gray, width, height };
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
 * Split the non-background pixels into blobs and keep only the ones that are
 * really the product. Two things get thrown away: dust and JPEG noise, and the
 * faint frame some supplier photos carry — a ring that spans the whole canvas
 * but fills almost none of it, which would otherwise pin the crop to the full
 * frame and get traced as a dashed border.
 *
 * Discarded blobs are folded back into the background so the rest of the
 * pipeline never sees them.
 */
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
const despeckleInk = (ink, width, height, minArea) => {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const component = new Int32Array(total);

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
      if (x > 0 && ink[index - 1] && !visited[index - 1]) { visited[index - 1] = 1; stack[top] = index - 1; top += 1; }
      if (x < width - 1 && ink[index + 1] && !visited[index + 1]) { visited[index + 1] = 1; stack[top] = index + 1; top += 1; }
      if (y > 0 && ink[index - width] && !visited[index - width]) { visited[index - width] = 1; stack[top] = index - width; top += 1; }
      if (y < height - 1 && ink[index + width] && !visited[index + width]) { visited[index + width] = 1; stack[top] = index + width; top += 1; }
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
  return {
    style: darkShare >= AUTO_STYLE_DARK_SHARE ? "halftone" : "detail",
    darkShare,
  };
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

  const { gray, width, height } = loaded;

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

  const pad = Math.max(2, Math.round(Math.min(bounds.width, bounds.height) * 0.01));
  const padded = {
    left: Math.max(0, bounds.left - pad),
    top: Math.max(0, bounds.top - pad),
  };
  padded.width = Math.min(width - padded.left, bounds.width + (2 * pad));
  padded.height = Math.min(height - padded.top, bounds.height + (2 * pad));

  const croppedGray = cropPlane(gray, width, padded);
  const croppedBackgroundRaw = cropPlane(background, width, padded);

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

  const auto = options.style === "auto" ? resolveAutoStyle(scaledGray, scaledBackground) : null;
  const style = auto ? auto.style : options.style;

  const { gray: stretched, subjectCount } = stretchSubjectContrast(scaledGray, scaledBackground);

  // Ink level moves the knob each style actually responds to: the threshold for
  // the line-art family, the coverage target for halftone.
  const inkOffset = (options.inkLevel - 50) / 50;
  let bias = style === "halftone" ? 0 : inkOffset * 30;
  let tone = 0;
  let ink = binarizeForStyle(style, stretched, artWidth, artHeight, scaledBackground, bias, tone);
  let ratio = inkRatio(ink, scaledBackground);
  let passes = 1;

  if (style === "halftone") {
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
    const thickness = artBox >= 900 ? 2 : 1;
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
    meta: {
      engine: "local",
      engineVersion: THERMAL_LOCAL_ENGINE_VERSION,
      style: options.style,
      resolvedStyle: style,
      autoDarkShare: auto ? Number(auto.darkShare.toFixed(4)) : null,
      inkLevel: options.inkLevel,
      backgroundRemoved,
      backgroundRatio: Number(backgroundRatio.toFixed(4)),
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
