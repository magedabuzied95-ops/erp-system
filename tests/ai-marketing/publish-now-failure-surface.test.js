import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const aiCenterController = read("server/controllers/aiMarketingCenterController.js");
const marketingController = read("server/controllers/marketingController.js");
const marketingRoutes = read("server/routes/marketing.js");
const aiCenterRoutes = read("server/routes/aiMarketingCenter.js");
const publisherService = read("server/services/socialPublisherService.js");
const marketingApi = read("src/modules/marketing/services/marketingApi.js");
const aiCenterPage = read("src/modules/marketing/pages/AiMarketingCenter.jsx");

const stripComments = (source = "") => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const publishNowHandler = (() => {
  const start = aiCenterController.indexOf("export const publishAutonomousAiMarketingQueueItemNow");
  const end = aiCenterController.indexOf("export const ", start + 1);
  assert.ok(start > 0 && end > start, "publish-now handler not found");
  // The comments explain the 502 this handler stopped sending; only the code counts.
  return stripComments(aiCenterController.slice(start, end));
})();

/*
  A publish Meta refused is not a gateway failure. Answering 502 handed the
  outcome to the proxy in front of the API, which replaces that status class with
  an error page carrying no CORS header — the browser then reported
  "blocked by CORS policy" / NetworkError and the real reason (rate limit,
  rejected media) never reached the operator.
*/
test("a refused publish is reported with a status the proxy passes through", () => {
  assert.doesNotMatch(publishNowHandler, /\b502\b/);
  assert.match(publishNowHandler, /published \|\| partial \? 200 : isMetaRateLimitMessage\(failureMessage\) \? 429 : 422/);
});

test("the publish outcome travels in the payload, per platform", () => {
  assert.match(publishNowHandler, /partial,/);
  assert.match(publishNowHandler, /published_platforms: publishedPlatforms/);
  assert.match(publishNowHandler, /failed_platforms: failedPlatforms/);
});

test("Meta's app-level throttle is recognised from the persisted message", () => {
  const matcher = aiCenterController.match(/const isMetaRateLimitMessage[\s\S]*?;\r?\n/);
  assert.ok(matcher, "rate limit matcher not found");
  const isMetaRateLimitMessage = new Function(`${matcher[0]} return isMetaRateLimitMessage;`)();

  assert.equal(isMetaRateLimitMessage("Facebook: (#4) Application request limit reached"), true);
  assert.equal(isMetaRateLimitMessage("Missing or invalid image file"), false);
  assert.equal(isMetaRateLimitMessage(""), false);
});

test("the draft publish-now endpoint dropped 502 too", () => {
  assert.match(marketingController, /res\.status\(status === "published" \? 200 : 422\)/);
});

test("every publish-now route gets the wider request window", () => {
  assert.match(marketingRoutes, /"\/ai-center\/queue\/:id\/publish-now",[^\n]*publishRequestWindow/);
  assert.match(marketingRoutes, /"\/ai-center\/drafts\/:id\/publish-now",[^\n]*publishRequestWindow/);
  assert.match(aiCenterRoutes, /"\/queue\/:id\/publish-now",[^\n]*publishRequestWindow/);
});

test("Meta never receives a format it cannot decode", () => {
  const conversions = publisherService.match(/await ensureMetaCompatibleImageUrls\(getPostImageUrls\(post\)\)/g) || [];
  assert.equal(conversions.length, 2, "both the Facebook and Instagram post paths must convert");
  assert.match(publisherService, /import \{ ensureMetaCompatibleImageUrls \} from "\.\/metaImageCompatService\.js"/);
});

test("the UI is handed the whole envelope and does not call a partial publish a success", () => {
  assert.match(marketingApi, /publishAutonomousAiMarketingQueueItemNow = async \(id\) => api\.post\(/);
  assert.match(aiCenterPage, /const publishResult = await publishAutonomousAiMarketingQueueItemNow\(id\)/);
  assert.match(aiCenterPage, /if \(publishResult\?\.partial\)/);
});
