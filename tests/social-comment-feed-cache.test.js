import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SERVICE = fs.readFileSync("server/services/socialCommentsCenterService.js", "utf8");
const ROUTE = fs.readFileSync("server/routes/socialComments.js", "utf8");
const INBOX = fs.readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");

test("the Meta feed is no longer fetched unconditionally per request", () => {
  // Every call used to hit the Graph API: a page-feed fetch for Facebook and a
  // media + comments sync for Instagram, which was the list's whole fixed cost.
  assert.match(SERVICE, /const feedResult = await loadSocialCommentFeedCached\(\{/);
  assert.match(SERVICE, /const SOCIAL_COMMENT_FEED_CACHE_TTL_MS = /);
});

test("a failed or empty feed is not cached", () => {
  // Caching a transient Graph failure would pin the list to the DB fallback for the
  // whole TTL, hiding posts that do exist.
  assert.match(SERVICE, /const cacheable = Boolean\(value\?\.success !== false && Array\.isArray\(value\?\.posts\) && value\.posts\.length\);/);
  assert.match(SERVICE, /else socialCommentFeedCache\.delete\(key\);/);
  assert.match(SERVICE, /catch \(error\) \{\s*socialCommentFeedCache\.delete\(key\);/);
});

test("concurrent callers share one in-flight fetch", () => {
  assert.match(SERVICE, /if \(entry\.promise\) \{[\s\S]*?return entry\.promise;/);
});

test("an explicit refresh bypasses the cache end to end", () => {
  // Route accepts it, the service threads it, and the desktop sends it on manual refresh.
  assert.match(ROUTE, /forceRefresh: \["1", "true", "yes"\]\.includes\(String\(req\.query\?\.refresh \|\| ""\)/);
  assert.match(SERVICE, /const loadSocialCommentFeedCached = async \(\{[^}]*forceRefresh = false/);
  assert.match(SERVICE, /if \(!forceRefresh && entry\)/);
  assert.match(INBOX, /\.\.\.\(forceRefresh \? \{ refresh: 1 \} : \{\}\)/);
  assert.match(INBOX, /void loadAll\(\{ silent, forceRefresh: source === "manual" \}\)/);
});

test("both platforms and the single-platform path pass the flag through", () => {
  const calls = SERVICE.match(/listSocialCommentPostsForPlatform\(\{[^)]*?\}\)/gs) || [];
  assert.ok(calls.length >= 3, "expected the platform helper to be called from both paths");
  for (const call of calls) {
    assert.ok(/forceRefresh/.test(call), `a caller drops forceRefresh: ${call.slice(0, 80)}`);
  }
});
