/*
 * The onError walk for a product photo: the original file, then the alternates, then the site logo.
 *
 * Its progress lives on the <img> node (data-original-tried, data-tried-src, data-fallback-applied), and
 * React reuses that node when the product page's main photo or the sticky-bar thumbnail moves to another
 * photo or colour. The flags used to outlive the photo they were set for: after one failure, the next
 * missing -wN derivative skipped the original file that exists and showed the logo, and after that every
 * failure left a broken image. So the walk remembers which photo its flags belong to and which src it set
 * itself, and starts over when React has put a different photo on the node.
 *
 * Works on anything shaped like an <img> (dataset, src, getAttribute, removeAttribute), so it can be
 * tested without a DOM.
 */

export const PRODUCT_IMAGE_PLACEHOLDER = "/favicon.svg";

const FLAGS = ["originalTried", "triedSrc", "fallbackApplied", "fallbackFor", "fallbackAssignedSrc"];

const srcAttribute = (node) => String(
  (typeof node.getAttribute === "function" ? node.getAttribute("src") : null) ?? node.src ?? ""
);

const assignSrc = (node, src) => {
  node.dataset.fallbackAssignedSrc = src;
  node.src = src;
};

// True when the node now shows a photo other than the one the stored flags were written for.
export const imageFallbackIsStale = (node) => {
  const dataset = node?.dataset;
  if (!dataset || (dataset.fallbackFor === undefined && dataset.fallbackAssignedSrc === undefined)) return false;
  const originalSrc = String(dataset.originalSrc || "").trim();
  if (String(dataset.fallbackFor || "") !== originalSrc) return true;
  return dataset.fallbackAssignedSrc !== undefined && srcAttribute(node) !== dataset.fallbackAssignedSrc;
};

export const resetImageFallback = (node) => {
  FLAGS.forEach((flag) => {
    delete node.dataset[flag];
  });
};

/** One step of the walk for a failed load. Returns what it did, for tests and debugging. */
export const applyProductImageFallback = (node) => {
  if (!node?.dataset) return "ignored";
  if (imageFallbackIsStale(node)) resetImageFallback(node);
  if (node.dataset.fallbackApplied === "true") return "exhausted";
  const originalSrc = String(node.dataset.originalSrc || "").trim();
  node.dataset.fallbackFor = originalSrc;
  node.removeAttribute?.("srcset");
  node.removeAttribute?.("sizes");
  if (originalSrc && node.dataset.originalTried !== "true") {
    node.dataset.originalTried = "true";
    // Re-assigning the identical URL is the point. The common failure is a
    // missing -wN.webp derivative while the original JPEG is fine, and in that
    // case src already holds the original -- so a `node.src !== originalSrc`
    // guard skipped straight past a working image to the site favicon. Dropping
    // srcset does not by itself start a new load; assigning src does, and it now
    // resolves against the empty srcset. If the original is dead too, onError
    // fires again with originalTried set and the alternates still run.
    assignSrc(node, originalSrc);
    return "original";
  }
  const tried = String(node.dataset.triedSrc || "").split("|").filter(Boolean);
  const current = srcAttribute(node);
  const next = String(node.dataset.fallbackSrc || "")
    .split("|")
    .map((url) => url.trim())
    .find((url) => url && url !== node.src && url !== current && !tried.includes(url));
  if (next) {
    node.dataset.triedSrc = [...tried, next].join("|");
    assignSrc(node, next);
    return "alternate";
  }
  node.dataset.fallbackApplied = "true";
  assignSrc(node, PRODUCT_IMAGE_PLACEHOLDER);
  return "placeholder";
};
