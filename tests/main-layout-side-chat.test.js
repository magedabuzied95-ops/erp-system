import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  channelDisplayName,
  conversationChannel,
  conversationDisplayName,
  conversationPreviewText,
  conversationUnreadCount,
} from "../src/shared/sideChat/conversationSummary.js";

const layout = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");
const css = readFileSync("src/shared/layouts/MainLayout.m1.css", "utf8");
const panel = readFileSync("src/shared/sideChat/SideChatPanel.jsx", "utf8");
const bell = readFileSync("src/shared/sideChat/MessageNotificationsBell.jsx", "utf8");
const thread = readFileSync("src/modules/aiSupport/components/QuickConversationThread.jsx", "utf8");
const dock = readFileSync("src/modules/aiSupport/components/MiniChatDock.jsx", "utf8");
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));

test("the shell docks the open conversation as a third grid column and narrows the page", () => {
  assert.match(layout, /sideChatOpen \? "m1-shell-root--side-chat" : ""/);
  assert.match(layout, /sideChat\.size === "expanded" \? "m1-shell-root--side-chat-expanded"/);
  assert.match(layout, /<SideChatPanel \/>/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--side-chat\{grid-template-columns:260px minmax\(0,1fr\) var\(--side-chat-width\)!important\}/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--side-chat\.m1-shell-root--sidebar-autohide\{grid-template-columns:64px minmax\(0,1fr\) var\(--side-chat-width\)!important\}/);
  assert.match(css, /\.m1-shell-root--side-chat-expanded\{--side-chat-width:min\(58vw,880px\)\}/);
});

test("the panel can widen, shrink back, open the inbox and close", () => {
  assert.match(panel, /onClick=\{toggleSideChatSize\}/);
  assert.match(panel, /expanded \? <Minimize2 .*\/> : <Maximize2 .*\/>/);
  assert.match(panel, /onClick=\{closeSideChat\}/);
  assert.match(panel, /navigate\(`\/admin\/ai-inbox\?conversation=\$\{encodeURIComponent/);
  assert.match(panel, /markReadOnOpen/);
  // Phones: the panel covers the screen instead of squeezing the page.
  assert.match(panel, /fixed inset-0 z-\[60\] .*lg:static/);
});

test("the message bell sits in the topbar for inbox users and opens the side chat", () => {
  assert.match(layout, /canSeeInbox \? <MessageNotificationsBell \/> : null/);
  assert.match(layout, /paletteItems\.some\(\(item\) => item\.to === "\/admin\/ai-inbox"\)/);
  assert.match(bell, /api\.get\("\/ai-inbox\/view-counts"/);
  assert.match(bell, /view: "unread", read_filter: "unread"/);
  assert.match(bell, /openSideChat\(row\)/);
  assert.match(bell, /subscribeRealtime\("ai_inbox:message", onMessage\)/);
  assert.match(bell, /count > 99 \? "99\+" : count/);
});

test("the shell rings for a customer message only off the inbox page, which rings for itself", () => {
  assert.match(bell, /if \(!onInboxPage\) \{\s*handleInboundInboxMessage\(/);
  assert.match(bell, /isInboundCustomerMessage\(incoming\)/);
});

test("the mini chat and the side chat share one thread", () => {
  assert.match(dock, /import QuickConversationThread from ".\/QuickConversationThread.jsx"/);
  assert.match(panel, /import QuickConversationThread from ".*QuickConversationThread.jsx"/);
  assert.match(thread, /aiInboxConversationEndpoint\(sessionId, "\/send"\)/);
  assert.match(thread, /aiInboxConversationEndpoint\(sessionId, "\/ai-enabled"\)/);
  assert.match(thread, /subscribeRealtime\("ai_inbox:message"/);
  assert.doesNotMatch(dock, /api\.(get|post|patch)\(/);
});

test("both languages carry the side chat and message bell strings", () => {
  for (const locale of [ar, en]) {
    assert.ok(locale.inbox.sideChat.expand);
    assert.ok(locale.inbox.sideChat.shrink);
    assert.ok(locale.inbox.sideChat.close);
    assert.ok(locale.inbox.messageBell.title);
    assert.match(locale.inbox.messageBell.waiting, /\{\{count\}\}/);
    assert.ok(locale.inbox.messageBell.empty);
    assert.ok(locale.inbox.messageBell.openInbox);
  }
});

test("conversation summary readers agree with a list row of /ai-inbox/conversations", () => {
  const row = {
    session_id: "whatsapp:201001234567",
    channel: "whatsapp",
    customer_name: "Sara",
    last_message: "x".repeat(200),
    unread_count: "3",
  };
  assert.equal(conversationChannel(row), "whatsapp");
  assert.equal(channelDisplayName(row), "WhatsApp");
  assert.equal(conversationDisplayName(row), "Sara");
  assert.equal(conversationPreviewText(row).length, 140);
  assert.equal(conversationUnreadCount(row), 3);
  // A manually unread row with no count still shows as waiting.
  assert.equal(conversationUnreadCount({ manually_unread: true }), 1);
  assert.equal(conversationUnreadCount({ unread_count: 0 }), 0);
  // The channel is read off the session id when the row says nothing.
  assert.equal(conversationChannel({ session_id: "instagram:123" }), "instagram");
  // No usable name: the id without its channel prefix, never "undefined".
  assert.equal(conversationDisplayName({ session_id: "messenger:987654" }), "987654");
});
