import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const reviewerSource = fs.readFileSync(new URL("../server/services/metaReviewerInboxService.js", import.meta.url), "utf8");
const start = source.indexOf("export const enrichMessengerProfile = async");
const end = source.indexOf("export const repairMessengerProfileCaptures", start);
const enrichmentSource = source.slice(start, end);
const igBranch = enrichmentSource.slice(
  enrichmentSource.indexOf("if (normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM)"),
  enrichmentSource.indexOf('console.log("messenger_profile_fetch_start"')
);
// persistMessengerProfile body (no-wipe guarantees)
const persistStart = source.indexOf("const persistMessengerProfile = async");
const persistSource = source.slice(persistStart, source.indexOf("\n};", persistStart));

test("IG enrichment reads the sender IGSID and requests only name,username,profile_pic", () => {
  assert.ok(start >= 0 && end > start, "profile enrichment implementation must be present");
  assert.match(enrichmentSource, /\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\.includes\(normalizedChannel\)/);
  assert.match(enrichmentSource, /const psid = text\(message\?\.raw\?\.sender_psid \|\| message\?\.external_customer_id\)/);
  assert.match(igBranch, /const igFields = "name,username,profile_pic"/);
});

test("ROOT CAUSE FIX: IG profile base URL matches the resolved token type, with cross-fallback", () => {
  // Instagram-Login token -> graph.instagram.com; Page-token fallback -> graph.facebook.com/{igsid}
  assert.match(igBranch, /instagramBusinessLogin/);
  assert.match(igBranch, /fetchViaInstagram = \(\) => callInstagramGraph\(/);
  assert.match(igBranch, /fetchViaFacebook = \(\) => callMetaGet\(/);
  assert.match(igBranch, /instagramBusinessLogin \? fetchViaInstagram\(\) : fetchViaFacebook\(\)/);
  // if the primary returns no usable fields, try the OTHER official path
  assert.match(igBranch, /if \(!hasUsableProfile\(payload\)\)/);
  assert.match(igBranch, /hasUsableProfile = \(p\) => Boolean\(p && \(text\(p\.name\) \|\| text\(p\.username\) \|\| text\(p\.profile_pic\)\)\)/);
});

test("safe diagnostics: response key names + presence + token type, no id/token/name values", () => {
  assert.match(igBranch, /console\.log\("instagram_profile_graph_response"/);
  assert.match(igBranch, /response_keys: Object\.keys\(payload \|\| \{\}\)/);
  assert.match(igBranch, /has_name: Boolean\(text\(payload\?\.name\)\)/);
  assert.match(igBranch, /has_username: Boolean\(text\(payload\?\.username\)\)/);
  assert.match(igBranch, /has_profile_pic: Boolean\(text\(payload\?\.profile_pic\)\)/);
  assert.match(igBranch, /instagram_business_login: Boolean\(instagramBusinessLogin\)/);
  // scoped id stays masked; the raw token value is never logged
  assert.match(igBranch, /scoped_user_id: maskIdForLog\(psid\)/);
  assert.doesNotMatch(igBranch, /console\.(?:log|warn)\([^)]*\btoken\b[^_]/);
});

test("fallback ordering: name -> username -> saved name; scoped id is never used as the name", () => {
  assert.match(igBranch, /const displayName = text\(payload\.name \|\| payload\.username\)/);
  assert.match(igBranch, /customer_name: persisted\?\.name \|\| displayName \|\| cached\?\.name \|\| ""/);
  // the failure branch must not fall back to the scoped id as a name
  assert.match(igBranch, /customer_name: cached\?\.name \|\| message\.customer_name \|\| ""/);
  assert.doesNotMatch(igBranch, /customer_name:[^\n]*psid/);
});

test("avatar: uses profile_pic, keeps previously saved avatar, never overwrites with blank", () => {
  assert.match(igBranch, /customer_avatar_url: persisted\?\.profile_pic \|\| profile\.profile_pic \|\| cached\?\.profile_pic \|\| ""/);
  // persist bails before writing when both name and pic are empty (no-wipe)
  assert.match(persistSource, /if \(!tenantId \|\| !psid \|\| \(!name && !profilePic\)\) return null;/);
  // and every column upsert coalesces to the existing stored value
  assert.match(persistSource, /profile_pic_url = COALESCE\(NULLIF\(EXCLUDED\.profile_pic_url, ''\), ai_customer_profiles\.profile_pic_url\)/);
  assert.match(persistSource, /customer_name = COALESCE\(NULLIF\(EXCLUDED\.customer_name, ''\), ai_customer_profiles\.customer_name\)/);
});

test("main AI Inbox never displays the Instagram scoped id as the conversation name", () => {
  const pwa = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
  assert.match(pwa, /const isInstagramDmConversation = \(conversation = \{\}\) =>/);
  // scoped id excluded from the resolved display name for IG DMs
  assert.match(pwa, /\(isMessengerConversation\(conversation\) \|\| isInstagramDmConversation\(conversation\)\) && isLikelyMessengerExternalId\(value\)/);
  // safe label instead of the scoped id when no real name resolved
  assert.match(pwa, /if \(!resolved && isInstagramDmConversation\(conversation\)\) return "مستخدم Instagram"/);
});

test("meta_reviewer never exposes the scoped id as a name and falls back safely", () => {
  // reviewer inbox display name: channel/session name, else 'Meta test account' — never the scoped id
  assert.match(reviewerSource, /COALESCE\(NULLIF\(c\.customer_name, ''\), NULLIF\(s\.customer_name, ''\), 'Meta test account'\) AS customer_name/);
  assert.match(reviewerSource, /customer_name: text\(row\.customer_name \|\| "Meta test account"\)/);
});
