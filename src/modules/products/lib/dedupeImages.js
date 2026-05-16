const normalizeText = (value) => String(value ?? "").trim();

const normalizeUrlKey = (value) => {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.startsWith("blob:") || text.startsWith("data:")) return "";

  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(text, origin);
    if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
    }
  } catch {
    return text.toLowerCase();
  }

  return text.toLowerCase();
};

const imageKeys = (image = {}) => {
  if (typeof image === "string") {
    const url = normalizeUrlKey(image);
    return url ? [`url:${url}`] : [];
  }

  const keys = [];
  const id = normalizeText(image.id ?? image.image_id ?? image.imageId);
  if (id) keys.push(`id:${id}`);

  [
    image.url,
    image.image_url,
    image.imageUrl,
    image.path,
    image.file_path,
    image.filePath,
    image.product_image_url,
    image.variant_image_url,
    image.color_image_url,
    image.image,
  ].forEach((value) => {
    const url = normalizeUrlKey(value);
    if (url) keys.push(`url:${url}`);
  });

  const name = normalizeText(image.name ?? image.file_name ?? image.fileName);
  const size = normalizeText(image.size ?? image.file_size ?? image.fileSize);
  if (name && size) keys.push(`file:${name.toLowerCase()}:${size}`);

  return keys;
};

export const dedupeImages = (images = []) => {
  const seen = new Set();
  const unique = [];

  for (const image of Array.isArray(images) ? images : []) {
    const keys = imageKeys(image);
    if (keys.length > 0 && keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    unique.push(image);
  }

  return unique;
};
