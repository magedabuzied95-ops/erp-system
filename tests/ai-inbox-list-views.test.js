// Genie's view chips over the desktop list — all / awaiting / unread / unsent /
// done / archived — filtered in SQL and counted by /view-counts under the same
// filters; list actions moved into a ⋮ menu; the bell moved to the top bar.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { INBOX_VIEWS, inboxViewClauseSql } from "../server/services/aiSalesAgentService.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/modules/aiSupport/pages/AiInbox.jsx");
const service = read("server/services/aiSalesAgentService.js");
const route = read("server/routes/aiAgentOrders.js");

test("six views, each a SQL clause", () => {
  assert.deepEqual([...INBOX_VIEWS], ["all", "awaiting", "unread", "unsent", "done", "archived"]);
  assert.equal(inboxViewClauseSql("all", "lm"), "COALESCE(s.status, '') <> 'closed'");
  assert.match(inboxViewClauseSql("awaiting", "lm"), /LOWER\(COALESCE\(m\.sender_type, ''\)\) = 'customer'/);
  assert.match(inboxViewClauseSql("unread", "lm"), /COALESCE\(c\.manually_unread, s\.manually_unread, FALSE\) = TRUE/);
  assert.match(inboxViewClauseSql("unsent", "lm"), /m\.delivery_status, ''\)\) IN \('failed', 'error', 'undelivered'\)/);
  assert.equal(inboxViewClauseSql("done", "lm"), "s.status = 'closed'");
  assert.equal(inboxViewClauseSql("archived", "lm"), "(s.deleted_at IS NOT NULL AND COALESCE(lm, c.last_message_at, s.deleted_at) <= s.deleted_at)");
  // No view = no clause: the PWA does not send one and keeps its list.
  assert.equal(inboxViewClauseSql("", "lm"), "");
});

test("the archived view lifts the hidden-row rule; every other view keeps it", () => {
  assert.ok(service.includes(`const deletedConversationClauseSql = (latestMessageAtSql) => (sessionKeyList.length || lower(view) === "archived"`));
  assert.ok(service.includes(`const viewClause = inboxViewClauseSql(view, "m.latest_message_created_at");`));
  assert.ok(service.includes(`COUNT(*) FILTER (WHERE \${view === "archived" ? "" : \`\${liveSql} AND \`}\${inboxViewClauseSql(view, latestAtSql)})::int AS "\${view}"`));
});

test("the routes pass the view and count every view under the same filters", () => {
  assert.ok(route.includes(`view: String(req.query?.view || ""),`));
  assert.match(route, /router\.get\("\/view-counts", protect, inboxView\(\)/);
  const counts = route.slice(route.indexOf(`router.get("/view-counts"`), route.indexOf(`router.get("/conversations", protect`));
  for (const field of ["countsOnly: true", "accountKeys:", "labelIds:", "stages:", "memberIds:", "activity:", "favoriteOnly:", "assignedUserId:", "search:", "hiddenKeys"]) {
    assert.ok(counts.includes(field), field);
  }
});

test("the desktop list sends the view, counts it, and keeps filtered views out of the cache", () => {
  assert.equal(page.split("view: listView,").length - 1, 2, "first page and next pages");
  assert.ok(page.includes(`favoriteFilter === "all" && !panelActive && listView === "all";`));
  assert.ok(page.includes(`api.get("/ai-inbox/view-counts", {`));
  assert.ok(page.includes(`data-inbox-views="chips"`));
  assert.ok(page.includes("{INBOX_LIST_VIEWS.map((view) => {"));
});

test("the header is gone; Sync Meta and mark-all-read live in the ⋮ menu; the bell is in the top bar", () => {
  assert.doesNotMatch(page, /\{t\("aiSupport\.inbox\.rail\.conversations"\)\}<\/div>\s*<\/div>\s*<div className="flex shrink-0 items-center gap-2">/);
  assert.ok(page.includes(`data-inbox-list-menu="toggle"`));
  const menu = page.slice(page.indexOf(`data-inbox-list-menu="toggle"`), page.indexOf(`data-inbox-views="chips"`));
  assert.ok(menu.includes("syncMetaConversations()"));
  assert.ok(menu.includes("markAllConversationsRead()"));
  assert.ok(page.includes("notificationSlot={reviewerMode ? null : ("));
  const bar = read("src/modules/aiSupport/components/InboxTopBar.jsx");
  assert.ok(bar.includes(`{notificationSlot && rtl ? <div className="ai-inbox-topbar__bell">{notificationSlot}</div> : null}`));
  assert.ok(bar.includes(`{notificationSlot && !rtl ? <div className="ai-inbox-topbar__bell">{notificationSlot}</div> : null}`));
});

test("every chip and menu string exists in both locales", () => {
  for (const locale of ["ar", "en"]) {
    const inbox = JSON.parse(read(`src/locales/${locale}/aiSupport.json`)).inbox;
    for (const view of INBOX_VIEWS) assert.ok(inbox.views?.[view], `${locale} views.${view}`);
    for (const key of ["title", "refresh", "syncMeta"]) assert.ok(inbox.listMenu?.[key], `${locale} listMenu.${key}`);
  }
});
