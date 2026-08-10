import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const desktopCss = readFileSync("src/modules/aiSupport/pages/AiInboxDesktop.css", "utf8");
const pwaSource = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const mainLayoutSource = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");
const productPickerSource = readFileSync("src/modules/aiSupport/components/ProductCardPicker.jsx", "utf8");

test("desktop AI Inbox uses a persistent omnichannel workspace", () => {
  assert.match(desktopSource, /ai-omni-workspace/);
  assert.match(desktopSource, /ai-omni-list-panel/);
  assert.match(desktopSource, /ai-omni-chat-panel/);
  assert.match(desktopSource, /ai-omni-tools-panel/);
  assert.match(desktopCss, /grid-template-columns:\s*58px minmax\(270px, 310px\) minmax\(420px, 1fr\)/);
  assert.match(desktopCss, /ai-omni-workspace--tools/);
});

test("desktop workspace exposes omnichannel search and channel filters", () => {
  assert.match(desktopSource, /Search conversations, customers or messages/);
  assert.match(desktopSource, /fixedChannelSummaries\.map/);
  assert.match(desktopSource, /AI \{aiAssistantGlobalEnabled \? "ON" : "OFF"\}/);
});

test("desktop message composer matches the omnichannel footer in light and dark modes", () => {
  assert.match(desktopSource, /data-ai-inbox-composer="true"/);
  assert.match(desktopSource, /placeholder=\{canSendLive \? "Type your message\.\.\."/);
  assert.match(desktopSource, /<Paperclip className="h-5 w-5"/);
  assert.match(desktopSource, /<Smile className="h-5 w-5"/);
  assert.match(desktopSource, /<FileText className="h-5 w-5"/);
  assert.match(desktopSource, /bg-\[#eefaf8\][^\n]*dark:bg-\[#20231f\]/);
  assert.match(desktopSource, /dark:bg-\[#1b1e1b\]/);
  assert.match(desktopCss, /html\[data-theme="dark"\][\s\S]*?bg-\[#eefaf8\][\s\S]*?background:\s*#20231f\s*!important/);
});

test("desktop chat exposes commerce actions above the transcript", () => {
  assert.match(desktopSource, /data-ai-inbox-commerce-toolbar="true"/);
  assert.match(desktopSource, /setOrderComposerOpen\(true\)/);
  assert.match(desktopSource, /openProductCardPicker\(\)/);
  assert.match(desktopSource, /openProductCardPicker\(\{ sizeMode: true, allowMultiple: true \}\)/);
  assert.match(desktopSource, /onClick=\{createLeadCustomer\}/);
  assert.match(desktopSource, /إنشاء أوردر/);
  assert.match(desktopSource, /إرسال منتج/);
  assert.match(desktopSource, /المتاح بالمقاس/);
  assert.match(desktopSource, /إنشاء عميل/);
});

test("PWA remains isolated from desktop layout styling", () => {
  assert.doesNotMatch(pwaSource, /AiInboxDesktop\.css/);
  assert.doesNotMatch(pwaSource, /ai-omni-workspace/);
  assert.match(pwaSource, /import "\.\/AiInboxPwa\.css"/);
});

test("desktop AI Inbox uses its own wide product selection workspace", () => {
  assert.match(desktopSource, /mode="desktopInbox"/);
  assert.doesNotMatch(pwaSource, /mode="desktopInbox"/);
  assert.match(productPickerSource, /mode === "desktopInbox"/);
  assert.match(productPickerSource, /setPreviewCollapsed\(!desktopInboxMode\)/);
  assert.match(productPickerSource, /ai-inbox-product-picker-desktop__product-grid/);
  assert.match(desktopCss, /\.ai-inbox-product-picker-desktop__dialog[\s\S]*?width:\s*min\(1280px/);
  assert.match(desktopCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("ERP shell grants only the desktop inbox a full-bleed content area", () => {
  assert.match(mainLayoutSource, /location\.pathname === "\/admin\/ai-inbox"/);
  assert.match(mainLayoutSource, /isAiInboxWorkspace[\s\S]*?overflow-hidden p-0/);
});
