import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);
const pageSource = fs.readFileSync(
  new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url),
  "utf8"
);

test("queue reads do not render story assets or run per-row database hydration", () => {
  const listBody = serviceSource.slice(
    serviceSource.indexOf("export const listAiMarketingQueue"),
    serviceSource.indexOf("const imageFromGalleryItem")
  );
  assert.doesNotMatch(listBody, /hydrateQueueStoryForRender|validateLastPieceQueueItem|ensureQueueStoryRenderedAsset/);
  assert.match(listBody, /LEFT JOIN LATERAL[\s\S]*FROM product_variants candidate/);
  assert.match(listBody, /result\.rows\.map/);
});

test("AI marketing page coalesces refreshes and tolerates partial API failures", () => {
  assert.match(pageSource, /loadInFlightRef/);
  assert.match(pageSource, /Promise\.allSettled/);
  assert.doesNotMatch(pageSource, /const \[settingsPayload, overviewPayload, queueRows\] = await Promise\.all\(/);
});
