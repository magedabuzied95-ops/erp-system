import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("server/services/salesJourneyEventService.js", "utf8");

test("sales journey schema setup is shared across concurrent inbox requests", () => {
  assert.match(source, /let schemaReadyPromise = null/);
  assert.match(source, /if \(!schemaReadyPromise\) \{[\s\S]*?schemaReadyPromise = runSchemaSetup\(db\)/);
  assert.match(source, /schemaReadyPromise = null;[\s\S]*?throw error/);
  assert.match(source, /return schemaReadyPromise/);
});
