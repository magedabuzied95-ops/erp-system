/**
 * Boot work that grew with every message ever stored (growth audit, 2026-09-14).
 *
 * bootstrapStartup runs before listen() under a 15s statement_timeout and exit(1)s on any
 * throw, so a boot step whose cost follows table size turns into a crash loop once the
 * tables are big enough, and the deploy's health gate then refuses the fix.
 *
 *   repairCorruptedArabicText  skipped only when the marker existed AND the candidate scan
 *                              found zero rows. The scan matches the bare letters ط and ظ,
 *                              so on real Arabic it is never zero: every boot COUNTed and
 *                              then loaded every message holding those letters.
 *   provider_message_id fill   matched every Meta row that already had an id and rewrote it
 *                              to the same value: a whole-table write on every boot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("the Arabic repair returns on its marker before touching any message table", () => {
  const source = read("../server/services/metaIntegrationService.js");
  const start = source.indexOf("export const repairCorruptedArabicText = async");
  assert.ok(start > -1);
  const body = source.slice(start, source.indexOf("\n};\n", start));

  const markerRead = body.indexOf("FROM startup_repairs WHERE repair_key = $1");
  const markerReturn = body.indexOf("if (markerResult.rows.length) {");
  const firstTableScan = body.indexOf("FROM ${quoteIdentifier(spec.table)}");
  assert.ok(markerRead > -1 && markerReturn > markerRead, "the marker is read, then decides");
  assert.ok(firstTableScan > markerReturn, "no table scan may run before the marker check");
  assert.match(body.slice(markerReturn, markerReturn + 400), /reason: "already_completed"[\s\S]*return result;/);

  // The old rule waited for a zero candidate count, which the bare-letter scan never gives.
  assert.doesNotMatch(body, /totalCandidates/);
  assert.doesNotMatch(body, /SELECT COUNT\(\*\)::int AS count FROM \$\{quoteIdentifier\(spec\.table\)\}/);
});

test("the Meta provider-id fill only writes rows that are missing the id", () => {
  const source = read("../server/services/aiSupportLogService.js");
  const at = source.indexOf("SET provider_message_id = external_message_id");
  assert.ok(at > -1, "the fill copies external_message_id into an empty provider_message_id");
  const statement = source.slice(at, source.indexOf("`);", at));
  assert.match(statement, /AND COALESCE\(provider_message_id, ''\) = ''/);
  assert.match(statement, /AND COALESCE\(external_message_id, ''\) <> ''/);
  assert.doesNotMatch(source, /SET provider_message_id = COALESCE\(NULLIF\(provider_message_id, ''\)/);
});

test("the client_request_id fill runs once per boot, not twice", () => {
  const source = read("../server/services/aiSupportLogService.js");
  const fill = /UPDATE ai_support_messages SET client_request_id = COALESCE\(NULLIF\(client_request_id, ''\), NULLIF\(external_reply_id, ''\)\)/g;
  assert.equal((source.match(fill) || []).length, 1);
});
