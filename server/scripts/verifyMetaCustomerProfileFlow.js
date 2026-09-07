/*
 * Runs the Meta customer-profile flow end to end against the REAL service code and the
 * database this process is configured for, with the Graph API replaced by a recording
 * stub (no call ever leaves the machine). Uses a throwaway tenant id (990001) and
 * deletes every row it created at the end.
 *
 *   node server/scripts/verifyMetaCustomerProfileFlow.js
 *
 * Scenarios: new Messenger customer (store first, one Graph call, rows written), repeat
 * messages reuse the cache, Instagram endpoint + username, partial profile filled without
 * wiping, Meta refusal keeps the conversation and backs off, concurrent messages share one
 * call, slow Meta answers land in the background, manual refresh accepts Instagram.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

import db from "../database/db.js";
import * as meta from "../services/metaIntegrationService.js";
import * as policy from "../services/metaCustomerProfileService.js";

const TENANT = 990001;
const PAGE_ID = "109139174713691";
const IG_ACCOUNT = "17841400000000001";
const FB_PSID = "5036593356360590";
const IG_SID = "1044077131364783";
const FB_PSID_PARTIAL = "6111111111111111";
const FB_PSID_FAIL = "7222222222222222";

const secretKey = () => crypto.createHash("sha256").update(String(process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "SECRET_KEY").trim()).digest();
const encryptSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
};

// ---- Graph stub -----------------------------------------------------------
const calls = [];
const responses = new Map(); // id -> { status, body } | function
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof URL ? input.href : input.url || input));
  if (!/graph\.(facebook|instagram)\.com$/.test(url.hostname)) return realFetch(input, init);
  const id = decodeURIComponent(url.pathname.split("/").pop());
  const token = url.searchParams.get("access_token");
  calls.push({ host: url.hostname, id, fields: url.searchParams.get("fields"), tokenPresent: Boolean(token) });
  const canned = responses.get(id);
  const resolved = typeof canned === "function" ? await canned() : canned;
  const { status = 200, body = { id } } = resolved || {};
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const callsFor = (id) => calls.filter((call) => call.id === id);

// ---- fixtures -------------------------------------------------------------
const cleanup = async () => {
  await db.query(`DELETE FROM ai_support_messages WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM ai_support_sessions WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM ai_channel_conversations WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM ai_customer_profiles WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM meta_integration_configs WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM ai_channel_event_logs WHERE tenant_id = $1`, [TENANT]).catch(() => {});
  await db.query(`DELETE FROM ai_persistent_events WHERE tenant_id = $1`, [TENANT]).catch(() => {});
};
await cleanup();
await db.query(
  `INSERT INTO meta_integration_configs (tenant_id, facebook_page_id, page_access_token_encrypted, instagram_business_account_id, status, webhook_enabled, messenger_enabled, instagram_enabled)
   VALUES ($1, $2, $3, $4, 'active', TRUE, TRUE, TRUE)`,
  [TENANT, PAGE_ID, encryptSecret("EAAB-fake-page-token-for-local-run"), IG_ACCOUNT]
);
const seedConversation = async ({ channel, id, name = "", avatar = "" }) => {
  const conversationId = `${channel}:${id}`;
  await db.query(
    `INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, customer_avatar_url, last_message, updated_at)
     VALUES ($1, $2, $3, $6, $4, $5, 'hi', NOW()) ON CONFLICT DO NOTHING`,
    [TENANT, conversationId, channel, name, avatar, channel]
  );
  await db.query(
    `INSERT INTO ai_channel_conversations (tenant_id, channel, external_conversation_id, external_customer_id, customer_name, customer_avatar_url, metadata, last_message_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [TENANT, channel, conversationId, id, name, avatar, JSON.stringify(channel === "instagram" ? { instagram_business_account_id: IG_ACCOUNT, account_id: IG_ACCOUNT } : { page_id: PAGE_ID })]
  );
  return conversationId;
};
const readRows = async ({ channel, id }) => {
  const conversationId = `${channel}:${id}`;
  const conv = (await db.query(`SELECT customer_name, customer_avatar_url, customer_profile_id, metadata FROM ai_channel_conversations WHERE tenant_id = $1 AND external_conversation_id = $2`, [TENANT, conversationId])).rows[0];
  const session = (await db.query(`SELECT customer_name, customer_avatar_url FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2`, [TENANT, conversationId])).rows[0];
  const profile = (await db.query(`SELECT display_name, username, profile_pic_url, profile_sync_status, last_profile_sync_at FROM ai_customer_profiles WHERE tenant_id = $1 AND phone = $2`, [TENANT, `meta:${channel}:${id}`])).rows[0];
  return { conv, session, profile };
};
const messageFor = ({ channel, id }) => ({
  channel,
  external_conversation_id: `${channel}:${id}`,
  external_customer_id: id,
  message_text: "hello",
  raw: { sender_psid: id, customer_psid: id, page_id: channel === "instagram" ? "" : PAGE_ID },
});
const config = { tenant_id: TENANT, facebook_page_id: PAGE_ID, instagram_business_account_id: IG_ACCOUNT, id: null };
const results = [];
// warm-up: the first profile call runs the guarded schema ensure + name repair on the local tables
await meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id: "1000000000000001" }), config, facebookPageId: PAGE_ID, cacheOnly: true });
const check = (label, fn) => Promise.resolve().then(fn).then(() => results.push(`PASS ${label}`)).catch((error) => results.push(`FAIL ${label}: ${error.message}`));

try {
  // 1. Brand-new Messenger customer: cache-only first (no Graph call), then hydrate -> name + picture persisted everywhere.
  await check("new Messenger customer: cacheOnly makes no Graph call and marks the refresh pending", async () => {
    await seedConversation({ channel: "facebook_messenger", id: FB_PSID });
    responses.set(FB_PSID, { body: { id: FB_PSID, first_name: "Hend", last_name: "Mostafa", name: "Hend Mostafa", profile_pic: "https://scontent.example/hend.jpg" } });
    const cached = await meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id: FB_PSID }), config, facebookPageId: PAGE_ID, cacheOnly: true });
    assert.equal(callsFor(FB_PSID).length, 0);
    assert.equal(cached.profile_refresh_pending, true);
    assert.equal(cached.customer_name, "");
  });
  await check("new Messenger customer: hydrate fetches ONCE on graph.facebook.com and stores name + picture on profile, conversation and session", async () => {
    const message = messageFor({ channel: "facebook_messenger", id: FB_PSID });
    const outcome = await meta.hydrateStoredMetaCustomerProfile({ message, config, facebookPageId: PAGE_ID, waitMs: 5000 });
    assert.equal(outcome.settled, true);
    assert.equal(outcome.refreshed, true);
    assert.equal(message.customer_name, "Hend Mostafa");
    assert.equal(message.customer_avatar_url, "https://scontent.example/hend.jpg");
    const fbCalls = callsFor(FB_PSID);
    assert.equal(fbCalls.length, 1);
    assert.equal(fbCalls[0].host, "graph.facebook.com");
    assert.equal(fbCalls[0].fields, "first_name,last_name,name,profile_pic");
    assert.equal(fbCalls[0].tokenPresent, true);
    const rows = await readRows({ channel: "facebook_messenger", id: FB_PSID });
    assert.equal(rows.profile.display_name, "Hend Mostafa");
    assert.equal(rows.profile.profile_pic_url, "https://scontent.example/hend.jpg");
    assert.equal(rows.profile.profile_sync_status, "ok");
    assert.equal(rows.conv.customer_name, "Hend Mostafa");
    assert.equal(rows.conv.customer_avatar_url, "https://scontent.example/hend.jpg");
    assert.equal(rows.session.customer_name, "Hend Mostafa");
    assert.equal(rows.session.customer_avatar_url, "https://scontent.example/hend.jpg");
  });
  // 2. Next messages from the same customer do NOT call Meta again.
  await check("second and third message from the same customer reuse the stored profile (no Graph call)", async () => {
    for (let i = 0; i < 2; i += 1) {
      const message = messageFor({ channel: "facebook_messenger", id: FB_PSID });
      const cached = await meta.enrichMessengerProfile({ message, config, facebookPageId: PAGE_ID, cacheOnly: true });
      assert.equal(cached.profile_refresh_pending, false, cached.profile_refresh_reason);
      assert.equal(cached.customer_name, "Hend Mostafa");
      assert.equal(cached.customer_avatar_url, "https://scontent.example/hend.jpg");
      const full = await meta.enrichMessengerProfile({ message, config, facebookPageId: PAGE_ID });
      assert.equal(full.customer_name, "Hend Mostafa");
    }
    assert.equal(callsFor(FB_PSID).length, 1, "still exactly one Graph call for this customer");
  });
  // 3. Instagram: different endpoint + fields, username persisted.
  await check("Instagram customer: fetched via graph.facebook.com/{IGSID}?fields=name,username,profile_pic with the page token; username stored", async () => {
    await seedConversation({ channel: "instagram", id: IG_SID });
    responses.set(IG_SID, { body: { id: IG_SID, name: "Maged Abuzied", username: "m1store.egy", profile_pic: "https://scontent.example/ig.jpg" } });
    const message = messageFor({ channel: "instagram", id: IG_SID });
    const outcome = await meta.hydrateStoredMetaCustomerProfile({ message, config, instagramBusinessAccountId: IG_ACCOUNT, waitMs: 5000 });
    assert.equal(outcome.settled, true);
    const igCalls = callsFor(IG_SID);
    assert.equal(igCalls.length, 1);
    assert.equal(igCalls[0].host, "graph.facebook.com", "page token ⇒ graph.facebook.com host");
    assert.equal(igCalls[0].fields, "name,username,profile_pic");
    assert.equal(message.customer_name, "Maged Abuzied");
    assert.equal(message.customer_username, "m1store.egy");
    const rows = await readRows({ channel: "instagram", id: IG_SID });
    assert.equal(rows.profile.username, "m1store.egy");
    assert.equal(rows.profile.display_name, "Maged Abuzied");
    assert.equal(rows.conv.metadata?.messenger_profile?.username, "m1store.egy");
    assert.equal(rows.conv.customer_avatar_url, "https://scontent.example/ig.jpg");
  });
  // 4. Existing partial profile (name, no picture): the picture is filled, the name kept; blanks never wipe.
  await check("partial existing customer: picture filled in, existing name kept; a later blank answer wipes nothing", async () => {
    await seedConversation({ channel: "facebook_messenger", id: FB_PSID_PARTIAL, name: "Old Stored Name" });
    responses.set(FB_PSID_PARTIAL, { body: { id: FB_PSID_PARTIAL, profile_pic: "https://scontent.example/partial.jpg" } });
    const message = messageFor({ channel: "facebook_messenger", id: FB_PSID_PARTIAL });
    const cached = await meta.enrichMessengerProfile({ message, config, facebookPageId: PAGE_ID, cacheOnly: true });
    assert.equal(cached.profile_refresh_pending, true, "name without picture and never fetched ⇒ refresh");
    await meta.hydrateStoredMetaCustomerProfile({ message, config, facebookPageId: PAGE_ID, waitMs: 5000 });
    let rows = await readRows({ channel: "facebook_messenger", id: FB_PSID_PARTIAL });
    assert.equal(rows.conv.customer_name, "Old Stored Name");
    assert.equal(rows.conv.customer_avatar_url, "https://scontent.example/partial.jpg");
    assert.equal(rows.profile.profile_pic_url, "https://scontent.example/partial.jpg");
    // now Meta answers with nothing usable: forced refresh must keep everything
    responses.set(FB_PSID_PARTIAL, { body: { id: FB_PSID_PARTIAL } });
    await meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id: FB_PSID_PARTIAL }), config, facebookPageId: PAGE_ID, forceRefresh: true });
    rows = await readRows({ channel: "facebook_messenger", id: FB_PSID_PARTIAL });
    assert.equal(rows.conv.customer_name, "Old Stored Name");
    assert.equal(rows.conv.customer_avatar_url, "https://scontent.example/partial.jpg");
    assert.equal(rows.profile.profile_pic_url, "https://scontent.example/partial.jpg");
  });
  // 5. Meta failure: no throw, rows intact, failure remembered so the next message does not re-ask.
  await check("Meta refuses (100/33): nothing thrown, conversation intact, next message does not call Meta again", async () => {
    await seedConversation({ channel: "facebook_messenger", id: FB_PSID_FAIL });
    responses.set(FB_PSID_FAIL, { status: 400, body: { error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100, error_subcode: 33 } } });
    const message = messageFor({ channel: "facebook_messenger", id: FB_PSID_FAIL });
    const outcome = await meta.hydrateStoredMetaCustomerProfile({ message, config, facebookPageId: PAGE_ID, waitMs: 5000 });
    assert.equal(outcome.settled, true);
    assert.equal(outcome.refreshed, false);
    assert.equal(message.customer_name, "");
    const rows = await readRows({ channel: "facebook_messenger", id: FB_PSID_FAIL });
    assert.ok(rows.conv, "conversation row still there");
    assert.ok(rows.session, "session row still there");
    assert.equal(callsFor(FB_PSID_FAIL).length, 1);
    const again = await meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id: FB_PSID_FAIL }), config, facebookPageId: PAGE_ID });
    assert.equal(again.customer_name, "");
    assert.equal(callsFor(FB_PSID_FAIL).length, 1, "failure backoff: no second call");
    assert.match(policy.metaProfileCoordinator.getFailure(policy.metaProfileCoordinator.key({ tenantId: TENANT, channel: "facebook_messenger", externalCustomerId: FB_PSID_FAIL })).kind, /unavailable/);
  });
  // 6. Concurrency: two messages at once share one Graph call.
  await check("two simultaneous messages from one new customer share a single Graph call", async () => {
    const id = "8333333333333333";
    await seedConversation({ channel: "facebook_messenger", id });
    responses.set(id, () => new Promise((resolve) => setTimeout(() => resolve({ body: { id, first_name: "Sara", last_name: "Ali", name: "Sara Ali", profile_pic: "https://scontent.example/sara.jpg" } }), 150)));
    const [a, b] = await Promise.all([
      meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id }), config, facebookPageId: PAGE_ID }),
      meta.enrichMessengerProfile({ message: messageFor({ channel: "facebook_messenger", id }), config, facebookPageId: PAGE_ID }),
    ]);
    assert.equal(a.customer_name, "Sara Ali");
    assert.equal(b.customer_name, "Sara Ali");
    assert.equal(b.customer_avatar_url, "https://scontent.example/sara.jpg");
    assert.equal(callsFor(id).length, 1);
  });
  // 7. Slow Meta: the webhook wait gives up but the background fetch still lands in the rows.
  await check("slow Meta answer: bounded wait returns without the name, background fetch still writes the rows", async () => {
    const id = "9444444444444444";
    await seedConversation({ channel: "facebook_messenger", id });
    responses.set(id, () => new Promise((resolve) => setTimeout(() => resolve({ body: { id, first_name: "Late", last_name: "Answer", name: "Late Answer", profile_pic: "https://scontent.example/late.jpg" } }), 400)));
    const message = messageFor({ channel: "facebook_messenger", id });
    const outcome = await meta.hydrateStoredMetaCustomerProfile({ message, config, facebookPageId: PAGE_ID, waitMs: 50 });
    assert.equal(outcome.settled, false);
    assert.equal(message.customer_name || "", "", "nothing applied while Meta is still slow");
    await new Promise((resolve) => setTimeout(resolve, 900));
    const rows = await readRows({ channel: "facebook_messenger", id });
    assert.equal(rows.conv.customer_name, "Late Answer");
    assert.equal(rows.session.customer_avatar_url, "https://scontent.example/late.jpg");
  });
  // 8. Manual refresh for Instagram goes through (was Messenger-only).
  await check("manual refresh endpoint logic accepts an Instagram conversation", async () => {
    responses.set(IG_SID, { body: { id: IG_SID, name: "Maged Abuzied", username: "m1store.egy", profile_pic: "https://scontent.example/ig2.jpg" } });
    const result = await meta.refreshMessengerProfileForConversation({ tenantId: TENANT, conversationId: `instagram:${IG_SID}` });
    assert.equal(result.new_name, "Maged Abuzied");
    assert.equal(result.customer_username, "m1store.egy");
    assert.equal(result.customer_avatar_url, "https://scontent.example/ig2.jpg");
    assert.equal(callsFor(IG_SID).length, 2, "forced refresh made a second call");
  });
} finally {
  await cleanup();
  globalThis.fetch = realFetch;
}
console.log(results.join("\n"));
console.log(`graph calls total: ${calls.length}`);
process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
