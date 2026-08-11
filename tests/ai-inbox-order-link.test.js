import test from "node:test";
import assert from "node:assert/strict";

import {
  aiInboxOrderChannel,
  aiInboxOrderConversationId,
  buildAiInboxOrderUrl,
} from "../src/modules/orders/lib/aiInboxOrderLink.js";
import { findDeepLinkedConversation } from "../src/modules/aiSupport/services/inboxDeepLink.js";

test("AI Inbox orders expose their original Messenger conversation", () => {
  const order = {
    ai_agent_conversation_id: "5036593356360590",
    channel: "web_chat",
    ai_agent_metadata: { channel: "facebook_messenger" },
  };
  assert.equal(aiInboxOrderConversationId(order), "5036593356360590");
  assert.equal(aiInboxOrderChannel(order), "messenger");
  assert.equal(
    buildAiInboxOrderUrl(order),
    "/admin/ai-inbox?conversation=5036593356360590&channel=messenger"
  );
});

test("AI Inbox orders expose their original Instagram conversation from JSON metadata", () => {
  const order = {
    ai_agent_session_id: "ig-thread-22",
    ai_agent_metadata: JSON.stringify({ channel: "instagram" }),
  };
  assert.equal(aiInboxOrderChannel(order), "instagram");
  assert.equal(buildAiInboxOrderUrl(order), "/admin/ai-inbox?conversation=ig-thread-22&channel=instagram");
});

test("deep links select the exact customer conversation in the requested channel", () => {
  const conversations = [
    { conversation_key: "messenger:123", session_id: "123", channel: "facebook_messenger" },
    { conversation_key: "instagram:123", session_id: "123", channel: "instagram" },
  ];
  assert.equal(findDeepLinkedConversation(conversations, "123", "instagram")?.conversation_key, "instagram:123");
  assert.equal(findDeepLinkedConversation(conversations, "messenger:123", "messenger")?.conversation_key, "messenger:123");
});

