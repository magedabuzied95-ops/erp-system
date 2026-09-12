import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { META_PAGE_FEED_POLL_PAGE_SIZES } from "../server/services/metaIntegrationService.js";

/*
 * 2026-09-12, from the usage meter: the one call the comment poller makes to list the
 * page's posts answered HTTP 500 / code 1, "Please reduce the amount of data you're
 * asking for". It asked for 100 posts with attachments and comment summaries. The
 * poller therefore saw zero posts on every run — Facebook comments were arriving by
 * webhook alone, and the recovery path Meta's own docs call for was dead.
 */
test("the feed page size steps down instead of giving up", () => {
  assert.deepEqual(META_PAGE_FEED_POLL_PAGE_SIZES, [25, 10, 5]);
  const source = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  const start = source.indexOf("const fetchMetaPagePostsForPolling");
  const body = source.slice(start, start + 1400);
  assert.match(body, /for \(const limit of META_PAGE_FEED_POLL_PAGE_SIZES\)/);
  assert.match(body, /if \(isMetaRateLimitError\(error\)\) throw error;/, "a rate limit still belongs to the governor, not to a retry here");
  assert.match(body, /isGraphTooMuchDataError\(error\)/);
  assert.match(source, /message\.includes\("reduce the amount of data"\)/);
});

test("the census says why a faceless comment is out of the lookup's reach", () => {
  const script = readFileSync(new URL("../server/scripts/backfillSocialCommenterProfiles.js", import.meta.url), "utf8");
  assert.match(script, /id_not_scoped/);
  assert.match(script, /older_than_window/);
  assert.match(script, /in_backoff/);
  assert.match(script, /comments with no picture, by why the lookup cannot reach them/);
});
