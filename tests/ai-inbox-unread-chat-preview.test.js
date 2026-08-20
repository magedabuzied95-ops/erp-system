import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agentSource = fs.readFileSync(new URL("../server/services/aiSalesAgentService.js", import.meta.url), "utf8");
const gatewaySource = fs.readFileSync(new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8");
const inboxSource = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");

test("the Evolution chat recovery records who wrote the last message", () => {
  // The recovery creates the conversation from the chat list without importing any
  // message rows, so this flag is the only direction the inbox has for those threads.
  assert.match(gatewaySource, /last_message_from_me: fromMe/);
  assert.match(gatewaySource, /'last_message_from_me', r\.last_message_from_me/);
  assert.match(gatewaySource, /last_message text, last_message_from_me boolean, last_message_at text/);
});

test("both inbox queries expose unread for a conversation with no imported messages", () => {
  const selections = agentSource.match(/\$\{unreadFromChatPreviewSql\("[^"]+"\)\}/g) || [];
  assert.equal(selections.length, 2, "summary and full inbox queries must both select it");
  assert.ok(selections.includes('${unreadFromChatPreviewSql("m.latest_message_created_at")}'));
  assert.ok(selections.includes('${unreadFromChatPreviewSql("m.created_at")}'));
});

test("the chat-preview rule never flips a thread on a missing or stale direction flag", () => {
  // Absent flag => the message path decides. A staff row as the newest imported message
  // means a human already replied, so a lagging chat preview must not undo that.
  assert.match(agentSource, /COALESCE\(c\.metadata->>'last_message_from_me', ''\) = 'false'/);
  assert.match(agentSource, /LOWER\(COALESCE\(m\.sender_type, ''\)\) <> 'staff'/);
  assert.match(agentSource, /c\.last_message_at > GREATEST\(\s*COALESCE\(c\.read_at, TIMESTAMP 'epoch'\),\s*COALESCE\(s\.read_at, TIMESTAMP 'epoch'\)\s*\)/);
});

test("both inbox mappers count a chat-preview-unread conversation as unread", () => {
  const folded = agentSource.match(/const unreadCount = computedUnreadCount > 0 \? computedUnreadCount : \(manuallyUnread \|\| unreadFromChatPreview \? 1 : 0\);/g) || [];
  assert.equal(folded.length, 2, "summary and full mappers must both fold the flag in");
  assert.equal((agentSource.match(/conversation\.unread_from_chat_preview === true/g) || []).length, 2);
});

test("the empty conversation list names the filter that emptied it", () => {
  assert.match(inboxSource, /if \(readFilter === "unread"\) return t\("aiSupport\.inbox\.ui\.emptyUnread"\);/);
  assert.match(inboxSource, /<EmptyBlock text=\{emptyConversationsText\} \/>/);
  // The old copy claimed no real messages had arrived, whatever the active filter was.
  assert.doesNotMatch(inboxSource, /leadFilter === "all" && filter === "all" \? "لا توجد رسائل Meta/);
});

test("the unread empty state is translated in both bundles", () => {
  for (const locale of ["ar", "en"]) {
    const bundle = JSON.parse(fs.readFileSync(new URL(`../src/locales/${locale}/aiSupport.json`, import.meta.url), "utf8"));
    for (const key of ["emptyUnread", "emptyRead", "emptyFavorites", "emptyFiltered", "emptyNoConversations"]) {
      assert.equal(typeof bundle.inbox.ui[key], "string", `${locale}: inbox.ui.${key}`);
      assert.ok(bundle.inbox.ui[key].length > 0, `${locale}: inbox.ui.${key} is empty`);
    }
  }
});
