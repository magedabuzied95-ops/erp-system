import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const routes = read("server/routes/aiAgentOrders.js");
const service = read("server/services/aiInboxQuickRepliesService.js");
const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");
const components = read("src/modules/aiSupport/components/QuickReplies.jsx");
const arabicDefaultsMigration = read("server/database/migrations/2026-08-14-arabic-ai-inbox-quick-replies.sql");

test("Quick Replies expose tenant-protected CRUD and reorder endpoints", () => {
  // Reading and writing are gated differently on purpose: the composer needs to
  // LIST quick replies for anyone who can open the inbox, while authoring them
  // is shop configuration and stays on `settings`.
  assert.match(routes, /router\.get\("\/quick-replies", protect, inboxView\(\)/);
  assert.match(routes, /router\.post\("\/quick-replies", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.patch\("\/quick-replies\/:id", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.delete\("\/quick-replies\/:id", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.put\("\/quick-replies\/reorder", protect, permit\("settings", "edit"\)/);
});

test("Quick Replies persistence is tenant scoped and ordered", () => {
  assert.match(service, /WHERE tenant_id = \$1/);
  assert.match(service, /ORDER BY sort_order ASC, id ASC/);
  assert.match(service, /unnest\(\$2::bigint\[\]\) WITH ORDINALITY/);
  assert.match(service, /DEFAULT_QUICK_REPLIES/);
  assert.match(service, /shortcut VARCHAR\(4\)/);
  assert.match(service, /idx_ai_inbox_quick_replies_tenant_shortcut/);
  assert.match(service, /This shortcut is already used by another quick reply/);
});

test("default quick replies are natural Arabic responses and legacy English defaults are migrated", () => {
  for (const label of ["ترحيب", "جاري التأكد", "المقاس واللون", "بيانات الطلب", "تأكيد الطلب", "غير متاح", "متابعة العميل", "إنهاء المحادثة"]) {
    assert.match(service, new RegExp(label));
  }
  assert.doesNotMatch(service, /Hi \{\{name\}\}|How can I help you today|support team will assist|Thanks for reaching out/);
  assert.match(arabicDefaultsMigration, /legacy_quick_reply_tenants/);
  assert.match(arabicDefaultsMigration, /WHERE name IN \('Greeting', 'Contact Support', 'Thanks & Close'\)/);
  assert.match(arabicDefaultsMigration, /أهلاً وسهلاً/);
  assert.match(arabicDefaultsMigration, /إنهاء المحادثة/);
});

// Authoring quick replies moved into the inbox control center (2026-09-19): the rail's gear used to
// open a five-item menu and now opens the center itself, with quick replies as one of its sections.
// These guards follow the editor to its new home rather than pinning it to the deleted menu.
test("desktop AI Inbox places Config above Social Comments and uses replies in the composer", () => {
  const configPosition = desktop.indexOf('title={t("aiSupport.controlCenter.title")}');
  const commentsPosition = desktop.indexOf('title={t("aiSupport.inbox.ui.socialComments")}');
  assert.ok(configPosition > 0 && commentsPosition > configPosition);
  assert.match(desktop, /<QuickRepliesPicker/);
  assert.match(desktop, /quickReplies=\{quickRepliesStore\.quickReplies\}/);
  // The editor reaches the center through the same store the composer reads.
  assert.match(desktop, /<InboxControlCenter[\s\S]*quickReplies=\{quickRepliesStore\}/);
});

test("PWA includes Config management and the same message composer picker", () => {
  assert.match(pwa, /\{ key: "config", labelKey: "aiSupport\.quickReplies\.config", icon: Settings \}/);
  assert.match(pwa, /<InboxControlCenter[\s\S]*quickReplies=\{quickRepliesStore\}/);
  assert.match(pwa, /<QuickRepliesPicker/);
  assert.match(pwa, /setControlCenterOpen\(true\)/);
});

test("the quick replies editor is a panel the control center mounts, not a modal of its own", () => {
  const center = read("src/modules/aiSupport/components/controlCenter/InboxControlCenter.jsx");
  assert.match(center, /<QuickRepliesPanel/);
  assert.match(center, /onCreate=\{quickReplies\?\.createReply\}/);
  assert.match(center, /onReorder=\{quickReplies\?\.reorderReplies\}/);
  // The modal shell still exists for any caller that wants the editor on its own.
  assert.match(components, /export function QuickRepliesPanel/);
  assert.match(components, /export function QuickRepliesConfig/);
  assert.match(components, /<QuickRepliesPanel mounted=\{open\}/);
});

test("reply management supports drag, arrows, editing and safe insert-before-send", () => {
  assert.match(components, /draggable=\{!saving\}/);
  assert.match(components, /<ArrowUp/);
  assert.match(components, /<ArrowDown/);
  assert.match(components, /aiSupport\.quickReplies\.addTitle/);
  assert.match(components, /aiSupport\.quickReplies\.editTitle/);
  assert.match(components, /onUse\?\.\(resolveQuickReplyMessage/);
  assert.doesNotMatch(components, /sendManualReply/);
});

test("quick replies open from slash in both composers without a permanent button", () => {
  assert.match(components, /match\(\/\^\\s\*\\\/\(\[\^\\n\]\*\)\$\/\)/);
  assert.match(components, /!activeReplies\.length \|\| !slashMatch/);
  assert.doesNotMatch(components, /aria-expanded=\{open\}/);
  assert.match(desktop, /customerName=\{quickReplyCustomerName\}[\s\S]*value=\{value\}/);
  assert.match(pwa, /customerName=\{conversationName\(selectedConversation \|\| \{\}\)\}[\s\S]*value=\{composerText\}/);
  assert.match(desktop, /slashCommandActive/);
  assert.match(pwa, /!text\.trim\(\) \|\| \/\^\\s\*\\\//);
  assert.match(components, /hasExactShortcut/);
  assert.match(components, /reply\.shortcut === needle/);
  assert.match(components, /\/\{reply\.shortcut\}/);
});

test("quick reply config creates, validates and edits persistent numeric shortcuts", () => {
  assert.match(components, /shortcut: nextShortcut\(\)/);
  assert.match(components, /shortcut: reply\.shortcut/);
  assert.match(components, /shortcutInvalid/);
  assert.match(components, /shortcutDuplicate/);
  assert.match(desktop, /text-\[#9a6a00\]/);
});

test("quick replies inherit the unified light and dark palettes", () => {
  assert.match(components, /useTheme\(\)/);
  assert.match(components, /#f8f4eb/);
  assert.match(components, /#b98508/);
  assert.match(components, /#181a18/);
});
