/*
 * "Has anything changed on this post since we last read its comments?"
 *
 * The comment poller used to read the comments of every one of the page's last 100
 * posts on every run — about two Graph calls per post, every minute that webhooks
 * were quiet — only to find each comment already stored and skip it. The post list
 * it already fetches carries each post's comment count (comments.summary /
 * comments_count), so a post whose count has not moved since the last read has
 * nothing new to read.
 *
 * Two guards keep that from missing anything:
 *   - a post is re-read anyway after RECHECK_MS, because a new comment and a deleted
 *     one leave the count unchanged;
 *   - a post never read since this process started is read, but only a few per run
 *     (firstReadsPerRun), so a restart spreads its catch-up over several runs instead
 *     of spending one burst of the shared budget.
 *
 * Pure and in-memory: a restart only costs that spread-out catch-up.
 */

const envNumber = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const COMMENT_POLL_RECHECK_MS = envNumber("META_COMMENT_POLL_RECHECK_MS", 6 * 60 * 60 * 1000);
export const COMMENT_POLL_FIRST_READS_PER_RUN = envNumber("META_COMMENT_POLL_FIRST_READS_PER_RUN", 15);

export const commentPollKey = (tenantId, platform, postId) => `${Number(tenantId) || 0}|${String(platform || "").toLowerCase()}|${String(postId || "").trim()}`;

// Facebook's feed row carries comments.summary.total_count; Instagram media carries
// comments_count. Anything unreadable is "unknown", which means "read it".
export const graphCommentCount = (post = {}) => {
  const candidates = [post?.comments?.summary?.total_count, post?.comments_count, post?.comment_count];
  for (const value of candidates) {
    if (value === null || value === undefined || value === "") continue;
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
};

export const createCommentCountMemo = ({ now = () => Date.now(), recheckMs = COMMENT_POLL_RECHECK_MS, maxEntries = 5000 } = {}) => {
  const seen = new Map();
  return {
    /*
     * Decide for one post: "read" | "unchanged" | "empty" | "first".
     *   first      never read since boot — read it, subject to the per-run allowance
     *   read       the count moved, or the last read is older than recheckMs
     */
    decide(key, count) {
      if (count === 0) return "empty";
      const entry = seen.get(key);
      if (!entry) return "first";
      if (count === null || count === undefined) return "read";
      if (entry.count !== count) return "read";
      return now() - entry.at >= recheckMs ? "read" : "unchanged";
    },
    remember(key, count) {
      if (count === null || count === undefined) return;
      seen.delete(key);
      seen.set(key, { count, at: now() });
      while (seen.size > maxEntries) seen.delete(seen.keys().next().value);
    },
    forget(key) {
      seen.delete(key);
    },
    size: () => seen.size,
  };
};

/*
 * One run's plan over a list of posts (newest first): which to read now. Posts never
 * read before are allowed up to `firstReadsPerRun`; the rest wait for a later run
 * (they are not remembered, so they stay "first" until read).
 */
export const planCommentPoll = ({ posts = [], memo, keyOf, firstReadsPerRun = COMMENT_POLL_FIRST_READS_PER_RUN } = {}) => {
  const plan = { read: [], skipped: { unchanged: 0, empty: 0, deferred: 0 } };
  let firstReads = 0;
  for (const post of Array.isArray(posts) ? posts : []) {
    const count = graphCommentCount(post);
    const decision = memo.decide(keyOf(post), count);
    if (decision === "empty") plan.skipped.empty += 1;
    else if (decision === "unchanged") plan.skipped.unchanged += 1;
    else if (decision === "first" && firstReads >= firstReadsPerRun) plan.skipped.deferred += 1;
    else {
      if (decision === "first") firstReads += 1;
      plan.read.push({ post, count });
    }
  }
  return plan;
};
