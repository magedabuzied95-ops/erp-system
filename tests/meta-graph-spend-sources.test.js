import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __metaGraphMeterTestHooks,
  describeGraphEndpoint,
  getGraphUsageByCaller,
  graphCallerFromStack,
  installGraphFetchMeter,
} from "../server/services/metaGraphRateLimiter.js";
import { isExpiredStoryForAnalytics } from "../server/services/marketingAnalyticsService.js";

// Measured on production 2026-09-11, eleven minutes after a deploy: 1256 Graph calls,
// 944 of them failed. 952 came from the marketing analytics sync re-measuring ~450
// AI-published items (all but a handful answering nothing), 207 from the inbox list
// forcing a profile refresh for every nameless Messenger conversation on every load.

test("the event loop frame no longer splits one caller into two rows", () => {
  const resumedAfterAwait = [
    "Error",
    "    at meteredGraphFetch (file:///app/server/services/metaGraphRateLimiter.js:1:1)",
    "    at callMetaGet (file:///app/server/services/marketingAnalyticsService.js:48:26)",
    "    at fetchInstagramMetrics (file:///app/server/services/marketingAnalyticsService.js:390:27)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    "    at async syncMarketingAnalyticsForTenant (file:///app/server/services/marketingAnalyticsService.js:697:13)",
  ].join("\n");
  const direct = [
    "Error",
    "    at callMetaGet (file:///app/server/services/marketingAnalyticsService.js:48:26)",
    "    at async fetchInstagramMetrics (file:///app/server/services/marketingAnalyticsService.js:390:27)",
    "    at async syncMarketingAnalyticsForTenant (file:///app/server/services/marketingAnalyticsService.js:697:13)",
  ].join("\n");
  assert.equal(graphCallerFromStack(resumedAfterAwait), "fetchInstagramMetrics < syncMarketingAnalyticsForTenant");
  assert.equal(graphCallerFromStack(direct), graphCallerFromStack(resumedAfterAwait));
});

test("an ?ids= batch is one endpoint shape, not one row per batch", () => {
  assert.equal(describeGraphEndpoint("https://graph.facebook.com/v25.0/1420036686756409%2C1570691024536456%2C2558669421223032/insights"), "GET /{ids}/insights");
  assert.equal(describeGraphEndpoint("https://graph.facebook.com/v25.0/17945170089342916,18087672254664878"), "GET /{ids}");
});

test("each failing caller carries the last error Meta gave it, without the token", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "(#100) Object does not exist access_token=SECRET123", code: 100, error_subcode: 33 } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  try {
    __metaGraphMeterTestHooks.reset();
    installGraphFetchMeter({ report: false });
    async function readExpiredStoryInsights() {
      const response = await fetch("https://graph.facebook.com/v25.0/18000000000000001/insights");
      return response.json();
    }
    const body = await readExpiredStoryInsights();
    assert.equal(body.error.code, 100, "the caller still reads its own body");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const usage = getGraphUsageByCaller({ minutes: 5 });
    const row = usage.by_caller_endpoint.find((entry) => entry.caller.includes("readExpiredStoryInsights"));
    assert.ok(row, "the caller is named");
    assert.equal(row.errors, 1);
    assert.equal(row.last_error.code, 100);
    assert.equal(row.last_error.subcode, 33);
    assert.doesNotMatch(row.last_error.message, /SECRET123/);
    assert.equal(usage.by_caller.find((entry) => entry.caller === row.caller).errors, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a story is measured for two days, a post for the whole window", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  const hoursAgo = (hours) => new Date(now - hours * 3600e3).toISOString();
  assert.equal(isExpiredStoryForAnalytics({ content_type: "story", published_at: hoursAgo(20) }, now), false);
  assert.equal(isExpiredStoryForAnalytics({ content_type: "story", published_at: hoursAgo(60) }, now), true);
  assert.equal(
    isExpiredStoryForAnalytics({ content_type: "post", published_at: hoursAgo(60), platform_publish_results: { instagram: { platform_story_id: "1790" } } }, now),
    true,
    "a published story id marks it a story whatever the content type says"
  );
  assert.equal(isExpiredStoryForAnalytics({ content_type: "post", published_at: hoursAgo(120) }, now), false);
});

test("the spenders are fixed at the source", () => {
  const analytics = readFileSync(new URL("../server/services/marketingAnalyticsService.js", import.meta.url), "utf8");
  const salesAgent = readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  const meta = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  // analytics: only recent queue items, stop on a refusing run, no full sync per restart
  assert.match(analytics, /COALESCE\(\$\{publishedTimeColumns\.join\(", "\)\}\) > NOW\(\) - \(\$2::numeric \* INTERVAL '1 day'\)/);
  assert.match(analytics, /emptyStreak = hasRealMetricValue\(metrics\) \? 0 : emptyStreak \+ 1;/);
  assert.match(analytics, /if \(emptyStreak >= MAX_CONSECUTIVE_EMPTY_ITEMS\)/);
  assert.match(analytics, /startup sync skipped: synced recently/);
  // the inbox list uses the profile policy; the manual button still forces
  const hydrate = salesAgent.slice(salesAgent.indexOf("const hydrateMessengerInboxConversation"), salesAgent.indexOf("const hydrateMessengerInboxConversation") + 2500);
  assert.match(hydrate, /refreshMessengerProfileForConversation\(\{[\s\S]*?force: false,/);
  assert.match(meta, /forceRefresh: force !== false,/);
  assert.match(meta, /dryRun = false,\r?\n  force = true,\r?\n\} = \{\}\) => \{/);
});
