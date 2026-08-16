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
  assert.match(source, /currentUnreadCount \+ 1/);
});

test("PWA keeps a live inbound message unread until the read endpoint records it", () => {
  const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
  assert.match(source, /unreadCount \+ 1/);
  assert.doesNotMatch(source, /conversationMatchesRealtimeKeys\(conversation, activeConversationKeys\) \? 0/);
});

test("older-message pagination uses an exact timestamp and id cursor", () => {
  const service = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  const desktop = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.match(service, /messageLimit \+ 1/);
  assert.match(service, /next_before_id: oldest\?\.id/);
  assert.match(desktop, /payload\.next_before_id/);
  assert.doesNotMatch(desktop, /isLoadingOlderRef\.current \|\| isRefreshingRef\.current/);
});

test("loading older messages does not put the send button into a loading state", () => {
  const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[replySending, setReplySending\]/);
  assert.match(source, /leadActionLoading \|\| replySending \|\| productCardSending/);
});

test("PWA keeps older-message loading separate from reply sending", () => {
  const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
  assert.match(source, /loadingOlder=\{olderLoading\}/);
  // The send button's disabled state may grow clauses — it later gained one for slash
  // commands — but the property this test is named for is that `olderLoading` is NOT
  // one of them: paging back through history must never freeze the composer.
  const disabledClause = source.match(/disabled=\{!clean\(composerText\)[^}]*\}/);
  assert.ok(disabledClause, "the composer send button must still have a disabled guard");
  assert.ok(disabledClause[0].includes("sending"), "send must be disabled while a send is in flight");
  assert.ok(!disabledClause[0].includes("olderLoading"), "loading older messages must not disable send");
  assert.match(source, /message_count: payload\.total \?\? conversation\.message_count/);
  assert.match(source, /markReadSignatureRef\.current = ""/);
});
