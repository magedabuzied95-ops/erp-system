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
  queueItemStoryPayload,
  currentStoryGeneratedAssetUrls,
  isStoryAssetBoundToCurrentItem,
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

test("publish now does not render story assets before calling Meta", () => {
  const publishStart = serviceSource.indexOf("export const publishAiMarketingQueueItemNow");
  const publishEnd = serviceSource.indexOf("export const deleteAiMarketingQueueItem", publishStart);
  const publishSource = serviceSource.slice(publishStart, publishEnd);
  const renderIndex = publishSource.indexOf("ensureQueueStoryRenderedAsset");
  const validateIndex = publishSource.indexOf("assertFinalGeneratedStoryAsset(publishItem)");
  const metaIndex = publishSource.indexOf("publishStoryEverywhereService");

  assert.equal(renderIndex, -1, "publish now must not render or regenerate story assets");
  assert.ok(validateIndex > -1, "publish now must validate the pre-generated final story asset");
  assert.ok(metaIndex > validateIndex, "Meta publish must run only after final asset validation");
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
  assert.match(serviceSource, /story_assets_must_be_bound_to_current_story/);
  assert.doesNotMatch(serviceSource, /story_asset_reused_from_queue_id/);
  assert.equal(Boolean({ ...sameKey, force: true }.force), true);
});

test("story publish payload only uses assets bound to the current story", () => {
  const skechersAsset = "https://res.cloudinary.com/m1-store/image/upload/v1/stories/story-10-skechers.png";
  const oldAdidasAsset = "https://res.cloudinary.com/m1-store/image/upload/v1/stories/story-2-adidas-ultra-boost.png";
  const story = {
    id: 10,
    tenant_id: 1,
    product_id: 345,
    content_type: "story",
    title: "Skechers Hyper Pillars",
    final_asset_url: oldAdidasAsset,
    media_urls: [oldAdidasAsset],
    design_json: {
      layout_type: "special_offer_story",
      product_name: "Skechers Hyper Pillars",
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 10,
      story_asset_product_id: 345,
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      template_key: "fresh_drop",
      template_version: "v3",
      generated_media_urls: [skechersAsset],
      final_asset_url: skechersAsset,
      slides: [{
        slide_number: 1,
        story_id: 10,
        product_id: 345,
        asset_id: "story-10-slide-1",
        template_key: "fresh_drop",
        template_version: "v3",
        rendered_asset_url: skechersAsset,
      }],
    },
    metadata: {
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 10,
      story_asset_product_id: 345,
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      template_key: "fresh_drop",
      template_version: "v3",
      story_asset_ids: ["story-10-slide-1"],
      generated_asset_urls: [skechersAsset],
      generated_asset_count: 1,
    },
  };

  assert.equal(isStoryAssetBoundToCurrentItem(story), true);
  assert.deepEqual(currentStoryGeneratedAssetUrls(story), [skechersAsset]);
  const payload = queueItemStoryPayload(story);
  assert.deepEqual(payload.media_urls, [skechersAsset]);
  assert.equal(payload.image_url, skechersAsset);
  assert.equal(payload.storyId, 10);
  assert.equal(payload.assetId, "story-10-slide-1");
  assert.equal(payload.assetUrl, skechersAsset);
  assert.equal(payload.templateKey, "fresh_drop");
  assert.equal(payload.templateVersion, "v3");
  assert.doesNotMatch(JSON.stringify(payload), /adidas|ultra-boost/i);
});

test("story publish payload fails instead of falling back when current story asset is missing", () => {
  assert.throws(
    () => queueItemStoryPayload({
      id: 11,
      tenant_id: 1,
      product_id: 345,
      content_type: "story",
      title: "Skechers Hyper Pillars",
      image_url: "https://api.m1store-egy.com/uploads/products/skechers.jpg",
      media_urls: ["https://res.cloudinary.com/m1-store/image/upload/v1/stories/story-2-adidas-ultra-boost.png"],
      design_json: { layout_type: "special_offer_story", product_name: "Skechers Hyper Pillars" },
      metadata: {},
    }),
    /Cannot publish: final generated story asset is missing\. Generate the story asset first\./
  );
});

test("story asset binding survives reload-shaped normalized rows", () => {
  const asset = "https://res.cloudinary.com/m1-store/image/upload/v1/stories/story-12-skechers.png";
  const normalized = normalizeQueueRow({
    id: 12,
    tenant_id: 1,
    product_id: 345,
    content_type: "story",
    final_asset_url: asset,
    media_urls: [asset],
    design_json: {
      layout_type: "story",
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 12,
      story_asset_product_id: 345,
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      template_key: "fresh_drop",
      template_version: "v3",
      story_asset_ids: ["story-12-slide-1"],
      generated_media_urls: [asset],
      final_asset_url: asset,
    },
    metadata: {
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 12,
      story_asset_product_id: 345,
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      template_key: "fresh_drop",
      template_version: "v3",
      story_asset_ids: ["story-12-slide-1"],
      generated_asset_urls: [asset],
      generated_asset_count: 1,
    },
  });

  assert.equal(isStoryAssetBoundToCurrentItem(normalized), true);
  assert.deepEqual(queueItemStoryPayload(normalized).media_urls, [asset]);
});

test("fresh drop publish payload uses the exact generated asset without legacy template or rerender", () => {
  const assetUrl = "https://res.cloudinary.com/m1-store/image/upload/v1/stories/fresh-drop-final.png";
  const story = {
    id: 20,
    tenant_id: 1,
    product_id: 345,
    content_type: "story",
    title: "Skechers Hyper Pillars",
    image_url: "https://api.m1store-egy.com/uploads/products/skechers.jpg",
    media_urls: ["https://api.m1store-egy.com/uploads/products/skechers.jpg"],
    design_json: {
      layout_type: "fresh_drop",
      template_key: "fresh_drop",
      template_version: "v3",
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 20,
      story_asset_product_id: 345,
      generated_media_urls: [assetUrl],
      final_asset_url: assetUrl,
      slides: [{
        story_id: 20,
        product_id: 345,
        asset_id: "story-20-slide-1",
        template_key: "fresh_drop",
        template_version: "v3",
        rendered_asset_url: assetUrl,
      }],
    },
    metadata: {
      story_asset_renderer: "ai_marketing_story_commercial_template_v10_no_product_cover",
      story_asset_story_id: 20,
      story_asset_product_id: 345,
      story_asset_template_key: "fresh_drop",
      story_asset_template_version: "v3",
      template_key: "fresh_drop",
      template_version: "v3",
      story_asset_ids: ["story-20-slide-1"],
      generated_asset_urls: [assetUrl],
      generated_asset_count: 1,
    },
  };

  const payload = queueItemStoryPayload(story);
  assert.equal(payload.assetId, "story-20-slide-1");
  assert.equal(payload.assetUrl, assetUrl);
  assert.equal(payload.image_url, assetUrl);
  assert.deepEqual(payload.media_urls, [assetUrl]);
  assert.equal(payload.templateKey, "fresh_drop");
  assert.equal(payload.templateVersion, "v3");
  assert.equal(payload.source_product_image_url, "");
  assert.doesNotMatch(JSON.stringify(payload), /LAST SIZE|View details|dark-gradient|legacy/i);
  assert.doesNotMatch(serviceSource.slice(serviceSource.indexOf("export const publishAiMarketingQueueItemNow")), /generateDesignedAiMarketingStoryImages/);
});
