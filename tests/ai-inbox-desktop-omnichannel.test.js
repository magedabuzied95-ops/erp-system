import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const desktopCss = readFileSync("src/modules/aiSupport/pages/AiInboxDesktop.css", "utf8");
const pwaSource = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const mainLayoutSource = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");
const productPickerSource = readFileSync("src/modules/aiSupport/components/ProductCardPicker.jsx", "utf8");
const productMessageSource = readFileSync("src/modules/aiSupport/components/ProductCardMessage.jsx", "utf8");
const transcriptMessageSource = readFileSync("src/modules/aiSupport/components/TranscriptMessage.jsx", "utf8");
const compactHeaderSource = desktopSource.slice(
  desktopSource.indexOf("function InboxChatHeader"),
  desktopSource.indexOf("const Transcript = memo")
);

test("desktop AI Inbox uses a persistent omnichannel workspace", () => {
  assert.match(desktopSource, /ai-omni-workspace/);
  assert.match(desktopSource, /ai-omni-list-panel/);
  assert.match(desktopSource, /ai-omni-chat-panel/);
  assert.doesNotMatch(desktopSource, /ai-omni-tools-panel/);
  assert.match(desktopCss, /grid-template-columns:\s*58px minmax\(320px, 360px\) minmax\(390px, 1fr\)/);
  assert.match(desktopCss, /\.ai-inbox-desktop \.ai-omni-list-panel \{[\s\S]*?border-color:\s*rgba\(255, 255, 255, 0\.14\)[\s\S]*?border-radius:\s*1\.125rem/);
  assert.match(desktopCss, /\.ai-omni-list-panel > div:last-child[\s\S]*?scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(desktopCss, /ai-omni-workspace--tools/);
  assert.match(pwaSource, /AIInboxAnalysisPanel/);
});

test("desktop workspace keeps search while channel filters stay out of the top bar", () => {
  assert.match(desktopSource, /ابحث عن العميل أو الرسالة/);
  assert.doesNotMatch(desktopSource, /fixedChannelSummaries\.map/);
  assert.match(desktopSource, /channels=\{fixedChannelSummaries\}/);
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
  assert.match(desktopSource, /data-ai-inbox-compact-contact-header="true"/);
  assert.match(desktopSource, /data-ai-inbox-commerce-toolbar="true"/);
  assert.match(desktopSource, /setOrderComposerOpen\(true\)/);
  assert.match(desktopSource, /openProductCardPicker\(\)/);
  assert.match(desktopSource, /openProductCardPicker\(\{ sizeMode: true, allowMultiple: true \}\)/);
  assert.match(desktopSource, /onClick=\{createLeadCustomer\}/);
  assert.match(desktopSource, /<ShoppingCart className="h-4 w-4"/);
  assert.match(desktopSource, /<PackageCheck className="h-4 w-4"/);
  assert.match(desktopSource, /<Ruler className="h-4 w-4"/);
  assert.match(desktopSource, /<UserPlus className="h-4 w-4"/);
  assert.match(desktopSource, /إنشاء أوردر/);
  assert.match(desktopSource, /إرسال منتج/);
  assert.match(desktopSource, /المتاح بالمقاس/);
  assert.match(desktopSource, /إنشاء عميل/);
  assert.doesNotMatch(desktopSource, /\n\s*<LeadQuickActionsBar/);
});

test("desktop conversation product cards use a compact bounded layout", () => {
  assert.match(productMessageSource, /data-ai-product-card-density=\{compact \? "compact" : "default"\}/);
  assert.match(productMessageSource, /max-w-\[520px\]/);
  assert.match(productMessageSource, /h-56 w-full bg-white object-contain/);
  assert.match(transcriptMessageSource, /<ProductCardMessage message=\{message\} cards=\{cards\} compact \/>/);
  assert.doesNotMatch(pwaSource, /<ProductCardMessage message=\{message\} cards=\{cards\} compact \/>/);
});

test("desktop conversation header stays compact and exposes multi-label management", () => {
  assert.doesNotMatch(compactHeaderSource, />\s*Assign\s*</);
  assert.doesNotMatch(compactHeaderSource, /closeToggleLabel/);
  assert.doesNotMatch(compactHeaderSource, /onClick=\{onClose\}/);
  assert.match(compactHeaderSource, /showCustomerIdentifier[\s\S]*?facebook[\s\S]*?messenger[\s\S]*?instagram/);
  assert.doesNotMatch(compactHeaderSource, /aria-label="Lead Status"/);
  assert.match(compactHeaderSource, /<Tag className="h-3\.5 w-3\.5" \/> Add Label/);
  assert.match(compactHeaderSource, /conversationLabels\.slice\(0, 4\)\.map/);
  assert.match(compactHeaderSource, /<ConversationLabelsModal/);
});

test("desktop customer name and avatar open the shared Customer 360 drawer", () => {
  assert.match(compactHeaderSource, /onOpenCustomer360\?\.\(conversation/);
  assert.match(compactHeaderSource, /Open customer details for/);
  assert.match(desktopSource, /context\.customerId[\s\S]*?customer\.customer_profile_id[\s\S]*?customerProfile\.id/);
  assert.match(desktopSource, /<Customer360Drawer[\s\S]*?open=\{customerDrawer\.open\}[\s\S]*?customerId=\{customerDrawer\.customerId\}[\s\S]*?title="Customer 360"/);
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
  assert.match(desktopCss, /--picker-accent:\s*#d4af37/);
  assert.match(desktopCss, /html\[data-theme="light"\] \.ai-inbox-product-picker-desktop/);
  assert.match(desktopCss, /\.ai-inbox-product-picker-desktop__product-grid > button/);
});

test("ERP shell grants only the desktop inbox a full-bleed content area", () => {
  assert.match(mainLayoutSource, /location\.pathname === "\/admin\/ai-inbox"/);
  assert.match(mainLayoutSource, /isAiInboxWorkspace[\s\S]*?overflow-hidden p-0/);
});
