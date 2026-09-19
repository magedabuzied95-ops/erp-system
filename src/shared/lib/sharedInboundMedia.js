/**
 * A reel or post the customer forwards from the app to ask about it.
 *
 * Meta types these by where they came from (`ig_reel`, `ig_post`, `share`) rather
 * than by what they are, and hands the caption over inside `payload` instead of as
 * a title. The inbox therefore read a forwarded reel as a nameless document called
 * "ig_reel" — no player, no caption, nothing saying the customer was pointing at
 * one of our own posts.
 *
 * One copy for both sides: the Meta webhook types the attachment on the way in and
 * the transcript buckets it on the way out, and the two disagreeing is exactly how
 * the defect would come back. Plain JavaScript so the rule can be exercised
 * directly — the transcript's classifier is JSX, which the test runner cannot
 * import, so a rule living there could only ever be asserted against its source.
 */
const clean = (value = "") => String(value || "").trim();

export const SHARED_MEDIA_KINDS = { ig_reel: "reel", reel: "reel", ig_post: "post", post: "post", share: "post" };

const attachmentType = (attachment = {}) =>
  clean(attachment.type || attachment.media_type || attachment.message_type).toLowerCase();

/** "reel" or "post" for a forwarded attachment, "" for anything the customer sent themselves. */
export const sharedMediaKind = (attachment = {}) =>
  clean(attachment.metadata?.share_kind).toLowerCase() || SHARED_MEDIA_KINDS[attachmentType(attachment)] || "";

/**
 * Which bubble a forwarded reel or post belongs in. What was forwarded decides it;
 * the mime only overrides when it names real media, because Meta's CDN serves a
 * reel as `application/octet-stream` as readily as `video/mp4` — and that header
 * was what used to file a playable clip under "documents".
 */
export const sharedMediaBucket = (shared = "", mimeType = "") => {
  if (!shared) return "";
  const mime = clean(mimeType).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return shared === "reel" ? "video" : "image";
};

/** A reel whose title is its own type name is one we stored before this was fixed. */
export const isTypeNameTitle = (value = "") => Boolean(SHARED_MEDIA_KINDS[clean(value).toLowerCase()]);
