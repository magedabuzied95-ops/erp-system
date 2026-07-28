import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");

test("queue deletion serializes concurrent bulk requests before writing the timeline", () => {
  const deleteStart = serviceSource.indexOf("export const deleteAiMarketingQueueItem");
  const deleteEnd = serviceSource.indexOf("export const archiveAiMarketingQueueItem", deleteStart);
  const deleteSource = serviceSource.slice(deleteStart, deleteEnd);

  assert.match(deleteSource, /BEGIN/);
  assert.match(deleteSource, /SELECT[\s\S]*FOR UPDATE/);
  assert.match(deleteSource, /appendQueueTimeline\([\s\S]*client/);
  assert.ok(deleteSource.indexOf("appendQueueTimeline") < deleteSource.indexOf("DELETE FROM ai_marketing_content_queue"));
  assert.match(deleteSource, /COMMIT/);
  assert.match(deleteSource, /ROLLBACK/);
});
