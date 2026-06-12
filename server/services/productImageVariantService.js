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
