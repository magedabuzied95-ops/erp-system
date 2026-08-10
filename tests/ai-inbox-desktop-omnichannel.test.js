import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const desktopCss = readFileSync("src/modules/aiSupport/pages/AiInboxDesktop.css", "utf8");
const pwaSource = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const mainLayoutSource = readFileSync("src/shared/layouts/MainLayout.jsx", "utf8");

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

test("PWA remains isolated from desktop layout styling", () => {
  assert.doesNotMatch(pwaSource, /AiInboxDesktop\.css/);
  assert.doesNotMatch(pwaSource, /ai-omni-workspace/);
  assert.match(pwaSource, /import "\.\/AiInboxPwa\.css"/);
});

test("ERP shell grants only the desktop inbox a full-bleed content area", () => {
  assert.match(mainLayoutSource, /location\.pathname === "\/admin\/ai-inbox"/);
  assert.match(mainLayoutSource, /isAiInboxWorkspace[\s\S]*?overflow-hidden p-0/);
});
