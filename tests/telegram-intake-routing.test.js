import test from "node:test";
import assert from "node:assert/strict";

// One webhook, four kinds of update. Routing them wrong is how a shopper's tap
// on "order now" becomes a conversation nobody answers, or how our own channel
// posts end up in the staff inbox.

const { processTelegramUpdateRecord } = await import("../server/services/telegramIntakeService.js");

const stubs = () => {
  const calls = { inbound: [], intake: [], start: [], callback: [], conversations: [] };
  return {
    calls,
    deps: {
      botToken: "test-token",
      materializeFile: async () => [],
      appendInbound: async (args) => { calls.inbound.push(args); return { id: 1 }; },
      upsertConversation: async (args) => { calls.conversations.push(args); },
      logEvent: async () => {},
      emit: () => {},
      intake: async (args) => { calls.intake.push(args); },
      onStartCommand: async (args) => { calls.start.push(args); return { handled: true }; },
      onCallbackQuery: async (args) => { calls.callback.push(args); return { handled: true }; },
    },
  };
};

const record = (payload) => ({ tenant_id: 1, payload });

test("our own channel post is ignored, and its chat id is reported for wiring the channel up", async () => {
  const { calls, deps } = stubs();
  const result = await processTelegramUpdateRecord(
    record({ update_id: 1, channel_post: { chat: { id: -1001234567890, title: "رجالي", type: "channel" }, message_id: 7, caption: "Nike" } }),
    deps
  );
  assert.equal(result.reason, "channel_post");
  assert.equal(result.chat_id, "-1001234567890");
  assert.deepEqual(calls.inbound, [], "a catalog post is not a customer message");
  assert.deepEqual(calls.intake, [], "and the AI is never asked about it");
});

test("a shopper arriving from an order button is answered by the shop bot, not by the AI", async () => {
  const { calls, deps } = stubs();
  const result = await processTelegramUpdateRecord(
    record({ update_id: 2, message: { chat: { id: 55, type: "private" }, from: { id: 55, first_name: "Ali" }, message_id: 9, text: "/start c1a2b3c4d5e6" } }),
    deps
  );
  assert.equal(result.start_payload, "c1a2b3c4d5e6");
  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0].chatId, "55");
  // Still recorded, so staff see the conversation...
  assert.equal(calls.inbound.length, 1);
  assert.equal(calls.conversations.length, 1);
  // ...but the AI is not asked, or the shopper gets two replies at once.
  assert.deepEqual(calls.intake, []);
});

test("an ordinary message still goes to the inbox and the AI, untouched", async () => {
  const { calls, deps } = stubs();
  await processTelegramUpdateRecord(
    record({ update_id: 3, message: { chat: { id: 55, type: "private" }, from: { id: 55 }, message_id: 10, text: "عايز الموديل ده مقاس 42" } }),
    deps
  );
  assert.deepEqual(calls.start, []);
  assert.equal(calls.inbound.length, 1);
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].autoReplyMode, "suggest_only");
});

test("a button tap is answered and leaves no transcript message behind", async () => {
  const { calls, deps } = stubs();
  const result = await processTelegramUpdateRecord(
    record({ update_id: 4, callback_query: { id: "cb9", data: "card:c1", from: { id: 55 }, message: { chat: { id: 55, type: "private" } } } }),
    deps
  );
  assert.equal(result.callback_query_id, "cb9");
  assert.equal(calls.callback.length, 1);
  assert.deepEqual(calls.inbound, []);
  assert.deepEqual(calls.intake, []);
});

test("a shop bot that throws does not cost the update: it is still marked processed", async () => {
  const { calls, deps } = stubs();
  const result = await processTelegramUpdateRecord(
    record({ update_id: 5, message: { chat: { id: 55, type: "private" }, from: { id: 55 }, message_id: 11, text: "/start c1" } }),
    { ...deps, onStartCommand: async () => { throw new Error("Telegram refused"); } }
  );
  assert.equal(result.processed, true);
  assert.equal(calls.inbound.length, 1, "the inbound message survives the failed reply");
});

test("an update shape we do not handle is ignored rather than crashing the worker", async () => {
  const { deps } = stubs();
  const result = await processTelegramUpdateRecord(record({ update_id: 6, poll_answer: { poll_id: "1" } }), deps);
  assert.equal(result.ignored, true);
  assert.equal(result.reason, "unsupported_update");
});
