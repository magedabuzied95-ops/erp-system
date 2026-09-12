/*
 * Preparing an operator's file BEFORE it leaves the browser.
 *
 * A photo taken on a phone is 3-6 MB of 4000px JPEG. The inbox used to POST
 * those bytes untouched to a backend in another region, wait for WhatsApp/Meta
 * to fetch the same bytes back off our disk, and only then paint the bubble —
 * which is why sending a picture felt like the composer had frozen, and why
 * anything over the channel cap was refused only AFTER the operator had already
 * waited for the whole upload.
 *
 * Nothing the customer ever sees needs 4000px: every channel re-encodes what we
 * hand it and renders it inside a chat bubble. Downscaling to 1600px and
 * re-encoding costs a few hundred milliseconds of local CPU and cuts the upload
 * by an order of magnitude.
 *
 * Every failure path here returns the ORIGINAL file. Preparation is an
 * optimisation, never a gate: a browser that cannot decode the image must still
 * be able to send it.
 */

export const MAX_OUTBOUND_IMAGE_DIMENSION = 1600;
export const FALLBACK_OUTBOUND_IMAGE_DIMENSION = 1280;
export const OUTBOUND_IMAGE_TARGET_BYTES = 900 * 1024;

// An animated GIF is the one image a canvas cannot re-encode without throwing
// the animation away, so it is passed through exactly as it was picked.
const PASSTHROUGH_TYPES = ["image/gif", "image/svg+xml"];

const clean = (value = "") => String(value || "").trim();

export const isImageFile = (file) => {
  if (!file) return false;
  const type = clean(file.type).toLowerCase();
  if (type.startsWith("image/")) return true;
  // A file dragged out of some Windows apps arrives with an empty type, so the
  // extension is the only thing left to go on.
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(clean(file.name));
};

/**
 * Every image file carried by a paste or a drop.
 *
 * A pasted screenshot is a File in `clipboardData.files` on Chrome and only an
 * item of kind "file" on some builds, so both are read and de-duplicated.
 */
export const attachmentFilesFromTransfer = (transfer) => {
  if (!transfer) return [];
  const files = [];
  const seen = new Set();
  const push = (file) => {
    if (!file || !isImageFile(file)) return;
    const identity = `${file.name || "clipboard"}:${file.size}:${file.lastModified || 0}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    files.push(file);
  };
  for (const file of Array.from(transfer.files || [])) push(file);
  for (const item of Array.from(transfer.items || [])) {
    if (item?.kind !== "file") continue;
    push(typeof item.getAsFile === "function" ? item.getAsFile() : null);
  }
  return files;
};

/** A pasted screenshot is always called "image.png"; give it a real name. */
export const namedAttachmentFile = (file) => {
  if (!file) return file;
  const name = clean(file.name);
  if (name && name.toLowerCase() !== "image.png") return file;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  try {
    return new File([file], `pasted-${stamp}.png`, { type: file.type || "image/png", lastModified: Date.now() });
  } catch {
    return file;
  }
};

const decodeWithImageElement = (file) =>
  new Promise((resolve) => {
    let objectUrl = "";
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const image = new Image();
    const done = (value) => {
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    image.onload = () => done(image);
    image.onerror = () => done(null);
    image.src = objectUrl;
  });

const decodeImage = async (file) => {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` is what applies the EXIF rotation a phone camera writes.
      // Without it a portrait photo arrives on its side, so a browser that
      // rejects the option falls through to the <img> path (which applies the
      // orientation itself) rather than to an unrotated bitmap.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
  }
  return decodeWithImageElement(file);
};

const imageSize = (source) => ({
  width: Number(source?.width || source?.naturalWidth || 0),
  height: Number(source?.height || source?.naturalHeight || 0),
});

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob || null), type, quality);
  });

const drawScaled = (source, maxDimension) => {
  const { width, height } = imageSize(source);
  if (!width || !height) return null;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  // A PNG with transparency becomes black on a JPEG canvas, which is how a
  // screenshot with a transparent corner turns into an ink blot in the bubble.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/**
 * A send-ready version of an operator's image: at most `maxDimension` on its
 * long edge and re-encoded towards `targetBytes`.
 *
 * Returns the original file untouched when it is already small enough, when it
 * is a format a canvas would damage, or when anything at all goes wrong.
 */
export const prepareOutboundImage = async (file, options = {}) => {
  const maxDimension = Number(options.maxDimension || MAX_OUTBOUND_IMAGE_DIMENSION);
  const targetBytes = Number(options.targetBytes || OUTBOUND_IMAGE_TARGET_BYTES);
  const named = namedAttachmentFile(file);
  if (!named || !isImageFile(named)) return named;
  if (PASSTHROUGH_TYPES.includes(clean(named.type).toLowerCase())) return named;
  if (typeof document === "undefined") return named;

  let source = null;
  try {
    source = await decodeImage(named);
    if (!source) return named;
    const { width, height } = imageSize(source);
    if (!width || !height) return named;
    // Already small in both senses: re-encoding it would only lose quality.
    if (Math.max(width, height) <= maxDimension && Number(named.size || 0) <= targetBytes) return named;

    // Drawn ONCE per dimension: re-encoding the same canvas at a lower quality
    // costs a fraction of scaling a 12 MP photo again, and only a picture that
    // is still too heavy at the lowest quality is ever redrawn smaller.
    let smallest = null;
    const encodeFrom = async (dimension, qualities) => {
      const canvas = drawScaled(source, dimension);
      if (!canvas) return false;
      for (const quality of qualities) {
        // Sequential on purpose: each attempt only runs when the previous one
        // came back over target.
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (!blob || !blob.size) return false;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= targetBytes) return true;
      }
      return false;
    };
    const fallbackDimension = Math.min(maxDimension, FALLBACK_OUTBOUND_IMAGE_DIMENSION);
    const done = await encodeFrom(maxDimension, [0.82, 0.7, 0.6]);
    if (!done && fallbackDimension < maxDimension) await encodeFrom(fallbackDimension, [0.6]);
    // Re-encoding a small PNG can make it BIGGER; keep whichever is smaller.
    if (!smallest || smallest.size >= Number(named.size || 0)) return named;

    const baseName = clean(named.name).replace(/\.[^./\\]+$/, "") || "image";
    return new File([smallest], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return named;
  } finally {
    if (source && typeof source.close === "function") source.close();
  }
};

export default prepareOutboundImage;
