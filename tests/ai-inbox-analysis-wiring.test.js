import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FeatureFlagService, FLAG_NAMES } from "../src/modules/aiSupport/integration/aiFeatureFlags.js";

const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const pwa = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const hook = readFileSync("src/modules/aiSupport/integration/useAIInboxAnalysis.js", "utf8");
const panel = readFileSync("src/modules/aiSupport/components/AIInboxAnalysisPanel.jsx", "utf8");

test("the analysis layer is reachable from both inbox surfaces", () => {
  // ~15k lines of conversation intelligence — core/, intelligence/, decision/,
  // copilot/, learning/ — had exactly one entry point, useAIInboxAnalysis, and
  // it was called only from the PWA. The desktop workspace could not run it at
  // all, so there was no way to judge whether it was worth keeping.
  for (const [label, source] of [["desktop", desktop], ["pwa", pwa]]) {
    assert.match(source, /useAIInboxAnalysis\(/, `${label} must call the analysis hook`);
    assert.match(source, /<AIInboxAnalysisPanel/, `${label} must render the analysis panel`);
  }
});

test("wiring it in does not turn it on", () => {
  // Every flag is deny-by-default, and AI_ENABLED gates the other three, so an
  // untouched deployment behaves exactly as it did before.
  const service = new FeatureFlagService();
  const snapshot = service.getSnapshot();
  for (const name of FLAG_NAMES) {
    assert.equal(snapshot[name], false, `${name} must default to false`);
  }
  service.setRuntimeConfig({ COPILOT_ENABLED: true, DECISION_ENABLED: true, LEARNING_ENABLED: true });
  const withoutMaster = service.getSnapshot();
  for (const name of ["COPILOT_ENABLED", "DECISION_ENABLED", "LEARNING_ENABLED"]) {
    assert.equal(withoutMaster[name], false, `${name} must stay off while AI_ENABLED is off`);
  }
  service.dispose();
});

test("a disabled inbox pays no cost for the dormant engines", () => {
  // The engines are dynamic imports built inside getOrchestrator(), and the
  // effect returns before calling it when the flag is off — so a disabled inbox
  // neither downloads nor executes them.
  assert.match(hook, /if \(!AI_ENABLED \|\| !input \|\| !key\)/);
  const effect = hook.slice(hook.indexOf("if (!AI_ENABLED"), hook.indexOf("const track = useCallback"));
  assert.ok(
    effect.indexOf("return undefined;") < effect.indexOf("getOrchestrator()"),
    "the disabled path must return before the orchestrator is constructed"
  );
  assert.match(hook, /orchestratorPromise = Promise\.all\(\[import\(/, "the engines must stay dynamic imports");
  assert.match(panel, /if \(!flags\.AI_ENABLED\) return null;/);
});

test("the desktop passes a stable products reference", () => {
  // Opening the desktop inbox deliberately loads no catalog, and the hook keys
  // its memo on its arguments — a fresh [] each render would re-run the whole
  // analysis on every keystroke.
  assert.match(desktop, /^const EMPTY_PRODUCTS = \[\];$/m);
  assert.match(desktop, /useAIInboxAnalysis\(selectedConversation, EMPTY_PRODUCTS, currentAgent\)/);
  assert.doesNotMatch(desktop, /useAIInboxAnalysis\(selectedConversation, \[\]/);
});
