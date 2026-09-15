/*
 * The photo a shopper searches with, made fit to upload.
 *
 * An iPhone photo is 3-5 MB and 4032 px, often HEIC. The server takes JPG/PNG/WEBP up to 8 MB and
 * the vision model reads ~1 megapixel at most, so a full-size photo over a phone connection was
 * seconds of upload for detail nobody reads, and a HEIC one was refused outright. The browser that
 * could show the photo can also redraw it, so it is redrawn as a JPEG no longer than 1280 px on its
 * long side. If the browser cannot decode it, a supported original still goes as it is.
 */

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.86;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const searchImageTargetSize = (width, height, maxEdge = MAX_EDGE) => {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};

const decode = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    image.src = url;
  });

/** Resolves to an uploadable File, or rejects with Error("unsupported_image"). */
export const prepareSearchImage = async (file) => {
  if (!file) throw new Error("unsupported_image");
  try {
    const { image, url } = await decode(file);
    try {
      const { width, height } = searchImageTargetSize(image.naturalWidth, image.naturalHeight);
      if (!width) throw new Error("image_decode_failed");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      // A transparent PNG would turn black as JPEG; our catalogue photos sit on white.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      if (!blob) throw new Error("image_encode_failed");
      return new File([blob], "search-photo.jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    if (SUPPORTED_TYPES.has(file.type)) return file;
    throw new Error("unsupported_image");
  }
};
