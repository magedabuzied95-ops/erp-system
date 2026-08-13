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

test("Quick Replies expose tenant-protected CRUD and reorder endpoints", () => {
  assert.match(routes, /router\.get\("\/quick-replies", protect, permit\("settings", "view"\)/);
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
});

test("desktop AI Inbox places Config above Social Comments and uses replies in the composer", () => {
  const configPosition = desktop.indexOf('title="Config"');
  const commentsPosition = desktop.indexOf('title="Social Comments"');
  assert.ok(configPosition > 0 && commentsPosition > configPosition);
  assert.match(desktop, /<QuickRepliesPicker/);
  assert.match(desktop, /quickReplies=\{quickRepliesStore\.quickReplies\}/);
  assert.match(desktop, /<QuickRepliesConfig/);
});

test("PWA includes Config management and the same message composer picker", () => {
  assert.match(pwa, /\{ key: "config", labelKey: "aiSupport\.quickReplies\.config", icon: Settings \}/);
  assert.match(pwa, /<QuickRepliesConfig/);
  assert.match(pwa, /<QuickRepliesPicker/);
  assert.match(pwa, /setQuickRepliesConfigOpen\(true\)/);
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
});

test("quick replies inherit the unified light and dark palettes", () => {
  assert.match(components, /useTheme\(\)/);
  assert.match(components, /#f8f4eb/);
  assert.match(components, /#b98508/);
  assert.match(components, /#181a18/);
});
