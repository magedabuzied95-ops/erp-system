import sharp from "sharp";

/**
 * Cut the shoe out of a busy customer photo before it is matched.
 *
 * Customer photos are screenshots of other pages and stills from videos: a
 * foot or a leg, the floor, captions, price stickers, sometimes several
 * shoes. All of that spoils both the vision reading and the image-similarity
 * search. This crops the photo down to the shoe:
 *
 *   (a) with the box the vision model read (normalised 0..1), when given;
 *   (b) otherwise with EfficientSAM (server/models/efficientsam_ti.onnx) —
 *       a box prompt over the middle of the photo, the confident mask's
 *       largest blob, its bounding box padded ~8%.
 *
 * It never throws: any failure hands back the original buffer with
 * `cropped: false` and a reason.
 *
 * Speed: the reading box costs one sharp crop (tens of ms). Segmentation
 * does not: EfficientSAM's encoder works at a fixed internal size, so a
 * smaller input saves nothing — ~10 s per photo on the WebAssembly runtime
 * and ~4 s native, measured on 4 cores. It also shares one queue with the
 * thermal single-item step. Callers on a reply path should pass the reading
 * box; SHOE_CROP_SEGMENT=off turns the segmentation fallback off.
 */

const PAD = 0.08;
// The segmentation model sees the photo at this long side (as the thermal
// single-item step does); the crop itself is cut from the full photo.
const SEGMENT_LONG_SIDE = 512;
// The box prompt: the middle of the frame, where a customer's screenshot
// almost always has the shoe. Captions and stickers sit at the edges. A box
// over the whole frame returned the backdrop; a centre point alone returned
// a panel of the shoe. SAM masks may run past the box, so it can be snug.
const PROMPT_INSET = 0.15;
const PROMPT_SPAN = 1 - (2 * PROMPT_INSET);
const PROMPT_ECHO = 0.7;
const MIN_IOU = 0.6;
// Under this share of the photo the mask is a logo, a lace or a sticker.
const MIN_MASK_SHARE = 0.02;
// A crop that keeps this much of the photo is not worth the re-encode.
const MAX_BOX_SHARE = 0.85;
const MIN_BOX_SIDE = 0.04;

const fail = (buffer, reason, extra = {}) => ({ buffer, cropped: false, box: null, reason, ...extra });

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * The optional `shoe_box` of a vision reading, as a checked normalised box.
 * Takes the reading (`{ shoe_box }`, or `{ detected: { shoe_box } }`) or a
 * box itself. Anything malformed, empty or degenerate comes back null.
 */
export const shoeBoxFromReading = (detected) => {
  try {
    if (!detected || typeof detected !== "object") return null;
    const source = detected.detected && typeof detected.detected === "object" ? detected.detected : detected;
    const raw = source.shoe_box && typeof source.shoe_box === "object" ? source.shoe_box : source;
    const values = ["x", "y", "width", "height"].map((key) => Number(raw[key]));
    if (values.some((value) => !Number.isFinite(value))) return null;
    let [x, y, width, height] = values;
    // Percentages slip through now and then; a box is never wider than the photo.
    if (Math.max(x, y, width, height) > 1.5) [x, y, width, height] = values.map((value) => value / 100);
    x = clamp01(x);
    y = clamp01(y);
    width = clamp01(Math.min(width, 1 - x));
    height = clamp01(Math.min(height, 1 - y));
    if (width < MIN_BOX_SIDE || height < MIN_BOX_SIDE) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
};

/**
 * The shoe's box from a segmentation mask: its largest connected blob (a
 * stray speck must not stretch the box), normalised 0..1. Null when the blob
 * is too small to be a shoe.
 */
export const boxFromMask = (mask, width, height, { minShare = MIN_MASK_SHARE } = {}) => {
  const total = width * height;
  if (!mask || mask.length < total || !total) return null;
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let best = null;
  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      size += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[index - 1] && !seen[index - 1]) { seen[index - 1] = 1; stack[top++] = index - 1; }
      if (x < width - 1 && mask[index + 1] && !seen[index + 1]) { seen[index + 1] = 1; stack[top++] = index + 1; }
      if (y > 0 && mask[index - width] && !seen[index - width]) { seen[index - width] = 1; stack[top++] = index - width; }
      if (y < height - 1 && mask[index + width] && !seen[index + width]) { seen[index + width] = 1; stack[top++] = index + width; }
    }
    if (!best || size > best.size) best = { size, minX, minY, maxX, maxY };
  }
  if (!best || best.size / total < minShare) return null;
  return {
    x: best.minX / width,
    y: best.minY / height,
    width: (best.maxX - best.minX + 1) / width,
    height: (best.maxY - best.minY + 1) / height,
    share: best.size / total,
    // How many sides of the frame the blob reaches: the backdrop and the
    // floor reach two or more, a shoe in the frame rarely does.
    edges: (best.minX === 0) + (best.minY === 0) + (best.maxX === width - 1) + (best.maxY === height - 1),
  };
};

const padBox = (box) => {
  const padX = box.width * PAD;
  const padY = box.height * PAD;
  const x = clamp01(box.x - padX);
  const y = clamp01(box.y - padY);
  return {
    x,
    y,
    width: clamp01(box.x + box.width + padX) - x,
    height: clamp01(box.y + box.height + padY) - y,
  };
};

const segmentShoeBox = async (oriented) => {
  if (String(process.env.SHOE_CROP_SEGMENT || "").toLowerCase() === "off") return { reason: "segment-disabled" };
  const { isSegmentModelAvailable, segmentFromPoints } = await import("./thermalSegmentModel.js");
  if (!(await isSegmentModelAvailable())) return { reason: "segment-model-unavailable" };
  const { data, info } = await sharp(oriented, { failOn: "none" })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: SEGMENT_LONG_SIDE, height: SEGMENT_LONG_SIDE, fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const segWidth = Number(info.width || 0);
  const segHeight = Number(info.height || 0);
  if (!segWidth || !segHeight) return { reason: "decode-failed" };
  const channels = Number(info.channels || 3);
  const rgb = channels === 3 ? data : new Uint8Array(segWidth * segHeight * 3);
  if (channels !== 3) {
    for (let index = 0; index < segWidth * segHeight; index += 1) {
      rgb[index * 3] = data[index * channels];
      rgb[(index * 3) + 1] = data[(index * channels) + 1];
      rgb[(index * 3) + 2] = data[(index * channels) + 2];
    }
  }
  // Box corners carry labels 2 and 3.
  const points = [
    [Math.round(segWidth * PROMPT_INSET), Math.round(segHeight * PROMPT_INSET), 2],
    [Math.round(segWidth * (1 - PROMPT_INSET)), Math.round(segHeight * (1 - PROMPT_INSET)), 3],
  ];
  const result = await segmentFromPoints({ rgb, width: segWidth, height: segHeight, points });
  const candidates = [];
  for (let k = 0; k < result.masks.length; k += 1) {
    if (!(result.ious[k] >= MIN_IOU)) continue;
    const box = boxFromMask(result.masks[k], result.width, result.height);
    if (!box || box.width * box.height > MAX_BOX_SHARE || box.edges >= 2) continue;
    // A mask whose box fills most of the prompt box is the box echoed back
    // (backdrop and all), not an object found inside it. A shoe that big
    // already fills the photo, and the original goes through uncropped.
    if (box.width * box.height >= PROMPT_SPAN * PROMPT_SPAN * PROMPT_ECHO) continue;
    candidates.push({ box, iou: result.ious[k] });
  }
  const timing = { runtime: result.runtime, segmentMs: result.durationMs };
  if (process.env.SHOE_CROP_DEBUG) console.log("[shoe-crop] masks", result.ious, result.masks.map((m) => boxFromMask(m, result.width, result.height, { minShare: 0 })));
  if (!candidates.length) return { reason: "no-confident-mask", ...timing };
  // The model's own confidence picks; within a hair, the larger mask is the
  // whole shoe rather than the shoe minus its tongue.
  candidates.sort((a, b) => (Math.abs(b.iou - a.iou) < 0.02 ? b.box.share - a.box.share : b.iou - a.iou));
  const { share, edges, ...box } = candidates[0].box;
  return { box, share, iou: candidates[0].iou, ...timing };
};

/**
 * @param {Buffer} buffer  the customer's photo
 * @param {{ box?: { x: number, y: number, width: number, height: number } | null }} [options]
 *   `box` — the shoe's normalised box from a vision reading; skips segmentation.
 * @returns {Promise<{ buffer: Buffer, cropped: boolean, box: { x: number, y: number, width: number, height: number } | null, reason: string }>}
 *   `box` is the padded crop, normalised to the (EXIF-upright) photo.
 */
export const cropShoeFromPhoto = async (buffer, { box = null } = {}) => {
  const startedAt = Date.now();
  try {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return fail(buffer, "no-image");
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    // Work on the upright photo so the box means what a viewer sees.
    const oriented = Number(meta.orientation || 1) > 1
      ? await sharp(buffer, { failOn: "none" }).rotate().toBuffer()
      : buffer;
    const swap = Number(meta.orientation || 1) >= 5;
    const width = Number(swap ? meta.height : meta.width) || 0;
    const height = Number(swap ? meta.width : meta.height) || 0;
    if (!width || !height) return fail(buffer, "decode-failed");

    let shoeBox = null;
    let source = "reading";
    let extra = {};
    if (box) {
      shoeBox = shoeBoxFromReading(box);
      if (!shoeBox) return fail(buffer, "box-invalid", { durationMs: Date.now() - startedAt });
    } else {
      source = "segment";
      const segmented = await segmentShoeBox(oriented);
      const { box: found, reason, ...rest } = segmented;
      extra = rest;
      if (!found) return fail(buffer, reason, { ...extra, durationMs: Date.now() - startedAt });
      shoeBox = found;
    }

    const padded = padBox(shoeBox);
    if (padded.width * padded.height > MAX_BOX_SHARE) {
      return fail(buffer, "box-covers-photo", { ...extra, source, durationMs: Date.now() - startedAt });
    }
    const left = Math.round(padded.x * width);
    const top = Math.round(padded.y * height);
    const cropWidth = Math.min(width - left, Math.max(1, Math.round(padded.width * width)));
    const cropHeight = Math.min(height - top, Math.max(1, Math.round(padded.height * height)));
    if (cropWidth < 16 || cropHeight < 16) return fail(buffer, "box-too-small", { ...extra, source, durationMs: Date.now() - startedAt });

    const output = await sharp(oriented, { failOn: "none" })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      buffer: output,
      cropped: true,
      box: { x: left / width, y: top / height, width: cropWidth / width, height: cropHeight / height },
      reason: source === "reading" ? "reading-box" : "segmented",
      source,
      ...extra,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return fail(buffer, "crop-failed", { error: error?.message || String(error), durationMs: Date.now() - startedAt });
  }
};

export default { cropShoeFromPhoto, shoeBoxFromReading, boxFromMask };
