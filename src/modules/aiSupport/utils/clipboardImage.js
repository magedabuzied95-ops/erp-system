/*
 * The image an operator just copied, offered back to them before it is sent.
 *
 * Messenger notices a fresh screenshot and floats it over the composer with a
 * send button. A web page cannot see the photo library, so the clipboard is the
 * nearest thing: a screenshot copied on the phone (tap the thumbnail, Copy) or
 * taken with Win+Shift+S on a PC is sitting there when the operator comes back
 * to the inbox.
 *
 * Reading it is gated by the browser:
 * - Chrome/Edge read silently once the site holds `clipboard-read`; until then
 *   a read prompts, so the inbox only ever reads on its own when the permission
 *   is already granted, and otherwise waits for the operator's tap.
 * - Safari has no permission to hold. Every read shows its own "Paste" callout,
 *   so it is only ever attempted from a tap.
 *
 * The same picture stays on the clipboard for hours. Its fingerprint is
 * remembered once it has been offered, sent or dismissed, so it is offered once.
 */

const SEEN_STORAGE_KEY = "ai-inbox:clipboard-images-seen";
const SEEN_LIMIT = 20;

export const clipboardReadSupported = () =>
  typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";

/** "granted" | "prompt" | "denied" | "unsupported" — never throws. */
export const clipboardReadPermission = async () => {
  if (!clipboardReadSupported()) return "unsupported";
  try {
    const status = await navigator.permissions?.query?.({ name: "clipboard-read" });
    return status?.state || "unsupported";
  } catch {
    // Safari and Firefox do not know the permission name at all.
    return "unsupported";
  }
};

const extensionFor = (type = "") => {
  const subtype = String(type).split("/")[1] || "png";
  if (subtype === "jpeg") return "jpg";
  return subtype.replace(/[^a-z0-9]/gi, "") || "png";
};

/**
 * The first image on the clipboard as a File, or null.
 * `null` also covers a refused read: nothing to offer is not an error.
 */
export const readClipboardImage = async () => {
  if (!clipboardReadSupported()) return null;
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return null;
  }
  for (const item of Array.from(items || [])) {
    const type = Array.from(item?.types || []).find((entry) => String(entry).startsWith("image/"));
    if (!type) continue;
    try {
      const blob = await item.getType(type);
      if (!blob || !blob.size) continue;
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      return new File([blob], `clipboard-${stamp}.${extensionFor(type)}`, { type, lastModified: Date.now() });
    } catch {
      // A type the browser lists but will not hand over; try the next item.
    }
  }
  return null;
};

/** Content fingerprint: the name and timestamp change on every read, the bytes do not. */
export const imageFingerprint = async (file) => {
  if (!file) return "";
  const base = `${file.type || ""}:${file.size || 0}`;
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hex = Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${base}:${hex}`;
  } catch {
    return base;
  }
};

const readSeen = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const wasImageSeen = (fingerprint) => Boolean(fingerprint) && readSeen().includes(fingerprint);

export const rememberImageSeen = (fingerprint) => {
  if (!fingerprint) return;
  try {
    const next = [fingerprint, ...readSeen().filter((entry) => entry !== fingerprint)].slice(0, SEEN_LIMIT);
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the picture may be offered again, which is harmless.
  }
};
