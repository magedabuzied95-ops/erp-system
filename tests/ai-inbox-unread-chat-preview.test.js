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

test("recovered outbound messages never claim a human reviewed the thread", () => {
  // Recovery cannot tell a phone-typed reply from one of our own automated sends, and
  // manual_message = TRUE is what the unread rule reads as "a human already replied".
  const insert = gatewaySource.slice(gatewaySource.indexOf("INSERT INTO ai_support_messages"));
  assert.match(insert.slice(0, 1400), /CASE WHEN r\.from_me THEN 'staff' ELSE 'customer' END,[\s\S]{0,600}?\n\s*FALSE,/);
  assert.doesNotMatch(insert.slice(0, 1400), /END,\s*\n\s*r\.from_me,/);
});

test("both inbox queries expose unread for a conversation with no imported messages", () => {
  const selections = agentSource.match(/\$\{unreadFromChatPreviewSql\("[^"]+"\)\}/g) || [];
  assert.equal(selections.length, 2, "summary and full inbox queries must both select it");
  assert.ok(selections.includes('${unreadFromChatPreviewSql("m.latest_message_created_at")}'));
  assert.ok(selections.includes('${unreadFromChatPreviewSql("m.created_at")}'));
});

test("the chat-preview rule never flips a thread on a missing flag or a millisecond of skew", () => {
  // Absent flag => the message path decides. And a send that updated the conversation and
  // wrote its message row in the same breath must not read as a newer customer message.
  assert.match(agentSource, /COALESCE\(c\.metadata->>'last_message_from_me', ''\) = 'false'/);
  assert.match(agentSource, /c\.last_message_at > \$\{latestMessageCreatedAt\} \+ INTERVAL '2 minutes'/);
  assert.match(agentSource, /c\.last_message_at > GREATEST\(\s*COALESCE\(c\.read_at, TIMESTAMP 'epoch'\),\s*COALESCE\(s\.read_at, TIMESTAMP 'epoch'\)\s*\)/);
});

test("both inbox mappers count a chat-preview-unread conversation as unread", () => {
  const folded = agentSource.match(/const unreadCount = computedUnreadCount > 0 \? computedUnreadCount : \(manuallyUnread \|\| unreadFromChatPreview \? 1 : 0\);/g) || [];
  assert.equal(folded.length, 2, "summary and full mappers must both fold the flag in");
  assert.equal((agentSource.match(/conversation\.unread_from_chat_preview === true/g) || []).length, 2);
});

test("the read filter runs in SQL, over every conversation and not over the fetched page", () => {
  // The list is capped per channel (150 on WhatsApp against ~700 threads), so filtering
  // read state on the client made "unread" mean "unread among the newest 150".
  const routeSource = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  assert.match(routeSource, /readFilter: String\(req\.query\?\.read_filter \|\| ""\)/);
  assert.match(inboxSource, /read_filter: readFilter,/);
  assert.match(agentSource, /readFilterClauseSql\(readFilter, "m\.latest_message_created_at"\)/);
  assert.match(agentSource, /readFilterClauseSql\(readFilter, "m\.created_at"\)/);
  // A refetch has to follow the chip, or the filter would apply to a stale page.
  assert.match(inboxSource, /\}, \[channelFilter, debouncedSearch, filter, headers, readFilter, reviewerMode, tenantId\]\);/);
});

test("the default list view keeps its exact WHERE clause", () => {
  // An empty read filter must contribute nothing: the unfiltered path is the hot one and
  // the unread predicate is a per-row correlated subquery.
  const helpers = agentSource.slice(
    agentSource.indexOf("const unreadCustomerMessageCountSql ="),
    agentSource.indexOf("export const loadAiInbox = async")
  );
  const build = new Function("lower", `let out={};${helpers}out.clause=readFilterClauseSql;return out;`);
  const { clause } = build((value) => String(value || "").toLowerCase());
  assert.equal(clause("all", "m.created_at"), "");
  assert.equal(clause("", "m.created_at"), "");
  assert.ok(clause("unread", "m.created_at").startsWith("COALESCE(("));
  assert.ok(clause("read", "m.created_at").startsWith("NOT COALESCE(("));
  assert.match(agentSource, /\[\.\.\.clauses, readFilterClauseSql\([^)]+\)\]\.filter\(Boolean\)\.join\(" AND "\)/);
});

test("a read-filtered page is never written to or served from the channel cache", () => {
  // The cache entry means "the newest N of this channel"; a filtered slice stored under
  // that key would render as the whole channel on the next warm open.
  assert.match(inboxSource, /const listCacheEnabled = !reviewerMode && readFilter === "all";/);
  assert.match(inboxSource, /if \(listCacheEnabled\) inboxCache\.saveList\(channelPages\[index\], backendChannel\);/);
});

test("switching the read filter shows a spinner, not a blank panel", () => {
  // The filter refetches and the conversations already in state do not match it, so a
  // spinner gated on `conversations.length` never appears: no rows, no spinner, no empty
  // state for the whole round trip.
  assert.match(inboxSource, /\{loading && !filteredConversations\.length \? <LoadingBlock/);
  assert.match(inboxSource, /\) : !loading \? <EmptyBlock text=\{emptyConversationsText\} \/> : null\}/);
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
