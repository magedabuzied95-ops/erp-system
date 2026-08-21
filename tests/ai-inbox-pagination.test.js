import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/aiSalesAgentService.js", "utf8");
const routes = readFileSync("server/routes/aiAgentOrders.js", "utf8");
const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const channels = readFileSync("src/modules/aiSupport/services/inboxChannels.js", "utf8");
const en = JSON.parse(readFileSync("src/locales/en/aiSupport.json", "utf8"));
const ar = JSON.parse(readFileSync("src/locales/ar/aiSupport.json", "utf8"));

const loadAiInbox = service.slice(
  service.indexOf("export const loadAiInbox = async"),
  service.indexOf("export const", service.indexOf("export const loadAiInbox = async") + 40)
);

test("the conversation list can be paged past its window", () => {
  // AI_INBOX_CHANNEL_WINDOW caps WhatsApp at 150. Without a cursor that page IS
  // the inbox and conversation 151 is unreachable except by search.
  assert.match(channels, /whatsapp: 150/, "the window this paginates past");
  assert.match(loadAiInbox, /beforeActivityAt = ""/);
  assert.match(loadAiInbox, /beforeSessionId = ""/);
  assert.match(service, /const inboxCursorClauseSql =/);
  assert.match(routes, /beforeActivityAt: String\(req\.query\?\.before_activity_at \|\| ""\)/);
  assert.match(routes, /beforeSessionId: String\(req\.query\?\.before_session_id \|\| ""\)/);
});

test("the cursor is a keyset, not an offset", () => {
  // An offset re-reads rows that shifted when a message arrived between pages,
  // which on an activity-ordered list means duplicates and skipped rows.
  assert.doesNotMatch(loadAiInbox, /OFFSET/);
  const clauseStart = service.indexOf("const inboxCursorClauseSql =");
  const clause = service.slice(clauseStart, service.indexOf("`;", clauseStart));
  assert.match(clause, /< \$\{activityIdx\}::timestamp/);
  assert.match(clause, /= \$\{activityIdx\}::timestamp AND s\.session_id < \$\{sessionIdx\}::text/);
});

test("the sort is a total order so no row can straddle a page boundary", () => {
  // Two conversations with the same activity timestamp need a deterministic
  // tiebreak, or one of them falls between pages and is never returned.
  const orderBy = loadAiInbox.slice(loadAiInbox.indexOf("ORDER BY"), loadAiInbox.indexOf("LIMIT $2"));
  assert.match(orderBy, /s\.session_id DESC/);
});

test("the cursor comes from the query rows, not the merged output", () => {
  // normalizeAndMergeInboxConversations can collapse two rows into one; paging
  // from a merged row would skip whatever sat between them.
  assert.match(loadAiInbox, /const lastRow = summaryResult\.rows\[summaryResult\.rows\.length - 1\] \|\| null/);
  assert.match(loadAiInbox, /summaryResult\.rows\.length >= requestedLimit/);
  assert.match(loadAiInbox, /has_more: Boolean\(nextCursor\?\.session_id\)/);
});

test("favourites are filtered in SQL, not over the loaded page", () => {
  assert.match(loadAiInbox, /favoriteOnly === true\) clauses\.push\("COALESCE\(s\.is_favorite, FALSE\) = TRUE"\)/);
  assert.match(routes, /favoriteOnly: \["1", "true", "yes"\]\.includes/);
  assert.match(desktop, /favorite_only: 1/);
});

test("a refresh restarts paging instead of continuing an old cursor", () => {
  // The filters that define the result set may have changed, so a cursor taken
  // against the previous set points into a list that no longer exists.
  const loadAll = desktop.slice(desktop.indexOf("const loadAll = useCallback"), desktop.indexOf("const fetchChannelPage"));
  assert.match(desktop, /setListCursors\(\{\}\);/);
  assert.ok(loadAll.length > 0);
});

test("paging is per channel and stops when a channel runs out", () => {
  const loadMore = desktop.slice(
    desktop.indexOf("const loadMoreConversations = useCallback"),
    desktop.indexOf("const sendAttachment = useCallback")
  );
  assert.ok(loadMore.length > 0, "loadMoreConversations must exist");
  assert.match(loadMore, /channelsForFilter\(channelFilter\)\.filter\(\(backendChannel\) => clean\(listCursors\?\.\[backendChannel\]\?\.session_id\)\)/);
  assert.match(loadMore, /before_activity_at: listCursors\[backendChannel\]\.activity_at/);
  // A channel whose next page fails must be dropped, not retried forever, and
  // must not stop the other channels from paging.
  assert.match(loadMore, /setListCursors\(\(current\) => \(\{ \.\.\.current, \[backendChannel\]: null \}\)\)/);
  // Merged through the same identity function as the first load, so a
  // conversation that moved between pages collapses instead of duplicating.
  assert.match(loadMore, /mergeConversationPages\(\[asArray\(current\.conversations\), \.\.\.pages\], conversationKey\)/);
});

test("the control is hidden when there is nothing more to load", () => {
  const component = desktop.slice(desktop.indexOf("function LoadMoreConversations"), desktop.indexOf("function LoadMoreConversations") + 900);
  assert.match(component, /if \(!visible\) return null;/);
  assert.equal((desktop.match(/<LoadMoreConversations/g) || []).length, 2, "both list renderers need it");
});

test("the lead filter admits it only sees the loaded window", () => {
  // Lead temperature is derived from the AI's last reply and is not a stored
  // column, so it is the one filter that cannot move into SQL. An empty result
  // must not read as "this shop has no hot leads".
  assert.match(desktop, /if \(leadFilter !== "all" && hasMoreConversations\) return t\("aiSupport\.inbox\.ui\.emptyLeadFilterWindowed"\)/);
  for (const key of ["loadMore", "loadingMore", "emptyLeadFilterWindowed", "emptyMetaConversations"]) {
    assert.ok(en.inbox.ui[key], `en is missing aiSupport.inbox.ui.${key}`);
    assert.ok(ar.inbox.ui[key], `ar is missing aiSupport.inbox.ui.${key}`);
  }
});
