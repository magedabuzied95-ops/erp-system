import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Playground scenario run, 2026-10-20: after «تمام اكد» on size 42, «عايز اغير المقاس 43 بدل 42» was read
// as buying intent and the summary came back with 42. The named size must replace the remembered one.
test("a size named in a buying follow-up replaces the remembered size in the order summary", () => {
  const brain = fs.readFileSync(new URL("../../server/services/aiBrainV2Service.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const branch = brain.slice(brain.indexOf('if (type === "buying_followup") {'), brain.indexOf("return null;", brain.indexOf('if (type === "buying_followup") {')));
  assert.match(branch, /const requestedSize = extractRequestedSize\(message\);/);
  assert.match(branch, /activeSize: requestedSize,\s*selectedSize: requestedSize,/);
  assert.match(branch, /buildPostProductOrderConfirmationFromMemoryV2\(\{ message: "تمام", memory: memoryForSummary \}\)/);
});
