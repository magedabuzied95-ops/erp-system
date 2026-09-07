import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source-level guards on the webhook path. They pin the ORDER of operations and the
// logging discipline that the behavioural tests in meta-customer-profile-policy
// cannot see: the message is stored before Meta is asked, a failed lookup cannot
// lose the message, and no token value reaches a log line.

const source = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const webhookStart = source.indexOf("export const processMetaWebhook = async");
const webhookSource = source.slice(webhookStart, source.indexOf("\n};", source.indexOf("const results = [];", webhookStart)));

const enrichStart = source.indexOf("export const enrichMessengerProfile = async");
const enrichEnd = source.indexOf("export const repairMessengerProfileCaptures", enrichStart);
const enrichSource = source.slice(enrichStart, enrichEnd);

test("webhook: the message is stored BEFORE the Graph profile lookup runs", () => {
  const cacheOnlyCall = webhookSource.indexOf("cacheOnly: true");
  const storeCall = webhookSource.indexOf("await logIncomingToInbox({ message, config })");
  const mappingCall = webhookSource.indexOf("await upsertChannelConversationMapping({");
  const hydrateCall = webhookSource.indexOf("await hydrateStoredMetaCustomerProfile({");
  assert.ok(cacheOnlyCall > 0, "identity comes from the database before storage");
  assert.ok(storeCall > cacheOnlyCall, "message stored after the cache read");
  assert.ok(mappingCall > storeCall, "conversation row upserted after the message");
  assert.ok(hydrateCall > mappingCall, "Graph lookup only after message + conversation rows exist");
  // the pre-storage call must not be a Graph fetch
  const preStorage = webhookSource.slice(0, storeCall);
  assert.doesNotMatch(preStorage, /forceRefresh: true/);
  assert.match(preStorage, /\.catch\(\(\) => incomingMessage\)/, "a cache read failure still stores the message");
});

test("webhook: the post-storage lookup is bounded and continues in the background", () => {
  assert.match(source, /export const hydrateStoredMetaCustomerProfile = async/);
  assert.match(source, /const outcome = await waitAtMost\(fetchPromise, waitMs\)/);
  assert.match(source, /reason: "meta_profile_refreshed"/, "a late answer refreshes the open inbox");
  assert.match(source, /META_PROFILE_WEBHOOK_WAIT_MS/);
});

test("enrichment: cache policy + in-flight dedupe + failure backoff sit in front of every Graph call", () => {
  assert.match(enrichSource, /resolveMetaProfileRefreshDecision\(\{/);
  assert.match(enrichSource, /metaProfileCoordinator\.run\(coordinatorKey/);
  assert.match(enrichSource, /metaProfileCoordinator\.noteFailure\(coordinatorKey, error\)/);
  assert.match(enrichSource, /metaProfileCoordinator\.clearFailure\(coordinatorKey\)/);
  assert.match(enrichSource, /if \(cacheOnly \|\| !decision\.refresh\)/);
  // every Graph profile request carries a timeout signal
  assert.match(enrichSource, /signal: profileFetchSignal\(\)/);
});

test("enrichment: Instagram and Messenger take different endpoints and field sets", () => {
  const igBranch = enrichSource.slice(enrichSource.indexOf("if (normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM)"), enrichSource.indexOf('console.log("messenger_profile_fetch_start"'));
  const messengerBranch = enrichSource.slice(enrichSource.indexOf('console.log("messenger_profile_fetch_start"'));
  assert.match(igBranch, /callInstagramGraph\(/);
  assert.match(igBranch, /"name,username,profile_pic"/);
  assert.doesNotMatch(messengerBranch, /callInstagramGraph\(/);
  assert.match(messengerBranch, /"first_name,last_name,name,profile_pic"/);
  assert.match(messengerBranch, /normalizeMetaProfilePayload\(\{ channel: AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, payload \}\)/);
  assert.match(igBranch, /normalizeMetaProfilePayload\(\{ channel: AI_AGENT_CHANNELS\.INSTAGRAM, payload \}\)/);
});

test("enrichment: a failed Graph call returns the message with what was already known", () => {
  assert.match(enrichSource, /customer_name: cached\?\.name \|\| message\.customer_name \|\| ""/);
  assert.match(enrichSource, /customer_avatar_url: cached\?\.profile_pic \|\| message\.customer_avatar_url \|\| ""/);
  assert.match(enrichSource, /await markMetaProfileSyncFailure\(/);
});

test("logging: profile log lines carry presence flags and error classes, never a token or a name value", () => {
  const profileLogs = enrichSource.match(/console\.(?:log|warn)\("(?:messenger|instagram)_profile_[a-z_]+",[\s\S]*?\n\s*\}\);/g) || [];
  assert.ok(profileLogs.length >= 6, "profile log lines present");
  for (const line of profileLogs) {
    assert.doesNotMatch(line, /\btoken:/, "no token value in a log line");
    assert.doesNotMatch(line, /access_token/);
    assert.doesNotMatch(line, /first_name: text\(payload/, "no name value in a log line");
    assert.doesNotMatch(line, /profile_pic: text\(payload/, "no picture url in a log line");
  }
  assert.match(enrichSource, /has_profile_pic: Boolean\(text\(payload\.profile_pic\)\)/);
  assert.match(enrichSource, /error_kind: classified\.kind/);
});

test("storage: username and sync status are persisted, and no column upsert can blank a stored value", () => {
  const persistStart = source.indexOf("const persistMessengerProfile = async");
  const persistSource = source.slice(persistStart, source.indexOf("\n};", persistStart));
  assert.match(persistSource, /username = COALESCE\(NULLIF\(EXCLUDED\.username, ''\), ai_customer_profiles\.username\)/);
  assert.match(persistSource, /profile_pic_url = COALESCE\(NULLIF\(EXCLUDED\.profile_pic_url, ''\), ai_customer_profiles\.profile_pic_url\)/);
  assert.match(persistSource, /display_name = COALESCE\(NULLIF\(EXCLUDED\.display_name, ''\), ai_customer_profiles\.display_name\)/);
  assert.match(persistSource, /profile_sync_status = 'ok'/);
  assert.match(persistSource, /customer_avatar_url = COALESCE\(NULLIF\(\$5::text, ''\), customer_avatar_url\)/);
  assert.match(source, /ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT ''/);
  assert.match(source, /ADD COLUMN IF NOT EXISTS profile_sync_status TEXT NOT NULL DEFAULT ''/);
});

test("a Graph-sourced name is judged structurally, never by the chat-message heuristics", () => {
  // persistMessengerProfile and the cache read must use the Graph filter; the
  // message-capture filter (isUnsafeMessengerStoredName) belongs to chat text only.
  const persistStart = source.indexOf("const persistMessengerProfile = async");
  const persistSource = source.slice(persistStart, source.indexOf("\n};", persistStart));
  assert.match(persistSource, /const name = isPlausibleMetaProfileName\(candidateName\) \? candidateName : "";/);
  assert.doesNotMatch(persistSource, /isUnsafeMessengerStoredName\(candidateName\)/);
  assert.match(source, /const safeName = isPlausibleMetaProfileName\(fullName\) \? fullName : "";/);
  // the cached read prefers the Graph name once the row carries a sync timestamp
  assert.match(source, /const graphSourced = Boolean\(row\.last_profile_sync_at/);
  assert.match(source, /graphSourced && isPlausibleMetaProfileName\(graphName\)/);

  const inbox = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(inbox, /import \{ isPlausibleMetaProfileName \} from "\.\/metaCustomerProfileService\.js"/);
  assert.match(inbox, /if \(isMessenger && graphSourced\) \{/);
  assert.match(inbox, /if \(!isPlausibleMetaProfileName\(name\) \|\| idCandidates\.includes\(name\.replace\(\/\\s\+\/g, ""\)\)\) continue;/);
  assert.match(inbox, /p\.last_profile_sync_at AS profile_last_sync_at,/);
  assert.match(inbox, /customerProfile: conversation\.profile_last_sync_at/);

  const ui = fs.readFileSync(new URL("../src/modules/aiSupport/lib/customerIdentity.js", import.meta.url), "utf8");
  assert.match(ui, /export const isPlausibleProfileName = \(value = ""\) => \{/);
  assert.match(ui, /candidates\.find\(\(candidate\) => isPlausibleProfileName\(candidate\)\)/);
});

test("manual refresh + sync accept Instagram conversations (not Messenger-only any more)", () => {
  assert.match(source, /const syncInstagramProfileForConversation = async/);
  assert.match(source, /if \(refreshChannel === AI_AGENT_CHANNELS\.INSTAGRAM\)/);
  assert.match(source, /if \(syncChannel === AI_AGENT_CHANNELS\.INSTAGRAM\)/);
  assert.doesNotMatch(source, /Messenger profile refresh is only available for Facebook Messenger conversations/);
});

test("inbox list exposes the Instagram username to the UI", () => {
  const inbox = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(inbox, /p\.username AS profile_username,/);
  assert.match(inbox, /username: text\(conversation\.profile_username \|\| existingChannelMetadata\.messenger_profile\?\.username \|\| ""\)/);
});

test("the backfill script goes through the production enrichment with forceRefresh, paces itself and is resumable", () => {
  const script = fs.readFileSync(new URL("../server/scripts/backfillMetaCustomerProfiles.js", import.meta.url), "utf8");
  assert.match(script, /import \{ enrichMessengerProfile \} from "\.\.\/services\/metaIntegrationService\.js"/);
  assert.match(script, /forceRefresh: true/);
  assert.match(script, /isRateLimitError: isGraphRateLimitError/);
  assert.match(script, /shouldDefer: shouldDeferBackgroundGraphWork/);
  assert.match(script, /runMetaProfileBackfill\(\{/);
  assert.match(script, /--probe/);
  assert.doesNotMatch(script, /console\.log\([^)]*token/i);
  const runner = fs.readFileSync(new URL("../server/scripts/lib/metaProfileBackfillRunner.js", import.meta.url), "utf8");
  assert.match(runner, /recentlyDone\(\{ state, key, skipHours, force, now \}\)/);
  assert.match(runner, /rememberedUnavailable\(\{ state, key, force, now, unavailableRetryMs \}\)/);
});

test("the new service file is allow-listed past the server/services ignore rule", () => {
  const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /^!server\/services\/metaCustomerProfileService\.js$/m);
});
