// Regression: the shared api client resolves to the parsed response BODY, not an
// axios-style { data } wrapper. Reading `response.data.data` therefore yields
// undefined, which is exactly what made "Connect TikTok" fail in production with
// "Could not start TikTok authorization" while the backend had already created a
// valid OAuth state and returned 200.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const apiSource = read("../../src/shared/api/api.js");
const cardSource = read("../../src/modules/aiSupport/components/TikTokConnectionCard.jsx");
const panelSource = read("../../src/modules/marketing/components/TikTokPublishPanel.jsx");
const marketingApiSource = read("../../src/modules/marketing/services/marketingApi.js");

const tiktokSources = [
  ["TikTokConnectionCard", cardSource],
  ["TikTokPublishPanel", panelSource],
  ["marketingApi", marketingApiSource],
];

test("the shared api client returns the response body, not an axios wrapper", () => {
  // Guards the premise the assertions below depend on. CRLF-tolerant: these
  // files are stored with \r\n and an \n-anchored pattern matches nothing.
  assert.match(apiSource, /^\s*return data;\s*$/m, "api request() must resolve to the parsed body");
  assert.ok(!/return\s*\{\s*data\s*[,}]/.test(apiSource), "api must not wrap the body in { data }");
});

test("no TikTok caller reads the axios-style response.data.data", () => {
  for (const [name, source] of tiktokSources) {
    assert.ok(
      !/response\?\.data\?\.data/.test(source),
      `${name} reads response.data.data — always undefined with this client`
    );
    assert.ok(
      !/\bawait api\.(get|post)\([^)]*\)\)\?\.data\?\.data/.test(source),
      `${name} double-unwraps an api call`
    );
  }
});

test("no TikTok caller reads the axios-style error.response.data", () => {
  // Scoped to the TikTok components. marketingApi's pre-existing
  // logMarketingApiError keeps `error?.responseBody ?? error?.response?.data`
  // as a defensive fallback; that is project code and not in scope here.
  for (const [name, source] of [["TikTokConnectionCard", cardSource], ["TikTokPublishPanel", panelSource]]) {
    assert.ok(
      !/error\?\.response\?\.data/.test(source),
      `${name} reads error.response.data — this client throws with .responseBody`
    );
  }
});

test("the connect flow reads authorize_url at the correct depth", () => {
  assert.match(cardSource, /text\(response\?\.data\?\.authorize_url\)/,
    "Connect TikTok must read response.data.authorize_url");
});

test("status and creator info are read at the correct depth", () => {
  assert.match(cardSource, /const data = response\?\.data \|\| null;/);
  assert.match(panelSource, /setConnection\(response\?\.data \|\| null\);/);
  assert.match(panelSource, /setCreatorInfo\(response\?\.data \|\| null\);/);
});

test("the detailed publish call keeps the whole envelope so tiktok_result survives", () => {
  // The backend returns { success, message, data, meta_result, tiktok_result }.
  // Unwrapping to .data would drop tiktok_result and break status tracking.
  assert.match(
    marketingApiSource,
    /publishSocialPublisherPostDetailed = async \(id\) =>\s*\(await api\.post\([^)]*\)\) \?\? null;/,
    "publishSocialPublisherPostDetailed must return the full envelope"
  );
  assert.match(
    marketingApiSource,
    /getTikTokPublishStatus = async \(jobId\) =>\s*\(await api\.get\([^)]*\)\)\?\.data \?\? null;/
  );
});

test("the error path surfaces the backend message this client actually provides", () => {
  for (const [name, source] of [["TikTokConnectionCard", cardSource], ["TikTokPublishPanel", panelSource]]) {
    if (!/toast\.error|setCreatorError/.test(source)) continue;
    assert.match(source, /error\?\.responseBody\?\.message \|\| error\?\.message/,
      `${name} must read the error shape this client throws`);
  }
});
