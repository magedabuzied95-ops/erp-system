import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const center = read("src/modules/aiSupport/components/controlCenter/InboxControlCenter.jsx");
const desktop = read("src/modules/aiSupport/pages/AiInbox.jsx");
const pwa = read("src/modules/aiSupport/pages/AiInboxPwa.jsx");
const app = read("src/App.jsx");
const ar = JSON.parse(read("src/locales/ar/aiSupport.json"));
const en = JSON.parse(read("src/locales/en/aiSupport.json"));

test("the gear opens the control center instead of a five-item popover", () => {
  assert.match(desktop, /onOpenControlCenter\("agent"\)/);
  assert.match(desktop, /<InboxControlCenter/);
  // The popover and its viewport-flip placement effect are gone, not merely unused.
  assert.doesNotMatch(desktop, /configMenuAnchor/);
  assert.doesNotMatch(desktop, /configMenuPlacement/);
  assert.doesNotMatch(desktop, /role="menu"/);
});

test("both inbox surfaces open the same center, loaded through the same lazy wrapper", () => {
  const wrapper = "src/modules/aiSupport/components/controlCenter/lazyInboxControlCenter.js";
  assert.ok(exists(wrapper), "the shared lazy wrapper must exist");
  assert.match(desktop, /from "\.\.\/components\/controlCenter\/lazyInboxControlCenter"/);
  assert.match(pwa, /from "\.\.\/components\/controlCenter\/lazyInboxControlCenter"/);
  assert.match(pwa, /<InboxControlCenter/);
});

test("there is exactly one settings shell: the old integrations center is deleted, not duplicated", () => {
  assert.ok(!exists("src/modules/aiSupport/components/integrations/IntegrationsCenter.jsx"));
  assert.ok(!exists("src/modules/aiSupport/components/integrations/lazyIntegrationsCenter.js"));
  // Its panels live on and are mounted by the center.
  assert.match(center, /MetaIntegrationPanel/);
  assert.match(center, /WhatsAppIntegrationPanel/);
  assert.match(center, /WhatsAppQueuePanel/);
  assert.match(center, /TikTokIntegrationPanel/);
});

test("the agent's knobs have one home, and the old page is a redirect", () => {
  assert.ok(!exists("src/modules/aiSupport/pages/AiAgentSettings.jsx"), "two editors for one store is the bug this replaces");
  assert.match(app, /path="admin\/ai-agent-settings" element=\{<Navigate to="\/admin\/ai-inbox\?config=agent" replace \/>\}/);
  assert.doesNotMatch(app, /AiAgentSettings/);
});

test("old deep links keep working and every section is reachable by name", () => {
  assert.match(desktop, /searchParams\.get\("integrations"\)/);
  assert.match(desktop, /searchParams\.get\("config"\)/);
  // A link to a section that does not exist must land on a real one rather than an empty panel.
  assert.match(desktop, /CONTROL_CENTER_SECTIONS\.includes\(section\) \? section : "agent"/);
});

test("every nav section renders a panel and carries a label in both languages", () => {
  const sections = [...center.matchAll(/section === "([a-z_]+)" \?/g)].map((match) => match[1]);
  const declared = [...center.matchAll(/sections: \[([^\]]+)\]/g)]
    .flatMap((match) => match[1].split(",").map((part) => part.trim().replace(/"/g, "")))
    .filter(Boolean);
  assert.ok(declared.length >= 12, `expected the full nav, got ${declared.length}`);
  declared.forEach((key) => {
    assert.ok(sections.includes(key), `nav section "${key}" has no panel`);
    assert.match(center, new RegExp(`key === "${key}"`), `nav section "${key}" has no label`);
  });
  ["title", "subtitle", "groups", "nav", "actions", "playground", "performance", "broadcasts"].forEach((key) => {
    assert.ok(ar.controlCenter?.[key], `ar controlCenter.${key} missing`);
    assert.ok(en.controlCenter?.[key], `en controlCenter.${key} missing`);
  });
});

test("the center closes on Escape and on a backdrop click", () => {
  assert.match(center, /event\.key === "Escape"/);
  assert.match(center, /event\.target === event\.currentTarget && onClose\?\.\(\)/);
});
