/*
 * A post's comments as Facebook and Instagram draw them.
 *
 * The thread used to be a column of identical cards — every reply, the page's own
 * answers included, stacked as a top-level comment with a platform pill and a clock
 * chip on it. What an operator needs is to recognise what the customer sees on
 * their phone: who wrote it (face + name), what they wrote, and which comment a
 * reply belongs to.
 *
 * Pure: no React, no fetch, so it is unit-tested directly.
 */

const clean = (value = "") => String(value ?? "").trim();
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A thread comment reaches the UI wrapped up to twice (server row → thread
// normalizer `raw` → workspace normalizer `raw`), and each layer keeps a different
// subset of the row's fields. Everything below reads through all of them.
const layersOf = (comment = {}) => {
  const layers = [];
  let current = isObject(comment) ? comment : {};
  for (let depth = 0; depth < 4 && isObject(current); depth += 1) {
    if (layers.includes(current)) break;
    layers.push(current);
    current = current.raw;
  }
  return layers;
};

const payloadsOf = (layer = {}) =>
  [layer.raw_payload, layer.source_raw_payload].filter(isObject);

const firstField = (comment = {}, read) => {
  for (const layer of layersOf(comment)) {
    const value = clean(read(layer));
    if (value) return value;
  }
  return "";
};

export const resolveCommentOwnId = (comment = {}) =>
  firstField(comment, (layer) => layer.comment_id || layer.external_comment_id || layer.provider_comment_id || layer.metadata?.comment_id || "");

export const resolveCommentParentId = (comment = {}) =>
  firstField(comment, (layer) => {
    const direct = layer.parent_comment_id || layer.parentId || layer.parent_id || layer.metadata?.parent_comment_id || "";
    if (clean(direct)) return direct;
    for (const payload of payloadsOf(layer)) {
      const value = payload.value?.parent_id || payload.value?.parent?.id || payload.comment?.parent?.id || payload.parent_comment_id || "";
      if (clean(value)) return value;
    }
    return "";
  });

export const resolveCommenterId = (comment = {}) =>
  firstField(comment, (layer) => {
    const direct = layer.commenter_id || layer.source_commenter_id || "";
    if (clean(direct)) return direct;
    for (const payload of payloadsOf(layer)) {
      const value = payload.value?.from?.id || payload.from?.id || payload.comment?.from?.id || "";
      if (clean(value)) return value;
    }
    return "";
  });

// The page answering in its own comments. The ingest marks it (`is_page_authored`)
// on the webhook path; the poll path only records the page id, and on Facebook the
// post id itself starts with it ("<page id>_<post id>").
export const isPageAuthoredComment = (comment = {}) => {
  const commenterId = resolveCommenterId(comment);
  for (const layer of layersOf(comment)) {
    if (layer.is_page_authored === true || layer.isPageAuthored === true) return true;
    for (const payload of payloadsOf(layer)) {
      if (payload.is_page_authored === true) return true;
      if (commenterId && [payload.page_id, payload.entry_id].map(clean).includes(commenterId)) return true;
    }
  }
  if (!commenterId) return false;
  const postId = firstField(comment, (layer) => layer.post_id || layer.postId || "");
  return postId.includes("_") && postId.split("_")[0] === commenterId;
};

// Facebook comment ids are "<object id>_<comment id>" and a parent can be written
// either way, so a reply is matched on the full id first and the tail second.
const idTail = (value = "") => {
  const safe = clean(value);
  const index = safe.lastIndexOf("_");
  return index >= 0 ? safe.slice(index + 1) : safe;
};

/*
 * Top-level comments with their replies under them, in the order the platforms use:
 * comments oldest first, each comment's replies oldest first. A reply to a reply is
 * filed under the comment that started the conversation — Facebook shows two levels
 * and Instagram one, never a staircase. A reply whose parent is not in the list
 * (outside the loaded window, or deleted) stays a top-level comment rather than
 * disappearing.
 */
export const threadCommentsForDisplay = (comments = [], { keyOf = resolveCommentOwnId } = {}) => {
  const list = (Array.isArray(comments) ? comments : []).filter(Boolean);
  const byId = new Map();
  const byTail = new Map();
  list.forEach((comment) => {
    const id = clean(keyOf(comment));
    if (!id) return;
    if (!byId.has(id)) byId.set(id, comment);
    const tail = idTail(id);
    if (tail && !byTail.has(tail)) byTail.set(tail, comment);
  });
  const parentOf = (comment) => {
    const parentId = resolveCommentParentId(comment);
    if (!parentId) return null;
    const parent = byId.get(parentId) || byTail.get(idTail(parentId)) || null;
    return parent && parent !== comment ? parent : null;
  };
  const rootOf = (comment) => {
    let current = comment;
    const seen = new Set([comment]);
    for (let depth = 0; depth < 8; depth += 1) {
      const parent = parentOf(current);
      if (!parent || seen.has(parent)) break;
      seen.add(parent);
      current = parent;
    }
    return current;
  };
  const groups = new Map();
  const order = [];
  list.forEach((comment) => {
    const root = rootOf(comment);
    if (!groups.has(root)) {
      groups.set(root, { comment: root, replies: [] });
      order.push(root);
    }
    if (root !== comment) groups.get(root).replies.push(comment);
  });
  return order.map((root) => groups.get(root));
};

/*
 * "٣ س", "٢ ي", "٤ أ" — the stamp Facebook and Instagram put under a comment. The
 * full date lives in the tooltip.
 */
export const compactCommentAge = (value, now = new Date(), language = "ar") => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "";
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  const seconds = Math.max(0, Math.floor((nowTime - time) / 1000));
  const ar = language === "ar";
  const number = (count) => (ar ? Number(count).toLocaleString("ar-EG") : String(count));
  if (seconds < 60) return ar ? "الآن" : "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ar ? `${number(minutes)} د` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ar ? `${number(hours)} س` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return ar ? `${number(days)} ي` : `${days}d`;
  const weeks = Math.floor(days / 7);
  if (days < 365) return ar ? `${number(weeks)} أ` : `${weeks}w`;
  return date.toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" });
};

export const commentPlatformOf = (comment = {}, fallback = "facebook") => {
  const raw = firstField(comment, (layer) => layer.platform || layer.metadata?.platform || "").toLowerCase() || clean(fallback).toLowerCase();
  return raw.includes("instagram") ? "instagram" : "facebook";
};

/*
 * Values, not Tailwind classes, for the same two reasons messagePlatform.js gives:
 * html[data-theme] re-points colour utilities at the theme tokens with !important,
 * and a brand colour is data, so it travels as an inline style.
 *
 *   canvas   the surface the comments sit on (Facebook's post card, Instagram's page)
 *   bubble   Facebook's grey comment bubble; Instagram draws none
 *   ink      comment text and the author name
 *   meta     the time / Like / Reply row
 *   accent   "Like" once it is pressed
 *   thread   the line that ties replies to their comment
 */
const COMMENT_CHROME = {
  facebook: {
    dark: { canvas: "#242526", bubble: "#3a3b3c", ink: "#e4e6eb", meta: "#b0b3b8", accent: "#2d88ff", thread: "#3e4042", selected: "rgba(45,136,255,0.14)", avatarBg: "#4e4f50", avatarInk: "#e4e6eb" },
    light: { canvas: "#ffffff", bubble: "#f0f2f5", ink: "#050505", meta: "#65676b", accent: "#0866ff", thread: "#ced0d4", selected: "rgba(8,102,255,0.08)", avatarBg: "#e4e6eb", avatarInk: "#65676b" },
  },
  instagram: {
    dark: { canvas: "#000000", bubble: "", ink: "#f5f5f5", meta: "#a8a8a8", accent: "#ff3040", thread: "#262626", selected: "rgba(255,255,255,0.07)", avatarBg: "#262626", avatarInk: "#a8a8a8" },
    light: { canvas: "#ffffff", bubble: "", ink: "#0f0f0f", meta: "#737373", accent: "#ff3040", thread: "#dbdbdb", selected: "rgba(0,0,0,0.04)", avatarBg: "#efefef", avatarInk: "#737373" },
  },
};

export const commentChrome = (platform = "facebook", mode = "dark") => {
  const family = COMMENT_CHROME[platform === "instagram" ? "instagram" : "facebook"];
  return family[mode === "light" ? "light" : "dark"];
};

// A thread that mixes both platforms sits on Facebook's surface; an Instagram-only
// one on Instagram's.
export const commentThreadCanvas = (comments = [], mode = "dark", fallbackPlatform = "facebook") => {
  const platforms = new Set((Array.isArray(comments) ? comments : []).map((comment) => commentPlatformOf(comment, fallbackPlatform)));
  const platform = platforms.size === 1 ? [...platforms][0] : platforms.size ? "facebook" : commentPlatformOf({}, fallbackPlatform);
  return { platform, mixed: platforms.size > 1, canvas: commentChrome(platform, mode).canvas };
};
