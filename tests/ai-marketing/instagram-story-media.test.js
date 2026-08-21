import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { __storyPublisherTestHooks } from "../../server/services/storyPublisherService.js";

const { instagramCompatibleImageUrl, isRetryableInstagramContainerError } = __storyPublisherTestHooks;
const rendererSource = fs.readFileSync(
  new URL("../../server/services/storyImageService.js", import.meta.url),
  "utf8"
);

test("Cloudinary PNG story assets are delivered to Instagram as JPEG", () => {
  const source = "https://res.cloudinary.com/demo/image/upload/v123/erp/stories/story.png";
  const result = instagramCompatibleImageUrl(source);

  assert.equal(
    result,
    "https://res.cloudinary.com/demo/image/upload/f_jpg,q_92,fl_strip_profile/v123/erp/stories/story.jpg"
  );
});

test("story renderer writes JPEG assets with a matching upload content type", () => {
  assert.match(rendererSource, /\.join\("-"\) \+ "\.jpg"/);
  assert.match(rendererSource, /\.jpeg\(\{ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true \}\)/);
  assert.match(rendererSource, /const contentType = .*"image\/jpeg"/);
});

test("Instagram media ingestion errors are treated as retryable", () => {
  assert.equal(isRetryableInstagramContainerError(new Error("Only photo or video can be accepted as media type.")), true);
  assert.equal(isRetryableInstagramContainerError(new Error("fetch failed")), true);
  assert.equal(isRetryableInstagramContainerError(new Error("Invalid OAuth access token")), false);
});

// Rate limits are retried once, inside the shared Graph governor, with a backoff
// that respects Meta's own recovery window. This local loop deliberately declines
// them so the two do not stack into nine attempts against an app that is already
// being throttled.
test("rate limits are left to the Graph governor, not retried again locally", () => {
  assert.equal(isRetryableInstagramContainerError(Object.assign(new Error("rate limited"), { status: 429 })), false);
  assert.equal(
    isRetryableInstagramContainerError(
      Object.assign(new Error("(#4) Application request limit reached"), { status: 400, meta: { code: 4 } })
    ),
    false
  );
});
