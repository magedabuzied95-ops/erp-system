import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  commentPollKey,
  createCommentCountMemo,
  graphCommentCount,
  planCommentPoll,
} from "../server/services/socialCommentPollMemo.js";
import {
  __metaGraphMeterTestHooks,
  describeGraphEndpoint,
  getGraphUsageByCaller,
  graphCallerFromStack,
  installGraphFetchMeter,
} from "../server/services/metaGraphRateLimiter.js";

const post = (id, count) => ({ id, comments: { summary: { total_count: count } } });

test("the comment count is read from both platforms' shapes", () => {
  assert.equal(graphCommentCount(post("a", 7)), 7);
  assert.equal(graphCommentCount({ comments_count: 3 }), 3);
  assert.equal(graphCommentCount({ comments_count: "0" }), 0);
  assert.equal(graphCommentCount({}), null);
});

test("a post is read when first seen, skipped while its count holds, read again when it moves", () => {
  let clock = 1_000_000;
  const memo = createCommentCountMemo({ now: () => clock, recheckMs: 60_000 });
  const key = commentPollKey(1, "facebook", "P1");
  assert.equal(memo.decide(key, 5), "first");
  memo.remember(key, 5);
  assert.equal(memo.decide(key, 5), "unchanged");
  assert.equal(memo.decide(key, 6), "read");
  assert.equal(memo.decide(key, 4), "read", "a deletion moves the count too");
  assert.equal(memo.decide(key, null), "read", "an unreadable count is never trusted");
  clock += 60_000;
  assert.equal(memo.decide(key, 5), "read", "a new comment and a deleted one cancel out — recheck after a while");
  assert.equal(memo.decide(commentPollKey(1, "facebook", "P2"), 0), "empty");
});

test("one run reads only changed posts, and spreads the catch-up after a restart", () => {
  const memo = createCommentCountMemo({ now: () => 0, recheckMs: 1e12 });
  const keyOf = (item) => commentPollKey(1, "facebook", item.id);
  const posts = Array.from({ length: 40 }, (_, index) => post(`P${index}`, index % 4 === 0 ? 0 : 3));
  const first = planCommentPoll({ posts, memo, keyOf, firstReadsPerRun: 10 });
  assert.equal(first.read.length, 10);
  assert.equal(first.skipped.empty, 10);
  assert.equal(first.skipped.deferred, 20);
  first.read.forEach(({ post: item, count }) => memo.remember(keyOf(item), count));

  const second = planCommentPoll({ posts, memo, keyOf, firstReadsPerRun: 10 });
  assert.equal(second.read.length, 10, "the next ten never-read posts");
  assert.equal(second.skipped.unchanged, 10, "the ten read last run have not moved");
  second.read.forEach(({ post: item, count }) => memo.remember(keyOf(item), count));
  const third = planCommentPoll({ posts, memo, keyOf, firstReadsPerRun: 10 });
  third.read.forEach(({ post: item, count }) => memo.remember(keyOf(item), count));

  // steady state: nothing moved, nothing read
  const quiet = planCommentPoll({ posts, memo, keyOf, firstReadsPerRun: 10 });
  assert.equal(quiet.read.length, 0);
  assert.equal(quiet.skipped.unchanged, 30);

  // one new comment on one post: exactly that post is read
  const changed = posts.map((item) => (item.id === "P5" ? post("P5", 4) : item));
  const next = planCommentPoll({ posts: changed, memo, keyOf, firstReadsPerRun: 10 });
  assert.deepEqual(next.read.map(({ post: item }) => item.id), ["P5"]);
});

test("a Graph endpoint is described by its shape, never its ids or token", () => {
  assert.equal(describeGraphEndpoint("https://graph.facebook.com/v20.0/109139174713691_1141007521595948/comments?access_token=SECRET&limit=50"), "GET /{id}/comments");
  assert.equal(describeGraphEndpoint("https://graph.facebook.com/v20.0/27709706065286127?fields=name", "get"), "GET /{id}");
  assert.equal(describeGraphEndpoint("https://graph.instagram.com/17841400000000001/media", "POST"), "POST /{id}/media");
  assert.equal(describeGraphEndpoint("https://graph.facebook.com/me/accounts"), "GET /me/accounts");
});

test("the caller is the chain of functions that asked, not the fetch plumbing", () => {
  const stack = [
    "Error",
    "    at meteredGraphFetch (file:///app/server/services/metaGraphRateLimiter.js:10:3)",
    "    at callMetaGet (file:///app/server/services/metaIntegrationService.js:2661:26)",
    "    at async fetchMetaPagePostsPage (file:///app/server/services/metaIntegrationService.js:5133:19)",
    "    at async fetchMetaPagePostsForPolling (file:///app/server/services/metaIntegrationService.js:5510:16)",
    "    at async runMetaCommentsPollingScan (file:///app/server/services/metaIntegrationService.js:9632:21)",
  ].join("\n");
  assert.equal(graphCallerFromStack(stack), "fetchMetaPagePostsPage < fetchMetaPagePostsForPolling < runMetaCommentsPollingScan");
  assert.equal(graphCallerFromStack("Error\n    at file:///app/x.js:1:1"), "unknown");
});

test("the meter counts Graph calls through the global fetch and leaves other hosts alone", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    return new Response("{}", { status: String(input).includes("fail") ? 400 : 200, headers: { "x-app-usage": JSON.stringify({ call_count: 12, total_cputime: 1, total_time: 2 }) } });
  };
  try {
    __metaGraphMeterTestHooks.reset();
    assert.equal(installGraphFetchMeter({ report: false }), true);
    async function fetchPostsForTest() {
      return fetch("https://graph.facebook.com/v20.0/123456789/posts?access_token=x");
    }
    await fetchPostsForTest();
    await fetchPostsForTest();
    await fetch("https://graph.facebook.com/v20.0/123456789/fail");
    await fetch("https://api.example.com/other");
    const usage = getGraphUsageByCaller({ minutes: 5 });
    assert.equal(usage.total_calls, 3, "only the Graph calls are counted");
    assert.equal(usage.errors, 1);
    assert.equal(usage.by_endpoint[0].endpoint, "GET /{id}/posts");
    assert.equal(usage.by_endpoint[0].calls, 2);
    assert.match(usage.by_caller.map((row) => row.caller).join(","), /fetchPostsForTest/);
    assert.equal(usage.usage.callCount, 12, "the usage header is read for every caller");
    assert.equal(seen.length, 4, "every request still went out");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the poller, the thread open and the commenter lookups spend only what changed", () => {
  const meta = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
  const scan = meta.slice(meta.indexOf("export const runMetaCommentsPollingScan"), meta.indexOf("let metaCommentsPollingSchedulerStarted"));
  assert.match(scan, /planCommentPoll\(\{\s*posts,\s*memo: facebookCommentPollMemo/);
  assert.match(scan, /for \(const \{ post, count: graphCommentTotal \} of pollPlan\.read\)/);
  assert.match(scan, /facebookCommentPollMemo\.remember\(/);
  assert.match(scan, /onlyChanged: true/);
  // post details are fetched on the first new comment, not per post read
  assert.doesNotMatch(scan, /const enrichedPost = await fetchMetaPostPreviewDetails/);
  const threadSync = meta.slice(meta.indexOf("export const syncMetaFacebookCommentsForTenant"), meta.indexOf("export const syncMetaFacebookCommentsForTenant") + 3000);
  assert.match(threadSync, /THREAD_COMMENT_SYNC_FRESH_MS\) continue;/);
  assert.match(meta, /const postPreviewCache = new Map\(\);/);
  assert.match(meta, /hostSocialCommenterPicture\(\{ platform: pick\.platform/);
  assert.match(server, /installGraphFetchMeter\(\);/);
  assert.match(server, /app\.get\("\/api\/debug\/meta-graph-usage"/);
});
