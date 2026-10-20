// TikTok direct messages (Business Messaging API) — offline behavioural tests.
//
// Payload shapes are copied from TikTok's own Business Messaging docs (webhook
// schema for im_receive_msg / im_send_msg, /business/message/send/). No network,
// no database: every collaborator is injected.

import assert from "node:assert/strict";
import test from "node:test";

process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "tiktok-test-encryption-key";

const dm = await import("../../server/services/tiktokBusinessDmService.js");
const { webhookEventKey } = await import("../../server/routes/tiktokBusinessWebhook.js");
const { channelFromConversationSessionId, channelFromSessionIdSql } = await import("../../server/utils/inboxChannelIdentity.js");
const { normalizeChannel } = await import("../../server/services/aiChannelAdapterService.js");
const { resolveInboxRecipient, normalizeInboxSendChannel } = await import("../../server/services/inboxOutboundService.js");
const { TIKTOK_BUSINESS_PATHS } = await import("../../server/services/tiktokBusinessApiClient.js");

const BUSINESS_ID = "b1d2f34d-5b6c-78fb-91c2-cd345678912b";
const CONVERSATION_ID = "a1AbcBdeCfghDijkEF2b3+lmGn==";

const envelope = (event, content, createTime = 1701090882) => ({
  client_key: "bwo1m23456a7k89",
  event,
  create_time: createTime,
  user_openid: BUSINESS_ID,
  content: JSON.stringify(content),
});

const inboundText = (overrides = {}) => envelope("im_receive_msg", {
  from: "shopper_99",
  to: "m1store_egy",
  unique_identifier: "user-unique-1",
  from_user: { id: "user-unique-1", role: "personal_account" },
  to_user: { id: BUSINESS_ID, role: "business_account" },
  conversation_id: CONVERSATION_ID,
  message_id: "msg-1==",
  timestamp: 1701090879815,
  type: "text",
  text: { body: "عايز الكوتشي ده مقاس 42" },
  scene_type: 0,
  is_follower: true,
  message_tag: { source: "APP" },
  ...overrides,
});

const withEnv = async (overrides, fn) => {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const LIVE = { TIKTOK_BUSINESS_ENABLED: "true", TIKTOK_BUSINESS_MESSAGING_ENABLED: "true" };
const connected = (scopes = "message.list.read,message.list.send,message.list.manage") => async () => ({
  accessToken: "act.test-token",
  businessId: BUSINESS_ID,
  row: { granted_scopes: scopes },
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test("an inbound text message normalises to a tiktok: session addressed by conversation", () => {
  const normalized = dm.normalizeTikTokDmEvent(inboundText());
  assert.equal(normalized.direction, "inbound");
  assert.equal(normalized.session_id, `tiktok:${CONVERSATION_ID}`);
  assert.equal(normalized.conversation_id, CONVERSATION_ID);
  assert.equal(normalized.customer_id, "user-unique-1");
  assert.equal(normalized.customer_username, "shopper_99");
  assert.equal(normalized.text, "عايز الكوتشي ده مقاس 42");
  assert.equal(normalized.business_id, BUSINESS_ID);
});

test("a message the business sent is outbound and keeps the customer as the other side", () => {
  const normalized = dm.normalizeTikTokDmEvent(envelope("im_send_msg", {
    from: "m1store_egy",
    to: "shopper_99",
    from_user: { id: BUSINESS_ID, role: "business_account" },
    to_user: { id: "user-unique-1", role: "personal_account" },
    conversation_id: CONVERSATION_ID,
    message_id: "msg-2==",
    timestamp: 1701090890000,
    type: "text",
    text: { body: "متاح يا فندم" },
    message_tag: { source: "APP" },
  }));
  assert.equal(normalized.direction, "outbound");
  assert.equal(normalized.customer_id, "user-unique-1");
  assert.equal(normalized.customer_username, "shopper_99");
});

test("non-DM events and DM events without ids are ignored", () => {
  assert.equal(dm.normalizeTikTokDmEvent({ event: "comment.update", content: "{}" }), null);
  assert.equal(dm.normalizeTikTokDmEvent(envelope("im_receive_msg", { conversation_id: CONVERSATION_ID })), null);
});

test("messages without text get a readable preview", () => {
  assert.equal(dm.tiktokDmPreviewText({ type: "image" }), "صورة");
  assert.equal(dm.tiktokDmPreviewText({ type: "share_post", share_post: { embed_url: "https://www.tiktok.com/embed/1" } }), "فيديو تيكتوك: https://www.tiktok.com/embed/1");
});

// ---------------------------------------------------------------------------
// Webhook dedupe
// ---------------------------------------------------------------------------

test("a redelivered DM keeps its dedupe key even though create_time changes", () => {
  const first = webhookEventKey(inboundText());
  const retry = webhookEventKey({ ...inboundText(), create_time: 1701099999 });
  assert.equal(first, `tiktok_business:im_receive_msg:${BUSINESS_ID}:msg-1==`);
  assert.equal(retry, first);
});

test("comment webhook keys are unchanged by the DM branch", () => {
  const key = webhookEventKey({
    event: "comment.update",
    user_openid: BUSINESS_ID,
    create_time: 1,
    content: '{"comment_id":7247303576418566913,"video_id":7247303576418566000,"comment_action":"insert"}',
  });
  assert.equal(key, `tiktok_business:comment.update:${BUSINESS_ID}:1:7247303576418566913:insert`);
});

// ---------------------------------------------------------------------------
// Processing a stored webhook row
// ---------------------------------------------------------------------------

const recorder = () => {
  const calls = { inbound: [], outbound: [], upsert: [], emit: [], intake: [] };
  return {
    calls,
    deps: {
      resolveTenant: async (businessId) => (businessId === BUSINESS_ID ? 1 : null),
      appendInbound: async (args) => { calls.inbound.push(args); return { id: 501, ...args }; },
      appendOutbound: async (args) => { calls.outbound.push(args); return { id: 502, ...args }; },
      upsertConversation: async (args) => { calls.upsert.push(args); },
      logEvent: async () => {},
      emit: (rooms, event, payload) => { calls.emit.push({ rooms, event, payload }); },
      intake: async (args) => { calls.intake.push(args); },
      materialize: async () => [{ type: "image", url: "/uploads/inbox-media/tiktok/x.jpg", download_status: "stored" }],
    },
  };
};

test("an inbound DM lands in the inbox as a tiktok conversation and asks the AI for a suggestion", async () => {
  const { calls, deps } = recorder();
  const result = await dm.processTikTokDmEventRow({ payload: inboundText() }, deps);
  assert.equal(result.processed, true);
  assert.equal(calls.inbound.length, 1);
  assert.equal(calls.inbound[0].channel, "tiktok");
  assert.equal(calls.inbound[0].sessionId, `tiktok:${CONVERSATION_ID}`);
  assert.equal(calls.inbound[0].externalMessageId, "msg-1==");
  assert.equal(calls.inbound[0].customerName, "@shopper_99");
  assert.equal(calls.upsert[0].metadata.tiktok_conversation_id, CONVERSATION_ID);
  assert.equal(calls.upsert[0].externalCustomerId, "user-unique-1");
  assert.deepEqual(calls.emit.map((item) => item.event), ["ai_inbox:message", "ai_inbox:refresh"]);
  assert.equal(calls.emit[0].rooms[0], "tenant:1");
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].channel, "tiktok");
});

test("an inbound image is downloaded and attached", async () => {
  const { calls, deps } = recorder();
  await dm.processTikTokDmEventRow({ payload: inboundText({ type: "image", text: undefined, image: { media_id: "media-1=" } }) }, deps);
  assert.equal(calls.inbound[0].message, "صورة");
  assert.equal(calls.inbound[0].messageType, "image");
  assert.equal(calls.inbound[0].visualAttachments[0].url, "/uploads/inbox-media/tiktok/x.jpg");
});

test("our own API send echoed back by TikTok is not stored twice", async () => {
  const { calls, deps } = recorder();
  const result = await dm.processTikTokDmEventRow({
    payload: envelope("im_send_msg", {
      from_user: { id: BUSINESS_ID, role: "business_account" },
      to_user: { id: "user-unique-1", role: "personal_account" },
      conversation_id: CONVERSATION_ID,
      message_id: "msg-3==",
      type: "text",
      text: { body: "رد من السيستم" },
      message_tag: { source: "API" },
    }),
  }, deps);
  assert.equal(result.reason, "api_echo");
  assert.equal(calls.inbound.length + calls.outbound.length, 0);
});

test("a reply typed in the TikTok app is mirrored into the thread as staff, without AI intake", async () => {
  const { calls, deps } = recorder();
  await dm.processTikTokDmEventRow({
    payload: envelope("im_send_msg", {
      from: "m1store_egy",
      to: "shopper_99",
      from_user: { id: BUSINESS_ID, role: "business_account" },
      to_user: { id: "user-unique-1", role: "personal_account" },
      conversation_id: CONVERSATION_ID,
      message_id: "msg-4==",
      type: "text",
      text: { body: "رد من الموبايل" },
      message_tag: { source: "APP" },
    }),
  }, deps);
  assert.equal(calls.outbound.length, 1);
  assert.equal(calls.outbound[0].senderType, "staff");
  assert.equal(calls.outbound[0].channel, "tiktok");
  assert.equal(calls.intake.length, 0);
});

test("an event for an account no tenant owns is skipped, not guessed", async () => {
  const { calls, deps } = recorder();
  const result = await dm.processTikTokDmEventRow({ payload: { ...inboundText(), user_openid: "someone-else" } }, deps);
  assert.equal(result.processed, false);
  assert.equal(result.reason, "tenant_unresolved");
  assert.equal(calls.inbound.length, 0);
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test("a text reply is sent exactly as TikTok documents /business/message/send/", async () => {
  await withEnv(LIVE, async () => {
    const posted = [];
    const result = await dm.sendTikTokDirectText({
      tenantId: 1,
      conversationId: CONVERSATION_ID,
      messageText: "متاح مقاس 42",
      deps: {
        getToken: connected(),
        post: async (path, options) => { posted.push({ path, ...options }); return { message: { message_id: "sent-1" } }; },
      },
    });
    assert.equal(result.sent, true);
    assert.equal(result.message_id, "sent-1");
    assert.equal(posted[0].path, TIKTOK_BUSINESS_PATHS.MESSAGE_SEND);
    assert.equal(posted[0].accessToken, "act.test-token");
    assert.deepEqual(posted[0].body, {
      business_id: BUSINESS_ID,
      recipient_type: "CONVERSATION",
      recipient: CONVERSATION_ID,
      message_type: "TEXT",
      text: { body: "متاح مقاس 42" },
    });
  });
});

test("sending refuses while the messaging flag is off", async () => {
  await withEnv({ TIKTOK_BUSINESS_ENABLED: "true", TIKTOK_BUSINESS_MESSAGING_ENABLED: undefined }, async () => {
    await assert.rejects(
      () => dm.sendTikTokDirectText({ tenantId: 1, conversationId: CONVERSATION_ID, messageText: "x", deps: { getToken: connected() } }),
      (error) => error.code === "TIKTOK_DM_DISABLED"
    );
  });
});

test("sending refuses when the token lacks the send scope, with a reconnect hint", async () => {
  await withEnv(LIVE, async () => {
    await assert.rejects(
      () => dm.sendTikTokDirectText({ tenantId: 1, conversationId: CONVERSATION_ID, messageText: "x", deps: { getToken: connected("comment.list,comment.list.manage") } }),
      (error) => error.code === "TIKTOK_DM_SCOPE_MISSING"
    );
  });
});

test("over-long and empty texts are rejected locally", async () => {
  await withEnv(LIVE, async () => {
    await assert.rejects(
      () => dm.sendTikTokDirectText({ tenantId: 1, conversationId: CONVERSATION_ID, messageText: "x".repeat(6001), deps: { getToken: connected() } }),
      (error) => error.code === "TIKTOK_DM_TOO_LONG"
    );
    await assert.rejects(
      () => dm.sendTikTokDirectText({ tenantId: 1, conversationId: CONVERSATION_ID, messageText: "  ", deps: { getToken: connected() } }),
      (error) => error.code === "TIKTOK_DM_EMPTY"
    );
  });
});

test("an image is uploaded first, then sent by media_id", async () => {
  await withEnv(LIVE, async () => {
    const uploads = [];
    const posts = [];
    await dm.sendTikTokDirectImage({
      tenantId: 1,
      conversationId: CONVERSATION_ID,
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      deps: {
        getToken: connected(),
        upload: async (path, options) => { uploads.push({ path, ...options }); return { media_id: "media-9" }; },
        post: async (path, options) => { posts.push({ path, ...options }); return { message: { message_id: "sent-img" } }; },
      },
    });
    assert.equal(uploads[0].path, TIKTOK_BUSINESS_PATHS.MESSAGE_MEDIA_UPLOAD);
    assert.deepEqual(uploads[0].fields, { business_id: BUSINESS_ID, media_type: "IMAGE" });
    assert.deepEqual(posts[0].body.image, { media_id: "media-9" });
    assert.equal(posts[0].body.message_type, "IMAGE");
    assert.equal(posts[0].body.text, undefined);
  });
});

test("only JPG/PNG under 3MB are sent", async () => {
  await withEnv(LIVE, async () => {
    await assert.rejects(
      () => dm.sendTikTokDirectImage({ tenantId: 1, conversationId: CONVERSATION_ID, bytes: Buffer.from([1]), mimeType: "image/gif", deps: { getToken: connected() } }),
      (error) => error.code === "TIKTOK_DM_IMAGE_TYPE"
    );
    await assert.rejects(
      () => dm.sendTikTokDirectImage({ tenantId: 1, conversationId: CONVERSATION_ID, bytes: Buffer.alloc(3 * 1024 * 1024 + 1), mimeType: "image/png", deps: { getToken: connected() } }),
      (error) => error.code === "TIKTOK_DM_IMAGE_SIZE"
    );
  });
});

test("the webhook subscription uses event_type DIRECT_MESSAGE at app level", async () => {
  const posts = [];
  await dm.registerTikTokDmWebhook({
    appId: "7678378836345487380",
    appSecret: "secret",
    callbackUrl: "https://api.m1store-egy.com/api/webhooks/tiktok-business",
    deps: { post: async (path, options) => { posts.push({ path, ...options }); return { callback_url: "https://api.m1store-egy.com/api/webhooks/tiktok-business" }; } },
  });
  assert.equal(posts[0].path, TIKTOK_BUSINESS_PATHS.WEBHOOK_UPDATE);
  assert.equal(posts[0].body.event_type, "DIRECT_MESSAGE");
  assert.equal(posts[0].accessToken, undefined);
});

// ---------------------------------------------------------------------------
// The inbox knows the channel
// ---------------------------------------------------------------------------

test("tiktok: session ids file under TikTok everywhere the inbox resolves channels", () => {
  assert.equal(channelFromConversationSessionId(`tiktok:${CONVERSATION_ID}`), "tiktok");
  assert.match(channelFromSessionIdSql("s.session_id"), /'\^tiktok:' THEN 'tiktok'/);
  assert.equal(normalizeChannel("tiktok"), "tiktok");
  assert.equal(normalizeInboxSendChannel("tiktok"), "tiktok");
});

test("a TikTok conversation is addressed by its conversation id, from metadata or the session id", () => {
  const fromMetadata = resolveInboxRecipient({
    channel: "tiktok",
    session_id: `tiktok:${CONVERSATION_ID}`,
    external_customer_id: "user-unique-1",
    channel_metadata: { tiktok_conversation_id: CONVERSATION_ID },
  });
  assert.equal(fromMetadata.recipientId, CONVERSATION_ID);
  const fromSession = resolveInboxRecipient({ channel: "tiktok", session_id: `tiktok:${CONVERSATION_ID}`, external_customer_id: "user-unique-1" });
  assert.equal(fromSession.recipientId, CONVERSATION_ID);
});
