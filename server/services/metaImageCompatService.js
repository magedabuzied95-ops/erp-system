import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import sharp from "sharp";

/*
  Meta downloads every image from our origin and decodes it itself before it
  answers the publish call. Graph accepts JPEG everywhere, PNG/GIF on the Page
  endpoints — and WebP NOWHERE. The catalogue stores its masters as .webp, so an
  album built from product photos comes back as:

    facebook  : "Missing or invalid image file"
    instagram : "Only photo or video can be accepted as media type."

  Neither message names the format, so the images look broken or missing while
  they are in fact perfectly reachable (200 image/webp). Publish a JPEG rendition
  of anything Meta cannot read instead, cached on disk next to the uploads it is
  derived from so the conversion is paid once per file, not once per publish.
*/

// Extensions Meta can read as-is. GIF stays untouched on purpose: it is accepted
// by the Page endpoints and flattening it to JPEG would drop the animation.
const META_READABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".gif"]);

// Video shares the same media list as images on the publish payloads. Nothing
// here has any business decoding an .mp4.
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".3gp"]);

// Every image in one publish is converted concurrently, bounded so a 24-photo
// album cannot saturate the box while the request is waiting on it.
const CONVERSION_CONCURRENCY = 4;

// Meta downscales anyway and a smaller file is a shorter fetch for Graph, which
// is spending our request budget while it downloads.
const MAX_PUBLISH_DIMENSION = 1920;

export const META_JPEG_DIR = "meta-jpeg";

// Mirrors the /uploads static mounts in server.js, in the same order.
const uploadRoots = [
  path.resolve(process.cwd(), "uploads"),
  path.resolve(process.cwd(), "server", "uploads"),
  path.resolve(process.cwd(), "..", "uploads"),
];

const text = (value = "") => String(value || "").trim();

const isPathInside = (childPath = "", parentPath = "") => {
  const relative = path.relative(parentPath, childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const parseUploadReference = (value = "") => {
  const raw = text(value);
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^\/uploads\/(.+)$/i);
  if (!match) return null;
  const relativePath = decodeURIComponent(match[1]).replace(/^\/+/, "");
  if (!relativePath || relativePath.includes("..")) return null;
  // Already a rendition we produced: never chain conversions.
  if (relativePath.toLowerCase().startsWith(`${META_JPEG_DIR}/`)) return null;
  return { origin: parsed.origin, relativePath };
};

export const needsMetaJpegRendition = (value = "") => {
  const reference = parseUploadReference(value);
  if (!reference) return false;
  const extension = path.extname(reference.relativePath).toLowerCase();
  if (!extension) return false;
  if (VIDEO_EXTENSIONS.has(extension)) return false;
  return !META_READABLE_EXTENSIONS.has(extension);
};

const statFile = async (filePath = "") => {
  if (!filePath) return null;
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
};

/*
  Which of the mounted roots actually holds the file depends on the working
  directory the backend was started from, so the file has to be FOUND, not
  assumed: every root joins to a valid-looking path, and picking the first one
  blindly resolves to a name that is not there.
*/
const resolveLocalUploadFile = async (relativePath = "") => {
  for (const root of uploadRoots) {
    const candidate = path.join(root, relativePath);
    if (!candidate || !isPathInside(candidate, root)) continue;
    const stats = await statFile(candidate);
    if (stats) return { root, filePath: candidate, stats };
  }
  return null;
};

// The rendition name carries a digest of the source path AND of its size/mtime,
// so replacing an upload under the same file name cannot serve a stale JPEG.
export const buildMetaJpegFileName = (relativePath = "", stats = null) => {
  const digest = createHash("sha1")
    .update(`${relativePath}|${stats?.size ?? 0}|${Math.round(Number(stats?.mtimeMs || 0))}`)
    .digest("hex")
    .slice(0, 12);
  const stem = path
    .basename(relativePath, path.extname(relativePath))
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "image";
  return `${stem}-${digest}.jpg`;
};

export const convertToMetaJpeg = async ({ sourcePath, outputPath }) => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(sourcePath, { animated: false })
    .rotate()
    // JPEG has no alpha channel; without an explicit ground sharp fills it black.
    .flatten({ background: "#ffffff" })
    .resize({
      width: MAX_PUBLISH_DIMENSION,
      height: MAX_PUBLISH_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  return outputPath;
};

/*
  Returns a JPEG URL for an upload Meta cannot read, and the original URL for
  everything else. Fails OPEN on purpose: a conversion that cannot happen (remote
  URL, file not on this box, unreadable image) must not block a publish that used
  to at least be attempted.
*/
export const ensureMetaCompatibleImageUrl = async (value = "") => {
  const original = text(value);
  const reference = parseUploadReference(original);
  if (!reference || !needsMetaJpegRendition(original)) return original;

  const resolved = await resolveLocalUploadFile(reference.relativePath);
  if (!resolved) {
    console.warn("[meta-image-compat] source upload not found on disk; publishing the original url", {
      relative_path: reference.relativePath,
    });
    return original;
  }

  const fileName = buildMetaJpegFileName(reference.relativePath, resolved.stats);
  const outputPath = path.join(resolved.root, META_JPEG_DIR, fileName);
  const publicUrl = new URL(`/uploads/${META_JPEG_DIR}/${fileName}`, reference.origin).toString();

  if (await statFile(outputPath)) return publicUrl;

  try {
    await convertToMetaJpeg({ sourcePath: resolved.filePath, outputPath });
    console.log("[meta-image-compat] converted upload to jpeg for meta", {
      source: reference.relativePath,
      rendition: `${META_JPEG_DIR}/${fileName}`,
    });
    return publicUrl;
  } catch (error) {
    console.error("[meta-image-compat] jpeg conversion failed; publishing the original url", {
      relative_path: reference.relativePath,
      error: error?.message || "conversion failed",
    });
    return original;
  }
};

export const ensureMetaCompatibleImageUrls = async (urls = []) => {
  const list = Array.isArray(urls) ? urls : [];
  if (!list.length) return [];

  // Order is the slide/album order Meta publishes in, so results are placed by
  // index rather than by the order the conversions happen to finish in.
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONVERSION_CONCURRENCY, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await ensureMetaCompatibleImageUrl(list[index]);
    }
  });
  await Promise.all(runners);
  return results.filter(Boolean);
};

export default ensureMetaCompatibleImageUrls;
