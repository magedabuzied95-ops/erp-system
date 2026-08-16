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
const activeConversationCardSource = desktopSource.slice(
  desktopSource.indexOf("const InboxConversationCard"),
  desktopSource.indexOf("function ConversationLabelsModal")
);
const activeDesktopReturnStart = desktopSource.indexOf('className="ai-inbox-desktop');
const activeDesktopReturnEnd = desktopSource.indexOf("\n  return (", activeDesktopReturnStart);
const activeDesktopReturnSource = desktopSource.slice(activeDesktopReturnStart, activeDesktopReturnEnd);
const customer360IdentitySource = desktopSource.slice(
  desktopSource.indexOf("const customer360Identifier"),
  desktopSource.indexOf("const storefrontProductUrl")
);

test("desktop AI Inbox uses a persistent omnichannel workspace", () => {
  assert.match(desktopSource, /ai-omni-workspace/);
  assert.match(desktopSource, /ai-omni-list-panel/);
  assert.match(desktopSource, /ai-omni-chat-panel/);
  assert.doesNotMatch(desktopSource, /ai-omni-tools-panel/);
  // Structure, not pixels. The rail widened from 58px to 72px when it gained a menu,
  // which failed a test whose subject is that the workspace is three columns: a fixed
  // narrow rail, a BOUNDED list that cannot eat the chat, and a chat that takes the
  // rest. Those three properties are what the layout depends on; the exact widths are
  // design, and design is allowed to move.
  const grid = desktopCss.match(/grid-template-columns:\s*(\d+)px minmax\((\d+)px, (\d+)px\) minmax\((\d+)px, 1fr\)/);
  assert.ok(grid, "the workspace must stay a rail + bounded list + flexible chat grid");
  assert.ok(Number(grid[1]) <= 96, `the channel rail must stay narrow, got ${grid[1]}px`);
  assert.ok(Number(grid[3]) > Number(grid[2]), "the list column must be a range, not a fixed width");
  assert.match(desktopCss, /\.ai-inbox-desktop \.ai-omni-list-panel \{[\s\S]*?border-color:\s*rgba\(255, 255, 255, 0\.14\)[\s\S]*?border-radius:\s*1\.125rem/);
  assert.match(desktopCss, /\.ai-omni-list-panel > div:last-child[\s\S]*?scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(desktopCss, /ai-omni-workspace--tools/);
  assert.match(pwaSource, /AIInboxAnalysisPanel/);
});

test("desktop workspace keeps search while channel filters stay out of the top bar", () => {
  assert.match(desktopSource, /aiSupport\.inbox\.ui\.searchCustomerMessage/);
  assert.doesNotMatch(desktopSource, /fixedChannelSummaries\.map/);
  assert.match(desktopSource, /channels=\{fixedChannelSummaries\}/);
  assert.match(desktopSource, /AI \{aiAssistantGlobalEnabled \? "ON" : "OFF"\}/);
});

test("desktop message composer matches the omnichannel footer in light and dark modes", () => {
  assert.match(desktopSource, /data-ai-inbox-composer="true"/);
  // Localized: the live/internal-note split is what this guards, not the copy.
  assert.match(desktopSource, /placeholder=\{canSendLive \? t\("aiSupport\.inbox\.composer\.placeholder"\)/);
  assert.match(desktopSource, /<Paperclip className="h-5 w-5"/);
  assert.match(desktopSource, /<Smile className="h-5 w-5"/);
  assert.match(desktopSource, /<FileText className="h-5 w-5"/);
  // The composer strip must carry BOTH a light and a dark background, or it goes
  // white-on-white in dark mode.
  assert.match(desktopSource, /bg-\[#eefaf8\][^\n]*dark:bg-\[#20231f\]/);
  // It must be the SAME dark token the sticky footer uses — matching the footer is
  // what this test is named for. There used to be a second shade (#1b1e1b) for the
  // toolbar; consolidating onto one token is the stated goal, not a regression, so the
  // assertion is now that they agree rather than that both shades exist.
  const footerDark = /border-t[^\n]*dark:bg-\[#20231f\]/;
  assert.match(desktopSource, footerDark, "the footer and composer must share one dark token");
  assert.ok(!desktopSource.includes("#1b1e1b"), "a second composer dark shade would break the match");
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
  // Localized. The icon and handler assertions above already prove each action is
  // wired; these prove it is also LABELLED, which is what stops the toolbar being four
  // anonymous icons. The key is the stable part, the wording is not.
  for (const key of [
    "aiSupport.inbox.pwa.createOrder",
    "aiSupport.inbox.picker.sendProduct",
    "aiSupport.inbox.picker.availableBySize",
    "aiSupport.inbox.pwa.createCustomer",
  ]) {
    assert.ok(desktopSource.includes(`t("${key}")`), `commerce action ${key} must still be labelled`);
  }
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
  assert.match(compactHeaderSource, /<div dir="ltr" data-ai-inbox-compact-contact-header="true"/);
  assert.match(compactHeaderSource, /data-ai-inbox-contact-identity="left"/);
  assert.match(compactHeaderSource, /data-ai-inbox-header-actions="right"/);
  assert.doesNotMatch(compactHeaderSource, />\s*Assign\s*</);
  assert.doesNotMatch(compactHeaderSource, /closeToggleLabel/);
  assert.doesNotMatch(compactHeaderSource, /onClick=\{onClose\}/);
  assert.match(compactHeaderSource, /showCustomerIdentifier[\s\S]*?facebook[\s\S]*?messenger[\s\S]*?instagram/);
  assert.doesNotMatch(compactHeaderSource, /aria-label="Lead Status"/);
  assert.match(compactHeaderSource, /<Tag className="h-3\.5 w-3\.5" \/> \{t\("aiSupport\.inbox\.header\.addLabel"\)\}/);
  assert.match(compactHeaderSource, /conversationLabels\.slice\(0, 4\)\.map/);
  assert.match(compactHeaderSource, /className="block truncate text-left text-sm font-black/);
  assert.match(compactHeaderSource, /showCustomerIdentifier \? <div dir="ltr" className="truncate text-left text-\[10px\][\s\S]*?\{phone\}<\/div>/);
  assert.match(compactHeaderSource, /inline-flex h-6 items-center rounded-md border px-2 text-\[10px\] font-black/);
  assert.match(compactHeaderSource, /<ConversationLabelsModal/);
});

test("desktop conversation cards flow left to right while preserving message direction", () => {
  assert.match(activeConversationCardSource, /dir="ltr"[\s\S]*?data-ai-inbox-conversation-direction="ltr"/);
  assert.match(activeConversationCardSource, /<span dir="auto" className=\{`line-clamp-2 text-left/);
  assert.match(activeConversationCardSource, /<div dir="auto" className="truncate text-left/);
  assert.match(desktopCss, /grid-template-columns:\s*minmax\(360px, 400px\) minmax\(390px, 1fr\)/);
});

test("desktop customer name and avatar open the shared Customer 360 drawer", () => {
  assert.match(compactHeaderSource, /onOpenCustomer360\?\.\(conversation/);
  assert.match(compactHeaderSource, /Open customer details for/);
  assert.match(compactHeaderSource, /customerId: customer360Identifier\(conversation\)/);
  assert.match(customer360IdentitySource, /customer\?\.erp_customer_id/);
  assert.match(customer360IdentitySource, /metadata\?\.resolved_phone/);
  assert.match(customer360IdentitySource, /channel\.includes\("whatsapp"\) \? customer\?\.external_customer_id/);
  assert.doesNotMatch(customer360IdentitySource, /customer_profile_id/);
  // The title became a translation key. The props that matter are the ones that decide
  // WHICH customer the drawer shows: a drawer wired to the wrong id is the failure
  // worth guarding, and a hardcoded English title never guarded it.
  assert.match(
    activeDesktopReturnSource,
    /<Customer360Drawer[\s\S]*?open=\{customerDrawer\.open\}[\s\S]*?customerId=\{customerDrawer\.customerId\}[\s\S]*?title=\{t\("aiSupport\.inbox\.ui\.customer360"\)\}/
  );
  assert.equal((desktopSource.match(/<Customer360Drawer/g) || []).length, 1);
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
  // AI_INBOX_PRODUCT_LINK_MODAL: the picker used to carry its own gold literal
  // plus a duplicated light-theme override block, which made it a second AI Inbox
  // theme rather than part of the ERP. Both are gone — theme awareness now comes
  // from the M1 tokens themselves, so one definition serves both themes and the
  // brand stays re-pointable from themes.js. The workspace geometry is unchanged.
  assert.match(desktopCss, /--picker-accent:\s*var\(--primary\)/);
  assert.match(desktopCss, /--picker-bg:\s*var\(--bg\)/);
  assert.match(desktopCss, /\.ai-inbox-product-picker-desktop__product-grid > button/);
});

test("ERP shell grants only the desktop inbox a full-bleed content area", () => {
  assert.match(mainLayoutSource, /location\.pathname === "\/admin\/ai-inbox"/);
  assert.match(mainLayoutSource, /isAiInboxWorkspace[\s\S]*?overflow-hidden p-0/);
});
