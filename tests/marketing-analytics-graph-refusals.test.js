import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyAnalyticsRefusal, splitPlatformPostIds } from "../server/services/marketingAnalyticsService.js";

// From the production meter, 2026-09-12 01:42 UTC — 70 Graph calls, 49 of them errors,
// all three shapes visible in `last_error`.

test("a story's joined media ids become one candidate each", () => {
  assert.deepEqual(splitPlatformPostIds("18426972868194410,18114709970051865,17956746627226769"), [
    "18426972868194410",
    "18114709970051865",
    "17956746627226769",
  ]);
  assert.deepEqual(splitPlatformPostIds("1876048016699152"), ["1876048016699152"]);
  assert.deepEqual(splitPlatformPostIds("  17945170089342916 , 18087672254664878 "), ["17945170089342916", "18087672254664878"]);
  assert.deepEqual(splitPlatformPostIds(""), []);
  assert.deepEqual(splitPlatformPostIds(null), []);
});

test("Meta's two repeating refusals are told apart", () => {
  const graphError = (message, code, subcode) => ({ metaResponse: { error: { message, code, error_subcode: subcode } }, message });
  assert.equal(
    classifyAnalyticsRefusal(graphError("Unsupported get request. Object with ID '28354345960886914' does not exist, cannot be loaded due to missing permissions", 100, 33)),
    "object_missing"
  );
  assert.equal(classifyAnalyticsRefusal(graphError("(#100) Tried accessing nonexisting field (insights) on node type Photo", 100, 0)), "no_insights");
  assert.equal(classifyAnalyticsRefusal(graphError("(#4) Application request limit reached", 4, 0)), "");
  assert.equal(classifyAnalyticsRefusal({}), "");
});

test("a refused object is not asked about twice, and the Instagram metric list is the one Graph accepts", () => {
  const source = readFileSync(new URL("../server/services/marketingAnalyticsService.js", import.meta.url), "utf8");
  // the object is gone: neither call is worth making again today
  assert.match(source, /if \(wasRefused\("facebook", platformPostId, "object_missing"\)\) \{/);
  assert.match(source, /if \(wasRefused\("instagram", platformPostId, "object_missing"\)\) \{/);
  // the object has no insights at all: only the insights call is skipped
  assert.match(source, /if \(wasRefused\("facebook", platformPostId, "no_insights"\)\) return metrics;/);
  assert.match(source, /if \(wasRefused\("instagram", platformPostId, "no_insights"\)\) return metrics;/);
  assert.equal((source.match(/rememberRefusal\(/g) || []).length >= 4, true, "every catch records what Meta said");
  assert.match(source, /metric: "impressions,reach,saved,total_interactions"/);
  assert.doesNotMatch(source, /metric: "impressions,reach,saved,engagement"/);
});
