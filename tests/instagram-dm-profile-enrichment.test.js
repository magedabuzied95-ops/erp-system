import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const start = source.indexOf("export const enrichMessengerProfile = async");
const end = source.indexOf("export const repairMessengerProfileCaptures", start);
const enrichmentSource = source.slice(start, end);

test("Instagram DM sender profiles are fetched with the Instagram token and minimal fields", () => {
  assert.ok(start >= 0 && end > start, "profile enrichment implementation must be present");
  assert.match(
    enrichmentSource,
    /\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\.includes\(normalizedChannel\)/
  );
  assert.match(enrichmentSource, /if \(normalizedChannel === AI_AGENT_CHANNELS\.INSTAGRAM\)/);
  assert.match(enrichmentSource, /resolveMetaSendConfig\(\{[\s\S]*channel: normalizedChannel,[\s\S]*instagramBusinessAccountId:/);
  assert.match(enrichmentSource, /callInstagramGraph\(\{[\s\S]*fields: "name,username,profile_pic"/);
});

test("Instagram DM profile data is persisted and exposed through the existing inbox profile shape", () => {
  assert.match(enrichmentSource, /persistMessengerProfile\(\{[\s\S]*channel: normalizedChannel,[\s\S]*psid,/);
  assert.match(enrichmentSource, /customer_name: persisted\?\.name \|\| displayName/);
  assert.match(enrichmentSource, /customer_avatar_url: persisted\?\.profile_pic \|\| profile\.profile_pic/);
  assert.match(enrichmentSource, /instagram_profile: persisted \|\| profile/);
  assert.match(enrichmentSource, /messenger_profile: persisted \|\| profile/);
});

test("Instagram profile logs keep scoped identifiers masked and do not log tokens", () => {
  const instagramBranch = enrichmentSource.slice(
    enrichmentSource.indexOf("if (normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM)"),
    enrichmentSource.indexOf('console.log("messenger_profile_fetch_start"')
  );
  assert.match(instagramBranch, /scoped_user_id: maskIdForLog\(psid\)/);
  assert.doesNotMatch(instagramBranch, /conversation_id:/);
  assert.doesNotMatch(instagramBranch, /console\.(?:log|warn)\([^)]*\btoken\b/);
});
