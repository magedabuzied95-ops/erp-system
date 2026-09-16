/*
 * A photo taken on a phone, made uploadable.
 *
 * Phone photos are 5-12MB and often HEIC; the customer-facing uploads take PNG/JPG/WEBP of a few
 * megabytes. A file that already fits is sent untouched; anything else is redrawn as a JPEG no
 * wider than `maxEdge`, which keeps a screenshot or a photo of a shoe perfectly readable. A file
 * the browser cannot decode is sent as it is, and the server says what is wrong with it.
 *
 * Shared by the shipping-fee upload (/pay/:code) and the review link (/review/:code).
 */

export const UPLOAD_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const prepareImageUpload = (
  file,
  { maxBytes = 4 * 1024 * 1024, maxEdge = 2000, fileName = "photo.jpg", quality = 0.85 } = {}
) => new Promise((resolve) => {
  if (!file) return resolve(null);
  if (UPLOAD_ACCEPTED_TYPES.has(file.type) && file.size <= maxBytes) return resolve(file);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      resolve(blob ? new File([blob], fileName, { type: "image/jpeg" }) : file);
    }, "image/jpeg", quality);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    resolve(file);
  };
  image.src = url;
});
