import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const service = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../../server/services/storyImageService.js", import.meta.url), "utf8");

test("publish atomically prepares a missing story asset before platform publishing", () => {
  const prepareIndex = service.indexOf("publishItem = await ensureQueueStoryRenderedAsset(tenantId, publishItem)");
  const assertIndex = service.indexOf("const selectedAsset = assertFinalGeneratedStoryAsset(publishItem)", prepareIndex);
  const publishIndex = service.indexOf("await publishStoryEverywhereService", assertIndex);
  assert.ok(prepareIndex > 0 && assertIndex > prepareIndex && publishIndex > assertIndex);
});

test("final story renderer receives current and crossed prices", () => {
  assert.match(service, /price: item\.current_price \|\| design\.current_price \|\| item\.price/);
  assert.match(service, /old_crossed_price: item\.old_crossed_price \|\| design\.old_crossed_price/);
  assert.match(renderer, /price: slide\.current_price \|\| slide\.price \|\| story\.current_price \|\| story\.price/);
});
