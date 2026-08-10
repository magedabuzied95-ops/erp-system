import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("server/services/salesJourneyEventService.js", "utf8");
const salesAgentSource = readFileSync("server/services/aiSalesAgentService.js", "utf8");

test("sales journey schema setup is shared across concurrent inbox requests", () => {
  assert.match(source, /let schemaReadyPromise = null/);
  assert.match(source, /if \(!schemaReadyPromise\) \{[\s\S]*?schemaReadyPromise = runSchemaSetup\(db\)/);
  assert.match(source, /schemaReadyPromise = null;[\s\S]*?throw error/);
  assert.match(source, /return schemaReadyPromise/);
});

test("AI Inbox reuses its batch journey result without per-conversation reads or writes", () => {
  assert.match(salesAgentSource, /journeyEventsPreloaded = false/);
  assert.match(salesAgentSource, /readOnly = false/);
  assert.match(salesAgentSource, /journeyEventsPreloaded \|\| asArray\(existingJourneyEvents\)\.length/);
  assert.match(salesAgentSource, /const derivedEvents = readOnly\s*\? \[\]/);
  assert.match(salesAgentSource, /journeyEventsPreloaded: true,[\s\S]*?readOnly: true/);
});
