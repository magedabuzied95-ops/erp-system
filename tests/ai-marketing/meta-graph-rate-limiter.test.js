import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The governor reads its timings once, at import. Shrink them first so the retry
// tests exercise the real backoff path in milliseconds instead of in seconds.
process.env.META_GRAPH_PUBLISH_MAX_WAIT_MS = "40";
process.env.META_GRAPH_PUBLISH_TOTAL_WAIT_MS = "120";
process.env.META_GRAPH_PUBLISH_GAP_MS = "1";

const {
  isGraphRateLimitError,
  noteGraphResponse,
  noteGraphRateLimitError,
  shouldDeferBackgroundGraphWork,
  getMetaGraphBudgetSnapshot,
  runGraphRequest,
  __metaGraphRateLimiterTestHooks: hooks,
} = await import("../../server/services/metaGraphRateLimiter.js");

const publisherSource = fs.readFileSync(
  new URL("../../server/services/storyPublisherService.js", import.meta.url),
  "utf8"
);
const integrationSource = fs.readFileSync(
  new URL("../../server/services/metaIntegrationService.js", import.meta.url),
  "utf8"
);

const headers = (map = {}) => ({ get: (key) => map[String(key).toLowerCase()] ?? null });
const rateLimitError = ({ code = 4, status = 400, message = "(#4) Application request limit reached" } = {}) =>
  Object.assign(new Error(message), { status, meta: { code }, metaResponse: { error: { code, message } } });

test.beforeEach(() => hooks.reset());

// The failure the owner actually saw: Graph answers HTTP 400, not 429, so any
// predicate that only watches the status code reports it as a hard publish error.
test("(#4) Application request limit reached is recognised despite its HTTP 400", () => {
  assert.equal(isGraphRateLimitError(rateLimitError()), true);
  assert.equal(isGraphRateLimitError(Object.assign(new Error("slow down"), { status: 429 })), true);
  assert.equal(isGraphRateLimitError(Object.assign(new Error("page limit"), { meta: { code: 32 } })), true);
  assert.equal(isGraphRateLimitError(new Error("Invalid OAuth access token")), false);
  assert.equal(isGraphRateLimitError(Object.assign(new Error("bad param"), { status: 400 })), false);
});

test("X-App-Usage is read off the response and becomes the current pressure", () => {
  noteGraphResponse({ headers: headers({ "x-app-usage": '{"call_count":81,"total_cputime":12,"total_time":40}' }) });
  const snapshot = getMetaGraphBudgetSnapshot();
  assert.equal(snapshot.pressure, 81);
  assert.equal(snapshot.usage.source, "app_usage");
});

test("the worst business-use-case bucket wins over a calmer app-usage reading", () => {
  noteGraphResponse({
    headers: headers({
      "x-app-usage": '{"call_count":10,"total_cputime":5,"total_time":5}',
      "x-business-use-case-usage":
        '{"1234":[{"type":"messenger","call_count":20,"total_cputime":5,"total_time":5},{"type":"pages","call_count":93,"total_cputime":10,"total_time":11}]}',
    }),
  });
  const snapshot = getMetaGraphBudgetSnapshot();
  assert.equal(snapshot.pressure, 93);
  assert.equal(snapshot.usage.source, "business_use_case:pages");
});

test("background polling yields once the budget is critical, and again once the breaker is open", () => {
  assert.equal(shouldDeferBackgroundGraphWork().defer, false);

  noteGraphResponse({ headers: headers({ "x-app-usage": '{"call_count":95,"total_cputime":1,"total_time":1}' }) });
  const underPressure = shouldDeferBackgroundGraphWork();
  assert.equal(underPressure.defer, true);
  assert.equal(underPressure.reason, "critical_pressure");

  hooks.reset();
  noteGraphRateLimitError(rateLimitError());
  const tripped = shouldDeferBackgroundGraphWork();
  assert.equal(tripped.defer, true);
  assert.equal(tripped.reason, "breaker_open");
  assert.ok(tripped.retry_after_ms > 0);
});

// Meta says how long it needs before it ever returns an error. Honouring that is
// the difference between waiting out a limit and re-triggering it.
test("estimated_time_to_regain_access opens the breaker before any call fails", () => {
  noteGraphResponse({
    headers: headers({
      "x-business-use-case-usage":
        '{"9":[{"type":"pages","call_count":100,"total_cputime":100,"total_time":100,"estimated_time_to_regain_access":7}]}',
    }),
  });
  const snapshot = getMetaGraphBudgetSnapshot();
  assert.equal(snapshot.breaker_open, true);
  assert.ok(snapshot.breaker_ms_remaining > 6 * 60 * 1000);
});

test("a non-rate-limit failure neither trips the breaker nor is retried", async () => {
  let attempts = 0;
  await assert.rejects(
    runGraphRequest({
      lane: "publish",
      retries: 2,
      run: async () => {
        attempts += 1;
        throw Object.assign(new Error("Invalid OAuth access token"), { status: 400, meta: { code: 190 } });
      },
    }),
    /Invalid OAuth access token/
  );
  assert.equal(attempts, 1);
  assert.equal(getMetaGraphBudgetSnapshot().breaker_open, false);
});

test("a rate-limited publish is retried instead of surfacing as a failed card", async () => {
  let attempts = 0;
  const payload = await runGraphRequest({
    lane: "publish",
    retries: 2,
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw rateLimitError();
      return { id: "story_1" };
    },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(payload, { id: "story_1" });
  assert.equal(getMetaGraphBudgetSnapshot().counters.retried, 1);
});

// A publish runs inside an HTTP request this backend cuts off at 60s. Retrying is
// only an improvement while it still returns an answer; riding out a long throttle
// is the autopilot's job on its next slot.
test("a publish that stays rate-limited gives up inside its wait budget", async () => {
  const startedAt = Date.now();
  let attempts = 0;
  await assert.rejects(
    runGraphRequest({
      lane: "publish",
      retries: 5,
      run: async () => {
        attempts += 1;
        throw rateLimitError();
      },
    }),
    /Application request limit reached/
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(attempts > 1, "it should have retried at least once");
  assert.ok(elapsed < 1000, `gave up in ${elapsed}ms, which must stay well inside the request timeout`);
});

test("Facebook story slides publish one at a time, like Instagram", () => {
  assert.doesNotMatch(
    publisherSource,
    /Promise\.all\(\s*\n?\s*publishCandidates\.map\(\(candidate\) => publishFacebookStory/,
    "Facebook slides must not fan out in one burst — that is what spent the app budget"
  );
  const facebookBlock = publisherSource.slice(
    publisherSource.indexOf('if (!wantsPlatform("facebook"))'),
    publisherSource.indexOf('const whatsapp =')
  );
  assert.match(facebookBlock, /for \(const \[index, candidate\] of publishCandidates\.entries\(\)\)/);
  assert.match(facebookBlock, /await publishFacebookStory\(/);
  assert.match(facebookBlock, /await delay\(FACEBOOK_SLIDE_DELAY_MS\)/);
});

// A retry that republishes an already-published slide leaves duplicate stories on
// the page and pays the Graph cost twice.
test("a Facebook retry reuses slides that already published", () => {
  const facebookBlock = publisherSource.slice(
    publisherSource.indexOf('if (!wantsPlatform("facebook"))'),
    publisherSource.indexOf('const whatsapp =')
  );
  assert.match(facebookBlock, /previousFacebook\.slide_results/);
  assert.match(facebookBlock, /previousSlide\?\.status === "published"/);
  assert.match(facebookBlock, /reused: true/);
});

test("story publishes run in the priority lane of the shared governor", () => {
  assert.match(publisherSource, /from "\.\/metaGraphRateLimiter\.js"/);
  assert.match(publisherSource, /lane: "publish"/);
  assert.match(publisherSource, /noteGraphResponse\(response\)/);
});

test("every central Graph helper reports its usage headers and its rate limits", () => {
  // callMetaGet, callInstagramGraph, callMetaPost, callMetaPostForm, and the
  // Messenger reaction send.
  assert.equal((integrationSource.match(/noteGraphResponse\(response\);/g) || []).length, 5);
  assert.equal((integrationSource.match(/throw metaGraphFailure\(Object\.assign\(/g) || []).length, 5);
});

// `max_retries` / `retry_backoff_minutes` were already in the eligibility query,
// but a failed publish writes status `publish_failed`, which the status allowlist
// excluded — so neither setting could ever fire.
test("the autopilot picks a failed story back up instead of waiting for a human", () => {
  const autopilotSource = fs.readFileSync(
    new URL("../../server/services/aiMarketingStoryAutopilotService.js", import.meta.url),
    "utf8"
  );
  const eligibility = autopilotSource.slice(
    autopilotSource.indexOf("const eligibleStoryItems"),
    autopilotSource.indexOf("const hasGeneratedAsset")
  );
  assert.match(eligibility, /q\.status IN \('ready', 'generated', 'scheduled', 'publish_failed'\)/);
  // Still bounded: the attempt counter and the backoff window both gate it.
  assert.match(eligibility, /COALESCE\(q\.publish_attempts, 0\) <= \$\$\{params\.length\}::int/);
  assert.match(eligibility, /q\.last_publish_attempt_at IS NULL OR q\.last_publish_attempt_at <=/);
});

test("the comment poll checks the budget before a scan and abandons one mid-flight", () => {
  assert.match(integrationSource, /META_POLL_SKIPPED_GRAPH_BUDGET/);
  assert.match(integrationSource, /META_POLL_ABORTED_GRAPH_BUDGET/);
  const scan = integrationSource.slice(integrationSource.indexOf("export const runMetaCommentsPollingScan"));
  assert.match(scan, /const budgetDecision = force \? \{ defer: false \} : shouldDeferBackgroundGraphWork\(\)/);
});
