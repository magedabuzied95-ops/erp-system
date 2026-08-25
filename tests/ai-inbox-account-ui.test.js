// AI Inbox multi-account UI — the badge, the filter, and the numbers manager.
//
// The backend routes replies per account; this pins the three UI surfaces that
// make that visible: every conversation card can name its owning account, the
// list can be narrowed to one account of the selected channel, and the
// integrations panel can register/pause WhatsApp numbers. All three appear
// ONLY when a platform has more than one account — a single-number tenant sees
// the unchanged inbox.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const inboxPage = read("src/modules/aiSupport/pages/AiInbox.jsx");
const whatsappPanel = read("src/modules/aiSupport/components/integrations/WhatsAppIntegrationPanel.jsx");
const arLocale = JSON.parse(read("src/locales/ar/aiSupport.json"));
const enLocale = JSON.parse(read("src/locales/en/aiSupport.json"));

test("conversationAccountKey reads the account stamps the webhooks write", async () => {
  const { conversationAccountKey } = await import("../src/modules/aiSupport/services/inboxChannels.js");
  assert.equal(
    conversationAccountKey({ channel: "whatsapp", channel_metadata: { whatsapp_instance: "branch-2" } }),
    "branch-2"
  );
  assert.equal(
    conversationAccountKey({ channel: "facebook_messenger", channel_metadata: { resolved_page_id: "111", page_id: "222" } }),
    "111"
  );
  assert.equal(
    conversationAccountKey({ channel: "instagram", channel_metadata: { instagram_business_account_id: "333", page_id: "222" } }),
    "333"
  );
  assert.equal(conversationAccountKey({ channel: "whatsapp", channel_metadata: {} }), "");
  assert.equal(conversationAccountKey({ channel: "web_chat" }), "");
});

test("the inbox fetches the account registry and filters by it", () => {
  assert.match(inboxPage, /api\.get\("\/ai-agent\/channel-accounts"/);
  assert.match(inboxPage, /const \[accountFilter, setAccountFilter\] = useState\("all"\)/);
  assert.match(inboxPage, /\.filter\(matchesAccountFilter\)/);
  assert.match(inboxPage, /selectedAccountKeys\.has\(conversationAccountKey\(conversation\)\)/);
  // deps: the memo must recompute when the account selection changes
  assert.match(inboxPage, /readFilter, selectedAccountKeys\]\);/);
});

test("changing the channel resets the account sub-filter", () => {
  const resets = inboxPage.match(/setChannelFilter\((?:value|"all")\);\s*\n\s*(?:setSelectedSocialCommentId\(""\);\s*\n\s*)?setAccountFilter\("all"\)|setAccountFilter\("all"\)/g) || [];
  assert.ok(resets.length >= 2, `expected both channel-rail handlers to reset the account filter, found ${resets.length}`);
});

test("the conversation card can carry an account badge", () => {
  assert.match(inboxPage, /accountLabel = ""/);
  assert.match(inboxPage, /accountLabel=\{conversationAccountLabel\(item\)\}/);
  assert.match(inboxPage, /\{accountLabel \? <Pill tone="zinc">/);
  // badge only when the platform has more than one account
  assert.match(inboxPage, /accountsByPlatform\.get\(platform\) \|\| \[\]\)\.length < 2\) return ""/);
});

test("the account filter row appears only with more than one account", () => {
  assert.match(inboxPage, /accounts\.length > 1\s*\? accounts\.map/);
  assert.match(inboxPage, /accountFilterOptions\.length \? \(/);
  assert.match(inboxPage, /aiSupport\.inbox\.ui\.accountFilterAll/);
});

test("the WhatsApp panel manages instances: list, add with verification, pause", () => {
  assert.match(whatsappPanel, /api\.get\("\/ai-agent\/channel-accounts", \{ params: \{ platform: "whatsapp", include_inactive: "true" \}/);
  assert.match(whatsappPanel, /api\.post\(\s*"\/ai-agent\/channel-accounts"/);
  assert.match(whatsappPanel, /api\.patch\(`\/ai-agent\/channel-accounts\/\$\{encodeURIComponent\(account\.id\)\}`/);
  // per-instance test send goes through the instance-aware endpoint
  assert.match(whatsappPanel, /api\.post\("\/ai-agent\/channels\/whatsapp\/test-send", \{ to: test\.phone, message: test\.message, instance: test\.instance \}/);
});

test("every new UI string exists in BOTH locales", () => {
  const keys = [
    ["inbox", "ui", "accountFilterAll"],
    ["integrations", "whatsapp", "instances", "title"],
    ["integrations", "whatsapp", "instances", "subtitle"],
    ["integrations", "whatsapp", "instances", "defaultInstance"],
    ["integrations", "whatsapp", "instances", "name"],
    ["integrations", "whatsapp", "instances", "displayName"],
    ["integrations", "whatsapp", "instances", "add"],
    ["integrations", "whatsapp", "instances", "added"],
    ["integrations", "whatsapp", "instances", "addedNotConnected"],
    ["integrations", "whatsapp", "instances", "addFailed"],
    ["integrations", "whatsapp", "instances", "updateFailed"],
    ["integrations", "whatsapp", "instances", "empty"],
    ["integrations", "whatsapp", "instances", "active"],
    ["integrations", "whatsapp", "instances", "inactive"],
    ["integrations", "whatsapp", "instances", "testInstance"],
    ["integrations", "whatsapp", "instances", "note"],
  ];
  for (const [locale, name] of [[arLocale, "ar"], [enLocale, "en"]]) {
    const rootNode = locale.aiSupport || locale;
    for (const keyPath of keys) {
      let node = rootNode;
      for (const segment of keyPath) node = node?.[segment];
      assert.ok(
        typeof node === "string" && node.trim(),
        `missing ${name} translation for aiSupport.${keyPath.join(".")}`
      );
    }
  }
});
