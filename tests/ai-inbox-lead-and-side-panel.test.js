// Genie's side panel (customer photo) and Leads form, shaped for the shoe shop:
// the panel's quick actions are the shop's (order / product / by size / orders /
// lead / 360), the lead carries the customer's orders and the shoes they bought.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/modules/aiSupport/pages/AiInbox.jsx");
const route = read("server/routes/aiAgentOrders.js");
const lead = read("src/modules/aiSupport/components/LeadDrawer.jsx");
const panel = read("src/modules/aiSupport/components/ConversationSidePanel.jsx");

test("the header photo opens the side panel; the reviewer keeps Customer 360", () => {
  assert.equal(page.split("onOpenCustomer360={reviewerMode ? openCustomerDrawer : () => setSidePanelOpen((current) => !current)}").length - 1, 2);
  assert.match(page, /<ConversationSidePanel/);
  assert.match(page, /onSendBySize=\{canReply \? \(\) => openProductCardPicker\(\{ sizeMode: true, allowMultiple: true \}\) : undefined\}/);
  assert.match(page, /onSendProduct=\{canReply \? \(\) => openProductCardPicker\(\) : undefined\}/);
  assert.match(page, /onCreateOrder=\{canReply \? \(\) => setOrderComposerOpen\(true\) : undefined\}/);
  assert.match(page, /initialTab=\{customerDrawerTab\}/);
});

test("the panel has Genie's three tabs and its sections", () => {
  for (const key of ["info", "media", "starred"]) assert.ok(panel.includes(`["${key}", t("aiSupport.inbox.sidePanel.tabs.${key}")]`), key);
  for (const kind of ["media", "audio", "docs", "links"]) assert.ok(panel.includes(`aiSupport.inbox.sidePanel.mediaKinds.\${key}`) && panel.includes(`["${kind}",`), kind);
  // Starred reads the same browser set the transcript writes.
  assert.ok(panel.includes(`const STAR_STORAGE_KEY = "m1:ai-inbox:starred-messages:v1";`));
  assert.ok(read("src/modules/aiSupport/components/TranscriptMessage.jsx").includes(`const MESSAGE_STAR_STORAGE_KEY = "m1:ai-inbox:starred-messages:v1";`));
  // Context & summary save to the lead; the summary starts from the AI's.
  assert.match(panel, /saveDetail\("context", value\)/);
  assert.match(panel, /value=\{clean\(details\.summary\) \|\| aiSummary\}/);
});

test("the lead route reads and saves the lead under the thread's privacy", () => {
  assert.match(route, /router\.get\("\/conversations\/:conversationId\/lead", protect, inboxView\(\)/);
  assert.match(route, /router\.patch\("\/conversations\/:conversationId\/lead", protect, inboxReply\(\)/);
  assert.match(route, /sessionKeys: \[conversationId\], hiddenKeys/);
  for (const field of ["expected_revenue", "priority", "expected_closing", "notes", "lost_reason", "lost_notes", "context", "summary", "lead_name"]) {
    assert.ok(route.includes(`  ${field}: (value) =>`), field);
  }
  // Orders by the inbox order's conversation or the phone (POS included), and the shoes bought.
  assert.match(route, /o\.ai_agent_conversation_id = \$2\s*OR \(\$3::text <> '' AND RIGHT\(regexp_replace\(COALESCE\(o\.customer_phone, ''\), '\\\\D', '', 'g'\), 10\) = \$3::text\)/);
  assert.match(route, /pv\.size, pv\.color/);
  assert.match(route, /'crm_lead_details', COALESCE\(c\.metadata->'crm_lead_details', '\{\}'::jsonb\) \|\| \$3::jsonb/);
});

test("the lead form: stage, won/lost (a reason first), order, template, orders and shoes, note", () => {
  assert.match(lead, /if \(!clean\(details\.lost_reason\)\) \{\s*setTab\("lost"\);/);
  assert.match(lead, /onStageChange\?\.\("won"\)/);
  for (const key of ["notes", "contact", "orders", "campaign", "lost", "clicks"]) assert.ok(lead.includes(`["${key}", t("aiSupport.inbox.lead.tabs.${key}")]`), key);
  assert.match(lead, /<CampaignAttributionCard conversation=\{conversation\}/);
  assert.match(page, /onLogNote=\{canReply \? \(text\) => sendManualReply\(text, \{ mode: "note", keepDraft: true \}\) : undefined\}/);
  assert.match(page, /if \(!options\.keepDraft\) setReplyText\(""\);/);
  assert.match(page, /data-ai-inbox-lead-button="true"/);
  // Light text on coloured fills: text-white is remapped to near-black by the theme.
  assert.doesNotMatch(lead, /text-white/);
});

test("every lead and panel string exists in both locales", () => {
  for (const locale of ["ar", "en"]) {
    const inbox = JSON.parse(read(`src/locales/${locale}/aiSupport.json`)).inbox;
    for (const key of ["button", "title", "save", "markWon", "markLost", "newOrder", "expectedRevenue", "probability", "priority", "expectedClosing", "lostNeedsReason", "logNote"]) assert.ok(inbox.lead?.[key], `${locale} lead.${key}`);
    for (const key of ["notes", "contact", "orders", "campaign", "lost", "clicks"]) assert.ok(inbox.lead?.tabs?.[key], `${locale} lead.tabs.${key}`);
    for (const key of ["price", "size_unavailable", "color_unavailable", "bought_elsewhere", "shipping", "no_reply", "not_serious", "other"]) assert.ok(inbox.lead?.lostReasons?.[key], `${locale} lostReasons.${key}`);
    for (const key of ["newOrder", "sendProduct", "sendBySize", "orders", "lead", "customer360", "contextSummary", "participants", "transfer", "noMedia", "noStarred"]) assert.ok(inbox.sidePanel?.[key], `${locale} sidePanel.${key}`);
  }
});

test("the side panel is a column beside the chat, not a sheet over the list", () => {
  assert.match(page, /data-ai-inbox-side-column="true"/);
  assert.match(page, /<ConversationSidePanel\s+inline/);
  assert.match(page, /\$\{sidePanelOpen && selectedConversation && !reviewerMode \? "has-side-panel" : ""\}/);
  const css = read("src/modules/aiSupport/pages/AiInboxDesktop.css");
  assert.match(css, /\.ai-omni-workspace\.has-side-panel \{\s*grid-template-columns: 72px minmax\(340px, 400px\) minmax\(390px, 1fr\) minmax\(320px, 360px\);/);
  assert.match(panel, /return inline \? panel : createPortal\(panel/);
});

test("the lead form resizes by dragging its edge and stays on the right", () => {
  assert.match(lead, /data-lead-drawer-resize="true"/);
  assert.match(lead, /window\.innerWidth - moveEvent\.clientX/);
  assert.match(lead, /<div dir="ltr" className="fixed inset-0 z-\[1150\] flex justify-end/);
});

test("the two shortcuts beside quick search are always there", () => {
  const palette = read("src/shared/components/CommandPalette.jsx");
  assert.match(palette, /const SHORTCUT_FALLBACK_PATHS = \["\/orders", "\/products", "\/dashboard", "\/customers", "\/pos"\];/);
});
