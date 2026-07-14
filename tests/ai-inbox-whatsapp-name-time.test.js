import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { resolveConversationDisplayName } from "../server/services/aiSalesAgentService.js";

test("WhatsApp display name rejects Customer and falls back to the phone", () => {
  assert.equal(resolveConversationDisplayName({
    conversation: {
      channel: "whatsapp",
      session_customer_name: "Customer",
      external_customer_id: "201001234567",
      session_id: "whatsapp:201001234567",
    },
  }), "201001234567");
});

test("WhatsApp display name prefers the saved channel contact name", () => {
  assert.equal(resolveConversationDisplayName({
    conversation: {
      channel: "whatsapp",
      channel_customer_name: "Ahmed Ali",
      session_customer_name: "Customer",
      external_customer_id: "201001234567",
    },
  }), "Ahmed Ali");
});

test("AI Inbox ordering uses the latest message timestamp before session update time", () => {
  const source = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(source, /COALESCE\(m\.latest_message_created_at, c\.last_message_at, s\.updated_at\) DESC/);
  assert.match(source, /COALESCE\(m\.created_at, c\.last_message_at, s\.updated_at\) DESC/);
});

test("AI Inbox unread count is based on new customer messages after read or staff reply", () => {
  const source = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(source, /unread_msg\.sender_type = 'customer'/);
  assert.match(source, /staff_msg\.sender_type = 'staff'/);
  assert.doesNotMatch(source, /requiresAttention && \(!readAt \|\| lastActivityAt > readAt\)/);
});

test("desktop AI Inbox marks an opened unread conversation as read", () => {
  const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.match(source, /perfComponent: "AiInbox\.markRead"/);
  assert.match(source, /unread_count: 0/);
});
