import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// 2026-09-13: the boot-time identity-key backfill was one whole-table UPDATE. A message whose
// id matched another row's key hit the unique index, the exception escaped bootstrapStartup,
// and production (and the deploy rollback) crash-looped. The backfill must skip colliding rows
// and must never throw.
const service = fs.readFileSync(new URL("../server/services/aiSupportLogService.js", import.meta.url), "utf8");

test("the identity-key backfill fills only missing keys and skips keys already held", () => {
  const start = service.indexOf("const backfillMessageIdentityKeys");
  const body = service.slice(start, service.indexOf("const logSqlError", start));
  assert.ok(start > -1);
  assert.match(body, /WHERE COALESCE\(message_identity_key, ''\) = ''/);
  assert.match(body, /candidate\.rank = 1/);
  assert.match(body, /AND NOT EXISTS \(\s*SELECT 1 FROM ai_support_messages AS existing/);
  assert.equal((body.match(/\.catch\(\(error\) => logSqlError\(/g) || []).length, 2, "both backfill statements swallow their error");
});

test("no whole-table identity-key UPDATE is left in the schema ensure", () => {
  assert.doesNotMatch(service, /SET message_identity_key = CASE/);
  // Once, after the provider-id fill it depends on. A second, earlier copy re-scanned the whole
  // table on every boot for nothing (2026-09-14 growth audit).
  assert.equal((service.match(/await backfillMessageIdentityKeys\(clientOrPool\);/g) || []).length, 1);
});
