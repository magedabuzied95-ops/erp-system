import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* A per-post toggle only works if its key appears in FOUR places: the panel that draws it, the
   draft that seeds it, the merge that loads it back from a saved config, and the payload that
   sends it to the server. Miss any one and the switch renders — permanently off, saving nothing,
   with no error anywhere. `hideComments` shipped that way on 2026-09-10 and was only caught
   because the owner went looking for the switch. */

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const panel = read("../src/modules/aiSupport/components/socialAutomation/AutomationSettingsPanel.jsx");
const engine = read("../src/modules/aiSupport/components/socialAutomation/automationEngine.js");

const panelKeys = [...panel.matchAll(/\{\s*key:\s*"([A-Za-z_]+)"/g)].map((match) => match[1]);

const sliceFunction = (source, marker) => {
  const start = source.indexOf(marker);
  assert.ok(start > 0, `${marker} is gone from automationEngine.js`);
  const end = source.indexOf("\n};", start);
  return source.slice(start, end > start ? end : start + 3000);
};

test("the panel draws at least the toggles we know about", () => {
  assert.ok(panelKeys.includes("enabled"));
  assert.ok(panelKeys.includes("likeComment"));
  assert.ok(panelKeys.includes("hideComments"), "the hide-customer-comments switch is missing");
});

test("every toggle the panel draws is seeded, loaded and saved", () => {
  const draft = sliceFunction(engine, "export const buildAutomationDraft");
  const merge = sliceFunction(engine, "const fallbackDraft = buildAutomationDraft(post);");
  const payload = sliceFunction(engine, "export const serializeAutomationDraft");

  for (const key of panelKeys) {
    // `enabled` is the master switch and lives outside the settings object in the payload.
    if (key === "enabled") continue;
    assert.ok(draft.includes(`${key}:`), `"${key}" has no default in buildAutomationDraft`);
    assert.ok(merge.includes(`${key}: settings.${key}`), `"${key}" is not read back from a saved config`);
    assert.ok(payload.includes(`${key}: Boolean(safeDraft.${key})`), `"${key}" is never sent to the server`);
  }
});

test("a saved config is read back before the linked-product gate can discard it", () => {
  // The gate ran first and returned null whenever loadSocialCommentPost could not find the post —
  // which it cannot for a {pageId}_{postId} id. The save wrote the row, the read-back found
  // nothing, the server answered with defaults, and every switch whose default is OFF flipped
  // back seconds after the owner saved it.
  const center = read("../server/services/socialCommentsCenterService.js");
  const start = center.indexOf("export const getSocialCommentAutomationConfig");
  assert.ok(start > 0, "getSocialCommentAutomationConfig is gone");
  const body = center.slice(start, center.indexOf("\n};", start));
  const savedRowReturn = body.indexOf("return normalizedConfig;");
  const productGate = body.indexOf("hasLinkedProductForSocialCommentPost(linkedProductResolvedPost)");
  assert.ok(savedRowReturn > 0, "the saved-row branch no longer returns");
  assert.ok(productGate > 0, "the linked-product gate is gone entirely");
  assert.ok(
    savedRowReturn < productGate,
    "a row the owner saved must be returned before the gate gets a chance to throw it away"
  );
});

test("the server keeps the same toggle names", () => {
  // The payload key and the key the automation reads have to be the same string, or the switch
  // saves cleanly and the pipeline never sees it.
  const center = read("../server/services/socialCommentsCenterService.js");
  const automation = read("../server/services/socialCommentAutomationService.js");
  for (const key of panelKeys) {
    if (key === "enabled") continue;
    assert.ok(center.includes(`${key}:`), `the server normaliser drops "${key}"`);
    assert.ok(
      automation.includes(`config.settings?.${key}`),
      `nothing in the automation reads "${key}"`
    );
  }
});
