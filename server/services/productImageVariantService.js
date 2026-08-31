import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import sharp from "sharp";

export const PRODUCT_IMAGE_VARIANT_PRESETS = {
  thumb: 96,
  card: 240,
  grid: 480,
  hero: 960,
};

export const PRODUCT_IMAGE_VARIANT_WIDTHS = Object.values(PRODUCT_IMAGE_VARIANT_PRESETS);
export const PRODUCT_IMAGE_VARIANT_DIR = "variants";

const knownUploadRoots = [
  path.resolve(process.cwd(), "uploads", "products"),
  path.resolve(process.cwd(), "server", "uploads", "products"),
  path.resolve(process.cwd(), "..", "uploads", "products"),
];

const supportedSourceExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const text = (value = "") => String(value || "").trim();

const normalizeFsPath = (value = "") => String(value || "").replace(/\\/g, "/");

const isPathInside = (childPath = "", parentPath = "") => {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const sanitizeFileStem = (value = "") =>
  String(value || "image")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "image";

const uniqueWidths = (widths = []) => [...new Set((Array.isArray(widths) ? widths : []).map((value) => Math.max(1, Math.round(Number(value || 0)))).filter(Boolean))].sort((a, b) => a - b);

const isHttpUrl = (value = "") => /^https?:\/\//i.test(text(value));

const parseLocalProductUploadReference = (value = "") => {
  const raw = text(value);
  if (!raw) return null;

  if (isHttpUrl(raw)) {
    try {
      const parsed = new URL(raw);
      if (!/\/uploads\/products\/(?!variants\/)/i.test(parsed.pathname)) return null;
      const relativePath = parsed.pathname.replace(/^\/+/, "");
      return {
        kind: "url",
        original: raw,
        origin: parsed.origin,
        relativePath,
        fileName: path.posix.basename(relativePath),
      };
    } catch {
      return null;
    }
  }

  const normalized = normalizeFsPath(raw);
  const localMatch = normalized.match(/(^|\/)uploads\/products\/(?!variants\/)(.+)$/i);
  if (!localMatch) return null;
  const relativePath = `uploads/products/${localMatch[2].replace(/^\/+/, "")}`;
  return {
    kind: "path",
    original: raw,
    relativePath,
    fileName: path.posix.basename(relativePath),
  };
};

export const isLocalProductImageUrl = (value = "") => Boolean(parseLocalProductUploadReference(value));

export const resolveLocalProductImageSourcePath = (value = "") => {
  const reference = parseLocalProductUploadReference(value);
  if (!reference) {
    const raw = text(value);
    if (!raw) return "";
    if (path.isAbsolute(raw)) return raw;
    return "";
  }

  const relativeStem = reference.relativePath.replace(/^uploads[\\/]+products[\\/]+/i, "");
  if (reference.kind === "path") {
    for (const root of knownUploadRoots) {
      const candidate = path.join(root, relativeStem);
      if (candidate && isPathInside(candidate, root)) {
        return candidate;
      }
    }
  }

  if (reference.kind === "url") {
    for (const root of knownUploadRoots) {
      const candidate = path.join(root, relativeStem);
      if (candidate && isPathInside(candidate, root)) {
        return candidate;
      }
    }
  }

  return "";
};

export const getLocalProductImageVariantFileName = (sourcePath = "", width = 0) => {
  const parsed = path.parse(text(sourcePath));
  const stem = sanitizeFileStem(parsed.name || "image");
  const variantWidth = Math.max(1, Math.round(Number(width || 0)));
  return `${stem}-w${variantWidth}.webp`;
};

export const getLocalProductImageVariantRelativePath = (sourcePath = "", width = 0) => {
  return `uploads/products/${PRODUCT_IMAGE_VARIANT_DIR}/${getLocalProductImageVariantFileName(sourcePath, width)}`;
};

export const getLocalProductImageVariantPublicUrl = (value = "", width = 0) => {
  const reference = parseLocalProductUploadReference(value);
  if (!reference) return "";
  const variantRelative = `uploads/products/${PRODUCT_IMAGE_VARIANT_DIR}/${getLocalProductImageVariantFileName(reference.fileName, width)}`;
  if (reference.kind === "url") {
    return new URL(`/${variantRelative}`, reference.origin).toString();
  }
  return `/${variantRelative}`;
};

export const getLocalProductImageVariantFilePath = (sourcePath = "", width = 0) => {
  const source = text(sourcePath);
  if (!source) return "";
  const resolved = path.isAbsolute(source) ? source : resolveLocalProductImageSourcePath(source);
  if (!resolved) return "";
  return path.join(path.dirname(resolved), PRODUCT_IMAGE_VARIANT_DIR, getLocalProductImageVariantFileName(resolved, width));
};

const ensureFileExists = async (filePath = "") => {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const ensureLocalProductImageVariants = async (sourcePath = "", widths = PRODUCT_IMAGE_VARIANT_WIDTHS) => {
  const resolvedSourcePath = path.isAbsolute(text(sourcePath)) ? text(sourcePath) : resolveLocalProductImageSourcePath(sourcePath);
  const unique = uniqueWidths(widths);
  const summary = {
    sourcePath: resolvedSourcePath,
    requestedWidths: unique,
    generated: [],
    skipped: [],
  };

  if (!resolvedSourcePath || !unique.length) return summary;
  const sourceExists = await ensureFileExists(resolvedSourcePath);
  if (!sourceExists) {
    summary.skipped.push({ reason: "missing_source", sourcePath: resolvedSourcePath });
    return summary;
  }

  const sourceExt = path.extname(resolvedSourcePath).toLowerCase();
  if (sourceExt && !supportedSourceExtensions.has(sourceExt)) {
    summary.skipped.push({ reason: "unsupported_extension", sourcePath: resolvedSourcePath, extension: sourceExt });
    return summary;
  }

  const outputDir = path.join(path.dirname(resolvedSourcePath), PRODUCT_IMAGE_VARIANT_DIR);
  await mkdir(outputDir, { recursive: true });

  for (const width of unique) {
    const outputPath = getLocalProductImageVariantFilePath(resolvedSourcePath, width);
    if (await ensureFileExists(outputPath)) {
      summary.skipped.push({ reason: "exists", width, outputPath });
      continue;
    }

    await sharp(resolvedSourcePath, { animated: false })
      .rotate()
      .resize({
        width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toFile(outputPath);

    summary.generated.push({ width, outputPath });
  }

  return summary;
};

/*
 * A square (1:1) card image for WhatsApp carousels. The card's frame and zoom are whatever the
 * customer's WhatsApp decides — even a perfectly square source gets edge-cropped by some
 * clients. So the only lever that works is padding: the product sits on a white square canvas
 * with a margin around it, and whatever slice the client trims comes out of the margin, never
 * out of the product. JPEG on purpose: Meta's media pipeline has rejected WebP elsewhere, and a
 * card photo that sometimes does not render is worse than a slightly larger file.
 */
export const WHATSAPP_CARD_IMAGE_SIZE = 800;
// The product occupies this share of the canvas; the rest is the crop-safety margin.
const WHATSAPP_CARD_PRODUCT_SHARE = 0.8;

export const ensureSquareCardImageUrl = async (value = "") => {
  const reference = parseLocalProductUploadReference(value);
  const sourcePath = resolveLocalProductImageSourcePath(value);
  if (!reference || !sourcePath || !(await ensureFileExists(sourcePath))) return "";
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext && !supportedSourceExtensions.has(ext)) return "";
  const root = knownUploadRoots.find((candidate) => isPathInside(sourcePath, candidate));
  if (!root) return "";
  const stem = sanitizeFileStem(path.parse(sourcePath).name);
  const fileName = `${stem}-sq${WHATSAPP_CARD_IMAGE_SIZE}.jpg`;
  const outputPath = path.join(root, PRODUCT_IMAGE_VARIANT_DIR, fileName);
  if (!(await ensureFileExists(outputPath))) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const inner = Math.round(WHATSAPP_CARD_IMAGE_SIZE * WHATSAPP_CARD_PRODUCT_SHARE);
    const margin = Math.round((WHATSAPP_CARD_IMAGE_SIZE - inner) / 2);
    await sharp(sourcePath, { animated: false })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: inner, height: inner, fit: "contain", background: "#ffffff" })
      .extend({ top: margin, bottom: margin, left: margin, right: margin, background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toFile(outputPath);
  }
  const publicRelative = `/uploads/products/${PRODUCT_IMAGE_VARIANT_DIR}/${fileName}`;
  return reference.kind === "url" ? new URL(publicRelative, reference.origin).toString() : publicRelative;
};

/*
 * CARD-FIT IMAGE — the storefront grid centres the *file's* rectangle, never the product
 * inside it. Measured across 40 live catalogue photos: horizontally they are already good
 * (under 3% drift), but vertically the product sits anywhere from 10% high to 14% low, and it
 * fills between 43% and 75% of its own canvas. So a grid of them reads slightly ragged even
 * though every tile is the identical rectangle. This bakes a card-shaped canvas instead: trim
 * the uniform studio border down to the product's own bounding box, fit that box into a fixed
 * inner frame, and centre it exactly. Every card then shows the same product size in the same
 * place, and `object-contain` has nothing left to guess.
 *
 * Written as its OWN file, never over `-wN.webp`. Those derivatives are the only surviving
 * backup of every original ever processed — twice now they were copied back over originals a
 * still-unidentified deleter removed — and a trimmed backup is a corrupted one.
 */
// 0.92:1 — the card image plate's aspect ratio. Two widths, matching the storefront grid
// preset, so the responsive srcset keeps working instead of collapsing to one soft size.
export const CARD_FIT_ASPECT = 0.92;
export const CARD_FIT_WIDTHS = [480, 960];
// The product's bounding box occupies this share of the canvas; the rest is even margin.
const CARD_FIT_PRODUCT_SHARE = 0.82;
// How far a pixel may drift from pure white and still count as background.
const CARD_FIT_TRIM_THRESHOLD = 12;
// A trim that leaves less than this share of the frame found a subject, not a border, and is
// rejected: a photo shot on a gradient or a lifestyle backdrop would otherwise be gutted.
const CARD_FIT_MIN_TRIM_RATIO = 0.05;
// How far the border ring may vary before we call the backdrop non-uniform and refuse to re-frame.
const CARD_FIT_BORDER_TOLERANCE = 18;

/*
 * Do NOT assume the backdrop is pure white. Enough of the catalogue is shot on a faint cream or
 * grey that padding with #ffffff leaves the photo sitting in a visibly lighter box — one of the
 * first thirteen models came out exactly like that. So read the frame's own border ring and use
 * that colour for both the trim and the padding: seamless whatever the studio used. A ring that
 * disagrees with itself is a gradient or a lifestyle shot, or the product runs off the edge —
 * either way there is no border to cut, and the caller is told to leave the photo alone.
 */
const sampleBorderColour = async (buffer) => {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const samples = [];
  const steps = 48;
  for (let s = 0; s < steps; s++) {
    const x = Math.min(width - 1, Math.round((s / (steps - 1)) * (width - 1)));
    const y = Math.min(height - 1, Math.round((s / (steps - 1)) * (height - 1)));
    samples.push(at(x, 0), at(x, height - 1), at(0, y), at(width - 1, y));
  }

  const median = [0, 1, 2].map((c) => {
    const sorted = samples.map((s) => s[c]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
  // The ring is allowed a few stray outliers (a shadow clipping a corner, a stray reflection);
  // it is the bulk of it that has to agree.
  const deviations = samples.map((s) => Math.max(Math.abs(s[0] - median[0]), Math.abs(s[1] - median[1]), Math.abs(s[2] - median[2]))).sort((a, b) => a - b);
  const spread = deviations[Math.floor(deviations.length * 0.9)];

  return { r: median[0], g: median[1], b: median[2], uniform: spread <= CARD_FIT_BORDER_TOLERANCE, spread };
};

export const getCardFitImageFileName = (sourcePath = "", width = 0) => {
  const stem = sanitizeFileStem(path.parse(text(sourcePath)).name || "image");
  return `${stem}-fit${Math.max(1, Math.round(Number(width) || CARD_FIT_WIDTHS[CARD_FIT_WIDTHS.length - 1]))}.webp`;
};

/*
 * Mirror the sub-path under products/ inside variants/, because that is what the storefront
 * derives: it strips `/uploads/products/` off the stored URL and keeps whatever is left, so
 * `products/cloudinary/x.jpg` is requested as `products/variants/cloudinary/x-fit960.webp`.
 * Writing those flat into variants/ would 404 the 3,308 images the Cloudinary migration parked
 * in that sub-folder — the overwhelming majority of the catalogue.
 */
const cardFitRelativeDir = (sourcePath = "", root = "") => {
  const relative = path.relative(root, path.dirname(sourcePath));
  return !relative || relative.startsWith("..") || path.isAbsolute(relative) ? "" : relative;
};

export const getCardFitImagePublicUrl = (value = "", width = 0) => {
  const reference = parseLocalProductUploadReference(value);
  if (!reference) return "";
  const subPath = path.posix.dirname(reference.relativePath.replace(/^uploads\/products\/?/i, ""));
  const prefix = subPath && subPath !== "." ? `${subPath}/` : "";
  const relative = `/uploads/products/${PRODUCT_IMAGE_VARIANT_DIR}/${prefix}${getCardFitImageFileName(reference.fileName, width)}`;
  return reference.kind === "url" ? new URL(relative, reference.origin).toString() : relative;
};

/*
 * Always writes a file, for every width, even when the photo cannot be re-framed. A missing
 * derivative would mean a 404 on a card the storefront has already committed to, and the grid
 * has no way to know in advance which photos qualify. So a non-uniform backdrop — a gradient, a
 * lifestyle shot, a product running off the edge — is not skipped: it is resized to fit the same
 * canvas without trim or padding, which is exactly how that photo renders today. The card gets a
 * predictable URL either way; only the photos that can be improved actually change.
 */
export const ensureCardFitImages = async (value = "", options = {}) => {
  const reference = parseLocalProductUploadReference(value);
  const sourcePath = resolveLocalProductImageSourcePath(value);
  const result = { source: text(value), reframed: false, reason: "", written: [], skipped: [], urls: {} };
  if (!reference || !sourcePath || !(await ensureFileExists(sourcePath))) {
    result.reason = "missing_source";
    return result;
  }
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext && !supportedSourceExtensions.has(ext)) {
    result.reason = "unsupported_extension";
    return result;
  }
  const root = knownUploadRoots.find((candidate) => isPathInside(sourcePath, candidate));
  if (!root) {
    result.reason = "outside_upload_root";
    return result;
  }

  const share = Number(options.productShare) > 0 && Number(options.productShare) <= 1 ? Number(options.productShare) : CARD_FIT_PRODUCT_SHARE;
  const threshold = Number.isFinite(Number(options.trimThreshold)) ? Number(options.trimThreshold) : CARD_FIT_TRIM_THRESHOLD;
  const widths = uniqueWidths(Array.isArray(options.widths) && options.widths.length ? options.widths : CARD_FIT_WIDTHS);

  const subDir = cardFitRelativeDir(sourcePath, root);
  const outputDir = path.join(root, PRODUCT_IMAGE_VARIANT_DIR, subDir);
  if (!isPathInside(outputDir, path.join(root, PRODUCT_IMAGE_VARIANT_DIR)) && outputDir !== path.join(root, PRODUCT_IMAGE_VARIANT_DIR)) {
    result.reason = "output_escapes_variants_dir";
    return result;
  }

  const pending = [];
  for (const width of widths) {
    const fileName = getCardFitImageFileName(sourcePath, width);
    const outputPath = path.join(outputDir, fileName);
    result.urls[width] = getCardFitImagePublicUrl(value, width);
    if (!options.force && (await ensureFileExists(outputPath))) {
      result.skipped.push({ width, reason: "exists" });
      continue;
    }
    pending.push({ width, outputPath });
  }
  if (!pending.length) return result;

  await mkdir(outputDir, { recursive: true });

  // Flatten first so a PNG's transparent border reads like the opaque one everybody else has.
  const opaque = await sharp(sourcePath, { animated: false }).rotate().flatten({ background: "#ffffff" }).toBuffer();
  const sampled = await sampleBorderColour(opaque);
  // sharp's colour parser rejects an object carrying anything beyond the channels.
  const backdrop = { r: sampled.r, g: sampled.g, b: sampled.b };

  let subject = null;
  if (sampled.uniform) {
    const flattened = await sharp(sourcePath, { animated: false }).rotate().flatten({ background: backdrop }).toBuffer();
    const flatMeta = await sharp(flattened).metadata();
    subject = flattened;
    try {
      const trimmed = await sharp(flattened).trim({ background: backdrop, threshold }).toBuffer({ resolveWithObject: true });
      const kept = (trimmed.info.width * trimmed.info.height) / Math.max(1, flatMeta.width * flatMeta.height);
      if (kept >= CARD_FIT_MIN_TRIM_RATIO) subject = trimmed.data;
    } catch {
      // No border to cut after all: keep the photo whole, the padding still centres it.
    }
    result.reframed = true;
  } else {
    result.reason = `non_uniform_backdrop(spread=${sampled.spread})`;
  }

  for (const { width, outputPath } of pending) {
    const canvasWidth = width;
    const canvasHeight = Math.round(width / CARD_FIT_ASPECT);

    if (!result.reframed) {
      // Untouched framing, just sized for the card — identical to what renders today.
      await sharp(opaque).resize({ width: canvasWidth, height: canvasHeight, fit: "inside", withoutEnlargement: true }).webp({ quality: 86, effort: 4 }).toFile(outputPath);
      result.written.push({ width, outputPath, reframed: false });
      continue;
    }

    const innerWidth = Math.max(1, Math.round(canvasWidth * share));
    const innerHeight = Math.max(1, Math.round(canvasHeight * share));
    const left = Math.floor((canvasWidth - innerWidth) / 2);
    const top = Math.floor((canvasHeight - innerHeight) / 2);

    await sharp(subject)
      .resize({ width: innerWidth, height: innerHeight, fit: "contain", background: backdrop })
      .extend({
        top,
        bottom: canvasHeight - innerHeight - top,
        left,
        right: canvasWidth - innerWidth - left,
        background: backdrop,
      })
      .webp({ quality: 86, effort: 4 })
      .toFile(outputPath);
    result.written.push({ width, outputPath, reframed: true });
  }

  return result;
};

// Convenience for callers that only want the widest card image back.
export const ensureCardFitImageUrl = async (value = "", options = {}) => {
  const result = await ensureCardFitImages(value, options);
  const widest = Object.keys(result.urls).map(Number).sort((a, b) => b - a)[0];
  return widest ? result.urls[widest] : "";
};
