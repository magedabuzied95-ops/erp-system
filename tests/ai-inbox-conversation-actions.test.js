// Genie's conversation ⋮ (row + header), the mini chat, Send Template, Export
// Chat, and the shell's quick search (Ctrl K) with the last two pages.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { foldSearchText, matchSidebarPath } from "../src/shared/navigation/recentPages.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/modules/aiSupport/pages/AiInbox.jsx");
const route = read("server/routes/aiAgentOrders.js");
const menu = read("src/modules/aiSupport/components/ConversationActionsMenu.jsx");

test("the row's icons became a ⋮ that takes the time's place on hover", () => {
  assert.equal(page.split("rowActions={rowActions}").length - 1, 2, "both card kinds");
  assert.equal(page.split(`variant="row"`).length - 1, 2);
  assert.match(page, /group-hover:opacity-0 group-focus-within:opacity-0/);
  // The old icon strip is gone from both cards.
  assert.doesNotMatch(page, /\{onToggleRead \? \(\s*<button/);
});

test("the menu carries Genie's items and only those the viewer may use", () => {
  for (const key of ["openMiniChat", "markDone", "reopen", "archive", "unarchive", "sendTemplate", "exportChat", "deleteChat"]) {
    assert.ok(menu.includes(`aiSupport.inbox.actionsMenu.${key}`), key);
  }
  // Every entry is conditional on its handler.
  assert.match(menu, /onToggleDone \? \{ key: "done"/);
  assert.match(menu, /onDelete \? \{ key: "delete"/);
  assert.match(page, /onToggleDone: canReply \? toggleConversationDone : undefined,/);
  assert.equal(page.split("headerActions={reviewerMode ? null : {").length - 1, 2, "both headers");
});

test("done, archive, export and templates reach the server", () => {
  assert.match(page, /aiAgentInboxEndpoint\(sessionId, "\/reopen"\)/);
  assert.match(page, /aiAgentInboxEndpoint\(sessionId, "\/close"\)/);
  assert.match(page, /aiInboxConversationEndpoint\(sessionId, archived \? "\/unarchive" : "\/archive"\)/);
  assert.match(page, /aiInboxConversationEndpoint\(sessionId, "\/export"\)/);
  assert.match(route, /router\.get\("\/conversations\/:conversationId\/export", protect, inboxView\(\)/);
  assert.match(route, /router\.get\("\/conversations\/:conversationId\/templates", protect, inboxView\(\)/);
  assert.match(route, /router\.post\("\/conversations\/:conversationId\/send-template", protect, inboxReply\(\)/);
  // Export and templates honour conversation privacy like any read.
  const exportRoute = route.slice(route.indexOf(`router.get("/conversations/:conversationId/export"`), route.indexOf(`router.delete("/conversations/:conversationId"`));
  assert.match(exportRoute, /sessionKeys: \[conversationId\], hiddenKeys/);
  assert.match(exportRoute, /COALESCE\(message_type, ''\) NOT IN \('internal_note', 'reaction'\)/);
  // A sent template is written into the thread.
  assert.match(route, /messageType: "template",\s*suggestedActions: transcript\.actions,\s*visualAttachments: transcript\.attachments,\s*staffUserId/);
});

test("the mini chat reads and sends through the inbox's own routes", () => {
  // The thread itself lives in QuickConversationThread, shared with the side chat.
  const mini = read("src/modules/aiSupport/components/MiniChatDock.jsx");
  const thread = read("src/modules/aiSupport/components/QuickConversationThread.jsx");
  assert.match(mini, /<QuickConversationThread/);
  assert.match(thread, /aiInboxConversationEndpoint\(sessionId, "\/messages"\)/);
  assert.match(thread, /aiInboxConversationEndpoint\(sessionId, "\/send"\)/);
  assert.match(thread, /aiInboxConversationEndpoint\(sessionId, "\/ai-enabled"\)/);
  assert.match(page, /\[\.\.\.rest, \{ key, item, minimized: false \}\]\.slice\(-3\)/);
  assert.match(page, /<MiniChatDock/);
});

test("quick search: the sidebar's pages, Arabic-folded, and visits recorded per user", () => {
  assert.equal(foldSearchText("الإعدادات"), foldSearchText("الاعدادات"));
  assert.equal(foldSearchText("فاتورة"), foldSearchText("فاتوره"));
  assert.equal(matchSidebarPath("/orders/123", ["/orders", "/order", "/"]), "/orders");
  assert.equal(matchSidebarPath("/ordersx", ["/orders"]), "");
  const shell = read("src/shared/layouts/MainLayout.jsx");
  assert.match(shell, /<CommandPalette items=\{paletteItems\} userId=\{paletteUserId\} currentPath=\{currentSidebarPath\} \/>/);
  assert.match(shell, /if \(currentSidebarPath\) recordPageVisit\(paletteUserId, currentSidebarPath\);/);
  assert.match(shell, /<CommandPaletteTrigger items=\{paletteItems\}/);
  assert.match(read("src/modules/aiSupport/components/InboxTopBar.jsx"), /<ShellCommandPaletteTrigger/);
  const palette = read("src/shared/components/CommandPalette.jsx");
  assert.match(palette, /\(event\.ctrlKey \|\| event\.metaKey\) && !event\.altKey && String\(event\.key\)\.toLowerCase\(\) === "k"/);
});

test("every new string exists in both locales", () => {
  for (const locale of ["ar", "en"]) {
    const inbox = JSON.parse(read(`src/locales/${locale}/aiSupport.json`)).inbox;
    for (const key of ["openMiniChat", "markDone", "archive", "sendTemplate", "exportChat", "deleteChat", "archived", "failed"]) assert.ok(inbox.actionsMenu?.[key], `${locale} actionsMenu.${key}`);
    for (const key of ["title", "send", "empty", "whatsappOnly", "sent"]) assert.ok(inbox.templateSend?.[key], `${locale} templateSend.${key}`);
    for (const key of ["minimize", "close", "openFull", "send"]) assert.ok(inbox.miniChat?.[key], `${locale} miniChat.${key}`);
    const common = JSON.parse(read(`src/locales/${locale}/common.json`)).common;
    for (const key of ["open", "placeholder", "placeholderShort", "jumpBack", "likelyNext", "recent", "newTab"]) assert.ok(common.commandPalette?.[key], `${locale} commandPalette.${key}`);
  }
});
