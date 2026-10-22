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
const store = readFileSync("src/shared/sideChat/sideChatStore.js", "utf8");
const list = readFileSync("src/shared/sideChat/ConversationSummaryList.jsx", "utf8");
const hook = readFileSync("src/shared/sideChat/useInboxConversations.js", "utf8");
const thread = readFileSync("src/modules/aiSupport/components/QuickConversationThread.jsx", "utf8");
const dock = readFileSync("src/modules/aiSupport/components/MiniChatDock.jsx", "utf8");
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));

test("the shell docks the panel as a third grid column and narrows the page", () => {
  assert.match(layout, /const sideChatOpen = Boolean\(sideChat\.open\)/);
  // The panel is fixed (the overflow-x:hidden shell root kills sticky, and a
  // sticky panel scrolled away with the page); the slot reserves its column.
  assert.match(layout, /sideChatOpen \? <div className="m1-side-chat-slot hidden lg:block" aria-hidden="true" \/> : null/);
  assert.match(css, /\.m1-side-chat-slot\{width:var\(--side-chat-width\)/);
  assert.match(css, /@media\(max-width:1023px\)\{\.m1-side-chat\{position:fixed;inset:0;z-index:60/);
  assert.match(layout, /sideChatOpen \? "m1-shell-root--side-chat" : ""/);
  assert.match(layout, /<SideChatPanel \/>/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--side-chat\{grid-template-columns:260px minmax\(0,1fr\) var\(--side-chat-width\)!important\}/);
  assert.match(css, /\.m1-shell-root\.m1-shell-root--side-chat\.m1-shell-root--sidebar-autohide\{grid-template-columns:64px minmax\(0,1fr\) var\(--side-chat-width\)!important\}/);
});

test("the header toggle folds the panel to a rail (Genie), it never widens", () => {
  assert.match(layout, /sideChat\.collapsed \? "m1-shell-root--side-chat-collapsed"/);
  assert.match(css, /\.m1-shell-root--side-chat-collapsed\{--side-chat-width:56px\}/);
  assert.match(panel, /data-side-chat-state=\{collapsed \? "collapsed" : conversation \? "thread" : "list"\}/);
  assert.match(panel, /onClick=\{toggleSideChatCollapsed\}/);
  assert.doesNotMatch(panel, /expanded|Maximize2|Minimize2/);
  assert.doesNotMatch(css, /side-chat-expanded/);
  // One aside for every look, so the width tweens instead of remounting.
  assert.equal((panel.match(/<aside\s/g) || []).length, 1);
  assert.match(panel, /\{collapsed \? rail : conversation \? \(/);
  assert.match(css, /\.m1-side-chat\{position:fixed;top:0;bottom:0;inset-inline-end:0;[^}]*transition:width var\(--side-chat-ease\)/);
});

test("the panel holds the conversation list, and a thread goes back to it", () => {
  assert.match(store, /export const openSideChatList = /);
  assert.match(store, /export const backToSideChatList = /);
  assert.match(panel, /onClick=\{backToSideChatList\}/);
  assert.match(panel, /<PanelList activeKey="" \/>/);
  assert.match(panel, /useInboxConversations\(\{ view, limit: 40, search: debounced \}\)/);
  assert.match(panel, /markReadOnOpen/);
  assert.match(panel, /navigate\(`\/admin\/ai-inbox\$\{conversation \? `\?conversation=\$\{encodeURIComponent/);
});

test("the bell dropdown has Recent and Unread tabs and opens the side chat", () => {
  assert.match(layout, /canSeeInbox \? <MessageNotificationsBell \/> : null/);
  assert.match(layout, /paletteItems\.some\(\(item\) => item\.to === "\/admin\/ai-inbox"\)/);
  assert.match(bell, /api\.get\("\/ai-inbox\/view-counts"/);
  assert.match(bell, /const view = tab === "unread" \? "unread" : "all"/);
  assert.match(bell, /data-bell-tab=\{item\.key\}/);
  assert.match(bell, /openSideChat\(row\)/);
  assert.match(bell, /onClick=\{openPanel\}/);
  assert.match(bell, /subscribeRealtime\("ai_inbox:message", onMessage\)/);
  assert.match(bell, /counts\.unread > 99 \? "99\+" : counts\.unread/);
});

test("dropdown and panel read the same list through one hook and one row component", () => {
  assert.match(hook, /api\.get\("\/ai-inbox\/conversations"/);
  assert.match(hook, /\.\.\.\(view === "unread" \? \{ read_filter: "unread" \} : \{\}\)/);
  assert.match(hook, /subscribeRealtime\("ai_inbox:message", schedule\)/);
  assert.match(bell, /<ConversationSummaryList/);
  assert.match(panel, /<ConversationSummaryList/);
  assert.match(list, /data-conversation-key=\{key\}/);
  assert.doesNotMatch(bell, /api\.get\("\/ai-inbox\/conversations"/);
});

test("the shell rings for a customer message only off the inbox page, which rings for itself", () => {
  assert.match(bell, /isInboundCustomerMessage\(incoming\) && !onInboxPage/);
  assert.match(bell, /handleInboundInboxMessage\(/);
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
    for (const key of ["open", "collapse", "close", "back", "searchPlaceholder", "noConversations"]) assert.ok(locale.inbox.sideChat[key], key);
    assert.ok(locale.inbox.messageBell.title);
    assert.ok(locale.inbox.messageBell.tabs.recent);
    assert.ok(locale.inbox.messageBell.tabs.unread);
    assert.ok(locale.inbox.messageBell.empty);
    assert.ok(locale.inbox.messageBell.openInbox);
    assert.equal(locale.inbox.sideChat.expand, undefined);
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
  assert.equal(conversationUnreadCount({ manually_unread: true }), 1);
  assert.equal(conversationUnreadCount({ unread_count: 0 }), 0);
  assert.equal(conversationChannel({ session_id: "instagram:123" }), "instagram");
  assert.equal(conversationDisplayName({ session_id: "messenger:987654" }), "987654");
});

test("the divider between the page and the panel drags to resize it (Genie)", () => {
  assert.match(store, /export const setSideChatWidth = \(width, \{ commit = true \} = \{\}\)/);
  assert.match(store, /SIDE_CHAT_MIN_WIDTH = 320/);
  assert.match(store, /localStorage\.setItem\(WIDTH_STORAGE_KEY/);
  assert.match(panel, /data-side-chat-resize="true"/);
  assert.match(panel, /onDoubleClick=\{resetSideChatWidth\}/);
  // RTL: the page-side edge is the right one, so the width is the pointer's x.
  assert.match(panel, /rtl \? clientX : window\.innerWidth - clientX/);
  assert.match(layout, /"--side-chat-width": `\$\{sideChat\.width\}px`/);
  assert.match(layout, /sideChat\.resizing \? "m1-shell-root--side-chat-resizing"/);
  assert.match(css, /\.m1-side-chat-resize\{position:absolute;top:0;bottom:0;inset-inline-start:0;width:8px;cursor:col-resize/);
  assert.match(css, /\.m1-shell-root--side-chat-resizing \.m1-side-chat-slot\{transition:none!important\}/);
  for (const locale of [ar, en]) assert.ok(locale.inbox.sideChat.resize);
});

test("with the side chat open the page and the chat are two rounded cards on a dark gap (Genie)", () => {
  assert.match(css, /\.m1-shell-root\.m1-shell-root--side-chat\{--side-chat-gap:6px;--side-chat-radius:20px;background:var\(--topbar\)\}/);
  assert.match(css, /\.m1-shell-root--side-chat>main\{background:var\(--bg\);border-start-end-radius:var\(--side-chat-radius\);border-end-end-radius:var\(--side-chat-radius\)\}/);
  assert.match(css, /\.m1-shell-root--side-chat \.m1-side-chat\{top:var\(--side-chat-gap\);bottom:var\(--side-chat-gap\);inset-inline-end:var\(--side-chat-gap\);height:auto;width:calc\(var\(--side-chat-width\) - var\(--side-chat-gap\) \* 2\);border:0!important;border-radius:var\(--side-chat-radius\)/);
});
