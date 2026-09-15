import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Some sources are CRLF; the slices below look for "\n};\n".
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");
const agent = read("server/services/aiSalesAgentService.js");
const logService = read("server/services/aiSupportLogService.js");
const routes = read("server/routes/aiAgentOrders.js");
const cache = read("src/modules/aiSupport/services/inboxCache/inboxCache.js");
const en = JSON.parse(read("src/locales/en/aiSupport.json"));
const ar = JSON.parse(read("src/locales/ar/aiSupport.json"));

const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

test("the column is added by an ensure that runs at boot", () => {
  // ensureAiSalesAgentSchema is awaited from bootstrapStartup, so the column reaches
  // production; nullable with no default keeps the DDL metadata-only.
  assert.match(agent, /ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`/);
  assert.match(read("server/server.js"), /await ensureAiSalesAgentSchema\(db\)/);
});

test("delete is a soft delete that also clears the unread state", () => {
  const fn = between(logService, "export const deleteAiSupportConversation", "\n};\n");
  assert.match(fn, /SET deleted_at = NOW\(\)/);
  assert.match(fn, /manually_unread = FALSE/);
  // The provider syncs rebuild sessions and re-import history: removing rows would
  // bring the thread straight back, so nothing is destroyed.
  assert.doesNotMatch(fn, /DELETE FROM/);
  assert.match(routes, /router\.delete\("\/conversations\/:conversationId", protect, inboxReply\(\)/);
});

test("both inbox queries hide a deleted thread until a newer message arrives", () => {
  assert.match(agent, /\(s\.deleted_at IS NULL OR COALESCE\(\$\{latestMessageAtSql\}, c\.last_message_at\) > s\.deleted_at\)/);
  assert.match(agent, /deletedConversationClauseSql\("m\.latest_message_created_at"\)/);
  assert.match(agent, /deletedConversationClauseSql\("m\.created_at"\)/);
  // A targeted lookup (send/reply resolving an id) must still find it.
  assert.match(agent, /const deletedConversationClauseSql = \(latestMessageAtSql\) => \(sessionKeyList\.length\s*\? ""/);
});

test("the transcript starts after the delete", () => {
  const fn = between(agent, "export const loadAiInboxMessages", "// Retroactive source-comment preview");
  assert.equal((fn.match(/created_at > \$(?:\d+|\$\{params\.length\})::timestamptz/g) || []).length, 2, "page and total both cut at deleted_at");
});

test("both surfaces confirm first, then drop the row and its cached thread", () => {
  for (const [name, source] of [["desktop", desktop], ["pwa", pwa]]) {
    const fn = between(source, "const deleteConversation = useCallback", "}, [");
    assert.ok(fn.indexOf("window.confirm(") > 0, `${name} asks first`);
    assert.ok(fn.indexOf("window.confirm(") < fn.indexOf("api.delete("), `${name} confirms before the request`);
    assert.match(fn, /inboxCache\.forgetThread\(/);
    assert.match(source, /onDelete=\{canReply \? deleteConversation : undefined\}/);
  }
  assert.match(cache, /export const forgetThread = /);
});

test("every delete string exists in both locales", () => {
  for (const key of ["deleteConversation", "deleteConversationConfirm", "deleteConversationDone", "deleteConversationFailed"]) {
    for (const [lang, dict] of [["en", en], ["ar", ar]]) {
      const value = dict?.aiSupport?.inbox?.ui?.[key] ?? dict?.inbox?.ui?.[key];
      assert.ok(typeof value === "string" && value.trim(), `${lang} ${key}`);
    }
  }
  assert.match(ar.aiSupport?.inbox?.ui?.deleteConversationConfirm ?? ar.inbox.ui.deleteConversationConfirm, /\{\{name\}\}/);
});
