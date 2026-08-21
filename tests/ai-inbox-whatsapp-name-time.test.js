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

test("AI Inbox unread counts the messages a customer sent after the last answer of any kind", () => {
  // Unread means "this customer is waiting", so an AI auto-reply ends the wait exactly
  // like a human one. Counting from the last *human* reply is what made the filter read
  // zero: with the AI answering, "no human replied yet" is true nearly everywhere.
  const source = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
  assert.match(source, /unread_msg\.sender_type = 'customer'/);
  assert.match(source, /LOWER\(COALESCE\(answer_msg\.sender_type, ''\)\) <> 'customer'/);
  assert.doesNotMatch(source, /staff_msg\.manual_message = TRUE OR COALESCE\(staff_msg\.staff_user_id, 0\) > 0/);
  assert.doesNotMatch(source, /requiresAttention && \(!readAt \|\| lastActivityAt > readAt\)/);
});

test("desktop AI Inbox does not clear a waiting conversation just because it was opened", () => {
  // Reading a message does not answer it. Auto-clearing on open drained the queue as the
  // operator browsed it; the thread leaves when someone replies or dismisses it.
  const source = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /perfComponent: "AiInbox\.markRead"/);
  assert.doesNotMatch(source, /markReadSignatureRef/);
  // The explicit toggle and the inbound bump both stay.
  assert.match(source, /perfComponent: "AiInbox\.markReadManual"/);
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
  // The composer's loading expression may grow clauses — it later gained one for
  // an in-flight attachment upload. What it must never contain is the
  // older-message loader, which would grey the send button out while history
  // pages in behind the operator.
  const loadingProps = source.match(/loading=\{Boolean\([^}]*\)\}/g) || [];
  assert.ok(loadingProps.length >= 2, "expected the composer loading props");
  for (const prop of loadingProps) {
    assert.match(prop, /leadActionLoading/);
    assert.match(prop, /replySending/);
    assert.match(prop, /productCardSending/);
    assert.doesNotMatch(prop, /olderLoading|isLoadingOlder/);
  }
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
