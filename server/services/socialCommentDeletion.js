/* A comment deleted on Facebook or Instagram has to leave the inbox too.

   Nothing used to notice. The webhook gate accepted only add/edited verbs, so Facebook's
   `verb: "remove"` was dropped on the floor, and every sync path only ever ADDED rows — so a
   thread kept showing comments that were no longer on the post, and the post's comment count
   only ever grew.

   Two ways a deletion reaches us now:
   - Facebook's feed webhook names it (`item: "comment"`, `verb: "remove"`), instantly.
   - Opening a thread reconciles it: the post's live comment ids are listed from Graph, and a
     stored comment missing from that list is asked for by its own id. Only an answer of "this
     object does not exist" marks it deleted. Instagram sends no deletion webhook at all, so
     this is the only way an Instagram deletion is ever seen.

   The list alone is never trusted to delete anything: a hidden comment, a reply the list did
   not expand, or a comment filed under this post but living on a sibling object (a photo, an
   ad's dark post) can all be absent from it while still very much existing.

   Pure functions only — no database, no network — so the rules can be tested directly. */

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const lower = (value) => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Facebook comment ids are `{objectId}_{commentId}`; the same comment can be reported under a
// post id or its photo's object id, so the trailing segment is what identifies it.
export const socialCommentIdSuffix = (value = "") => {
  const safe = text(value);
  if (!safe) return "";
  return safe.split("_").pop() || safe;
};

export const extractSocialCommentRemovalEvents = ({ body = {} } = {}) => {
  const platform = lower(body?.object) === "instagram" ? "instagram" : "facebook";
  const events = [];
  for (const entry of asArray(body?.entry)) {
    for (const change of asArray(entry?.changes)) {
      const field = lower(change?.field);
      const value = change?.value && typeof change.value === "object" ? change.value : {};
      if (lower(value.verb) !== "remove") continue;
      const isFacebookComment = field === "feed" && lower(value.item) === "comment";
      const isInstagramComment = platform === "instagram" && field === "comments";
      if (!isFacebookComment && !isInstagramComment) continue;
      // Only the comment's own id may name it. A post id or the page id (entry.id) would mark
      // the wrong row — the same trap that once filed page likes as comments.
      const commentId = text(value.comment_id || (isInstagramComment ? value.id : ""));
      if (!commentId) continue;
      events.push({
        platform,
        comment_id: commentId,
        post_id: text(value.post_id || value.media?.id || value.media_id || ""),
        parent_id: text(value.parent_id || ""),
      });
    }
  }
  return events;
};

/* Is this Graph failure Meta saying "no such object"?

   Code 100 / subcode 33 reads "Object with ID … does not exist, cannot be loaded due to missing
   permissions, or does not support this operation". The missing-permission half is excluded by
   the caller: it only asks after the SAME token has just listed the post's comments. A rate
   limit, a timeout, a 5xx or an expired token must never read as a deletion. */
export const isGraphObjectMissingError = (error = {}) => {
  const meta = error?.meta || error?.metaResponse?.error || {};
  const code = Number(meta?.code ?? error?.code ?? 0);
  const subcode = Number(meta?.error_subcode ?? 0);
  const status = Number(error?.status || 0);
  const message = lower(meta?.message || error?.message || "");
  if (code === 100 && subcode === 33) return true;
  if (code === 100 && /does not exist/.test(message)) return true;
  if (status === 404 && !code) return true;
  return false;
};

/* Decide what a reconcile pass should do with a post's stored comments.

   storedRows: [{ comment_id, deleted_at }] for the post.
   liveIds:    every comment id Graph listed for it.
   complete:   whether the listing reached its last page. A partial listing cannot tell a missing
               comment from one it never got to, so nothing is checked from it.

   Returns the ids to confirm one by one (never more than maxChecks) and the ids that were marked
   deleted but are listed again — those are restored, which also heals any false positive. */
export const planSocialCommentDeletionReconcile = ({
  storedRows = [],
  liveIds = [],
  complete = false,
  maxChecks = 40,
  recentlyVerifiedIds = new Set(),
} = {}) => {
  const live = new Set();
  for (const id of liveIds instanceof Set ? [...liveIds] : asArray(liveIds)) {
    const safe = text(id);
    if (!safe) continue;
    live.add(safe);
    live.add(socialCommentIdSuffix(safe));
  }
  const isLive = (commentId) => live.has(commentId) || live.has(socialCommentIdSuffix(commentId));
  const toCheck = [];
  const toRestore = [];
  const seen = new Set();
  for (const row of asArray(storedRows)) {
    const commentId = text(row?.comment_id);
    if (!commentId || seen.has(commentId)) continue;
    seen.add(commentId);
    const deleted = Boolean(row?.deleted_at);
    if (isLive(commentId)) {
      if (deleted) toRestore.push(commentId);
      continue;
    }
    if (deleted || !complete) continue;
    if (recentlyVerifiedIds.has(commentId)) continue;
    toCheck.push(commentId);
  }
  const cap = Math.max(0, Number(maxChecks) || 0);
  return { toCheck: toCheck.slice(0, cap), toRestore, skippedChecks: Math.max(0, toCheck.length - cap) };
};
