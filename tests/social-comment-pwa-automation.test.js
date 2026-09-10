import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The AI Inbox PWA had no way to reach a post's automation — no master switch, no "hide customer
   comments". Everything else built alongside it reached the PWA for free because the PWA renders
   the same settings modal and the same comment row; the automation drawer is the one piece that
   lives inside the desktop workspace. These pin the phone's version to the SAME parts, so the two
   surfaces cannot drift into two meanings for one switch. */

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const sheet = read("../src/modules/aiSupport/components/socialAutomation/PostAutomationSheet.jsx");
const pwa = read("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
const panel = read("../src/modules/aiSupport/components/SocialCommentsPanel.jsx");

test("the PWA mounts the automation sheet and a post can open it", () => {
  assert.match(pwa, /<PostAutomationSheet[\s\S]{0,200}open=\{Boolean\(automationPost\)\}/, "the sheet is not mounted");
  assert.match(pwa, /onOpenAutomation=\{\(item\) => setAutomationPost\(item\)\}/, "no post can open it");
  assert.match(panel, /onOpenAutomation\(item, itemKey\)/, "the post card has no automation button");
});

test("the sheet draws the SAME toggle panel as desktop, not a list of its own", () => {
  // One list of switches means a switch added once appears on both surfaces, and the wiring test
  // that reads keys from AutomationSettingsPanel covers the phone too.
  assert.match(sheet, /import AutomationSettingsPanel from "\.\/AutomationSettingsPanel\.jsx";/);
  assert.match(sheet, /<AutomationSettingsPanel settings=\{draft\} onChange=\{handleChange\} \/>/);
  assert.doesNotMatch(sheet, /\{\s*key:\s*"/, "the sheet must not define its own switches");
});

test("the sheet loads and saves through the same engine functions as desktop", () => {
  assert.match(sheet, /normalizeAutomationConfig\(config,/, "load must use the shared merge");
  assert.match(sheet, /serializeAutomationDraft\(next,/, "save must use the shared payload");
  assert.match(sheet, /api\.put\(`\/social-comments\/automation\//);
});

test("after every save the sheet draws what the SERVER kept", () => {
  // Trusting the optimistic state is exactly how switches looked saved and were not.
  const start = sheet.indexOf("const handleChange = useCallback(");
  assert.ok(start > 0);
  const body = sheet.slice(start, sheet.indexOf("\n  );", start));
  const put = body.indexOf("await api.put(");
  const readBack = body.indexOf("await readBack()");
  assert.ok(put > 0 && readBack > put, "the sheet must read back after the PUT");
  assert.match(body, /setDraft\(saved\)/, "and draw the read-back, not the guess");
  assert.match(body, /setDraft\(previous\)/, "a failed save must roll the screen back");
});

test("the sheet edits the SAME config row desktop does", () => {
  // canonical_post_id is what the list hands over and what the saved row is keyed by. Picking a
  // different id first would load a blank config and save a second one beside it.
  const start = sheet.indexOf("const routePostIdFor =");
  const body = sheet.slice(start, sheet.indexOf(");", start) + 2);
  const canonical = body.indexOf("post?.canonical_post_id");
  const bare = body.indexOf("post?.post_id");
  assert.ok(canonical > 0 && bare > canonical, "canonical_post_id must win over post_id");
});

test("the automation button only appears on a post with a product linked", () => {
  assert.match(panel, /\{onOpenAutomation && isProductLinked \?/, "an unlinked post would open onto switches that do nothing");
});
