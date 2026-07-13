import path from "node:path";

const supportedExtensions = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".jfif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const supportedMimeTypes = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

const formatDetails = {
  avif: { extension: ".avif", mimetype: "image/avif" },
  gif: { extension: ".gif", mimetype: "image/gif" },
  heif: { extension: ".heic", mimetype: "image/heic" },
  jpeg: { extension: ".jpg", mimetype: "image/jpeg" },
  png: { extension: ".png", mimetype: "image/png" },
  webp: { extension: ".webp", mimetype: "image/webp" },
};

const ascii = (buffer, start, length) => buffer.subarray(start, start + length).toString("ascii");

export const isPotentialImageUpload = (file = {}) => {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mimetype = String(file.mimetype || "").trim().toLowerCase();

  return (
    supportedExtensions.has(extension) ||
    supportedMimeTypes.has(mimetype) ||
    !mimetype ||
    mimetype === "application/octet-stream"
  );
};

export const detectImageFormat = (input) => {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer[0] === 0x89 &&
    ascii(buffer, 1, 3) === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(ascii(buffer, 0, 6))) return "gif";

  // AVIF and HEIC/HEIF are ISO-BMFF files. Their major/compatible brands
  // identify the image type even when a phone or browser reports a generic MIME.
  if (ascii(buffer, 4, 4) === "ftyp") {
    const brands = ascii(buffer, 8, Math.min(buffer.length - 8, 56));
    if (/(avif|avis)/.test(brands)) return "avif";
    if (/(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brands)) return "heif";
  }

  return null;
};

export const getImageFormatDetails = (format) => formatDetails[format] || null;

