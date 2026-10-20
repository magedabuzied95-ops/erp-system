// Session-only local previews (blob URLs) keyed by Meta's image_hash / video_id, so a
// freshly uploaded video shows before Meta has generated its thumbnail.
const localPreviews = new Map();

const keyOf = (media) => (media?.type === "video" ? media.video_id : media?.image_hash);

export const rememberPreview = (media, file) => {
  const key = keyOf(media);
  if (key && file) localPreviews.set(key, { url: URL.createObjectURL(file), kind: media.type });
};

export const previewUrlFor = (media) => {
  if (!media) return "";
  return localPreviews.get(keyOf(media))?.url || media.url || media.thumbnail_url || "";
};

export const localPreviewKind = (media) => (media ? localPreviews.get(keyOf(media))?.kind || "" : "");
