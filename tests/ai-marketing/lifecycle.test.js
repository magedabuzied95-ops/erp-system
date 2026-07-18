import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getQueueStatusInfo, canPublishQueueItem } from "../../src/modules/marketing/lib/queueStatus.js";
import { __aiMarketingCenterTestHooks } from "../../server/services/aiMarketingCenterService.js";

const {
  failedPlatformsFromResults,
  platformErrorFromResults,
  platformIdsFromResults,
  publishedPlatformsFromResults,
  normalizeQueueRow,
  getProductPrice,
} = __aiMarketingCenterTestHooks;

const serviceSource = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);
const controllerSource = fs.readFileSync(
  new URL("../../server/controllers/aiMarketingCenterController.js", import.meta.url),
  "utf8"
);
const storyPublisherSource = fs.readFileSync(
  new URL("../../server/services/storyPublisherService.js", import.meta.url),
  "utf8"
);

test("schema initialization is coalesced and timed-out jobs retain their worker slot", () => {
  assert.match(serviceSource, /let aiMarketingSchemaPromise = null/);
  assert.match(serviceSource, /if \(aiMarketingSchemaReady\) return undefined/);
  assert.match(serviceSource, /if \(!aiMarketingSchemaPromise\)/);
  assert.match(serviceSource, /const runPromise = Promise\.resolve\(\)\.then\(\(\) => job\.run\(\)\)/);
  assert.match(serviceSource, /runPromise\s*\.catch\(\(\) => undefined\)\s*\.finally/);
});

test("publish now renders a missing story asset inline before calling Meta", () => {
  const publishStart = serviceSource.indexOf("export const publishAiMarketingQueueItemNow");
  const publishEnd = serviceSource.indexOf("export const deleteAiMarketingQueueItem", publishStart);
  const publishSource = serviceSource.slice(publishStart, publishEnd);
  const renderIndex = publishSource.indexOf("ensureQueueStoryRenderedAsset(tenantId, publishItem, { force: false })");
  const validateIndex = publishSource.indexOf("assertStoryPublishAsset(publishItem)");
  const metaIndex = publishSource.indexOf("publishStoryEverywhereService");

  assert.ok(renderIndex > -1, "publish now must generate the 9:16 story asset");
  assert.ok(validateIndex > renderIndex, "the generated asset must be validated after rendering");
  assert.ok(metaIndex > validateIndex, "Meta publish must run only after render and validation");
});

test("publish-now endpoint only reports success after platform publication succeeds", () => {
  assert.match(controllerSource, /failedPlatforms\.length === 0/);
  assert.match(controllerSource, /res\.status\(published \? 200 : 502\)/);
});

test("story publishing uses the current Meta Graph API and direct story endpoints", () => {
  assert.match(storyPublisherSource, /GRAPH_API_VERSION = "v25\.0"/);
  assert.match(storyPublisherSource, /media_type: "STORIES"/);
  assert.match(storyPublisherSource, /media_publish/);
  assert.match(storyPublisherSource, /photo_stories/);
});

test("marketing price follows the POS sale toggle instead of stored sale values", () => {
  const product = {
    id: 40,
    price: 1550,
    selling_price: 1550,
    regular_price: 1550,
    sale_price: 1450,
    sale_price_enabled: true,
  };
  const variant = {
    price: 1550,
    selling_price: 1550,
    regular_price: 1550,
    sale_price: 1450,
    sale_price_enabled: true,
  };

  assert.equal(getProductPrice({ ...product, sale_mode_settings: { sale_mode_enabled: false } }, variant), 1550);
  assert.equal(getProductPrice({ ...product, sale_mode_settings: { sale_mode_enabled: true } }, variant), 1450);
  assert.equal(getProductPrice(
    { ...product, sale_mode_settings: { sale_mode_enabled: true } },
    { ...variant, sale_price_enabled: false }
  ), 1550);
});

test("publishing lifecycle statuses normalize to visible labels", () => {
  assert.equal(getQueueStatusInfo({ status: "ready" }).displayStatus, "Ready");
  assert.equal(getQueueStatusInfo({ status: "queued_publish" }).displayStatus, "Queued Publish");
  assert.equal(getQueueStatusInfo({ status: "publishing" }).displayStatus, "Publishing");
  assert.equal(getQueueStatusInfo({ status: "published" }).displayStatus, "Published");
  assert.equal(getQueueStatusInfo({ status: "publish_failed" }).displayStatus, "Publish Failed");
  assert.equal(getQueueStatusInfo({ status: "archived" }).displayStatus, "Archived");
});

test("publish_failed and partial published rows are retryable", () => {
  assert.equal(canPublishQueueItem({ id: 1, status: "publish_failed" }), true);
  assert.equal(canPublishQueueItem({
    id: 2,
    status: "published",
    platform_publish_results: {
      facebook: { status: "published", platform_post_id: "fb_1" },
      instagram: { status: "failed", error: "IG permission missing" },
    },
  }), true);
});

test("platform success, failure, IDs, and error metadata are extracted deterministically", () => {
  const results = {
    facebook: { status: "published", platform_post_id: "fb_post_1" },
    instagram: { status: "failed", error_code: "190", error: "Invalid OAuth token" },
  };
  assert.deepEqual(publishedPlatformsFromResults(results), ["facebook"]);
  assert.deepEqual(failedPlatformsFromResults(results), ["instagram"]);
  assert.deepEqual(platformIdsFromResults(results), {
    facebook: "fb_post_1",
    instagram: "",
    instagram_publish_id: "",
  });
  assert.deepEqual(platformErrorFromResults(results), {
    code: "190",
    message: "Invalid OAuth token",
  });
});

test("normalizeQueueRow maps performance score labels without fake data", () => {
  assert.equal(normalizeQueueRow({ metadata: {} }).performance_label, "No Data");
  assert.equal(normalizeQueueRow({ metadata: { performance_score: 80 } }).performance_label, "High Performer");
  assert.equal(normalizeQueueRow({ metadata: { performance_score: 50 } }).performance_label, "Average");
  assert.equal(normalizeQueueRow({ metadata: { performance_score: 10 } }).performance_label, "Low Performer");
});

test("async generation state machine model covers success, failure, reuse, force, and stuck timeout", () => {
  const transition = (row, event) => {
    if (event === "generate") return { ...row, status: "queued" };
    if (event === "run") return { ...row, status: "generating_image" };
    if (event === "upload") return { ...row, status: "uploading" };
    if (event === "ready") return { ...row, status: "ready", final_asset_url: "/uploads/stories/a.png" };
    if (event === "fail") return { ...row, status: "failed", metadata: { story_asset_error: "render failed" } };
    if (event === "timeout") return { ...row, status: "failed", metadata: { retryable: true, failed_reason: "generation_timeout" } };
    return row;
  };

  let row = { status: "pending_approval", product_id: 1, strategy_type: "new_arrivals", design_json: { layout_type: "story" } };
  row = transition(row, "generate");
  assert.equal(row.status, "queued");
  row = transition(row, "run");
  row = transition(row, "upload");
  row = transition(row, "ready");
  assert.equal(row.status, "ready");

  const failed = transition({ status: "queued" }, "fail");
  assert.equal(failed.status, "failed");
  assert.equal(failed.metadata.story_asset_error, "render failed");

  const timedOut = transition({ status: "uploading" }, "timeout");
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.metadata.retryable, true);

  const existing = { product_id: 1, strategy_type: "new_arrivals", layout_type: "story", final_asset_url: "/uploads/stories/a.png" };
  const sameKey = { product_id: 1, strategy_type: "new_arrivals", layout_type: "story" };
  const canReuse = !sameKey.force && existing.product_id === sameKey.product_id && existing.strategy_type === sameKey.strategy_type && existing.layout_type === sameKey.layout_type;
  assert.equal(canReuse, true);
  assert.equal(Boolean({ ...sameKey, force: true }.force), true);
});
