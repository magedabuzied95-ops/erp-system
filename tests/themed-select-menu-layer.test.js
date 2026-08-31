import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_Z_INDEX,
  MENU_BASE_Z_INDEX,
  collectAncestorZIndexes,
  resolveMenuZIndex,
} from "../src/shared/ui/selectMenuLayer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const themedSelectSource = read("src/shared/ui/ThemedSelect.jsx");
const posOnlineOrderSource = read("src/modules/pos/components/PosOnlineOrderModal.jsx");

/*
 * ThemedSelect draws its option list into a portal on the document body, which means the list
 * argues about paint order with every overlay in the app instead of with its own parent. A fixed
 * z-90 lost that argument inside the POS online-order dialog (z-95): the city list opened, filled
 * with Bosta cities, and rendered underneath the dimmer — indistinguishable from a dropdown that
 * does nothing. These guards pin the rule that replaced it.
 */

// Builds a fake ancestor chain, outermost first, and hands back the innermost node — the trigger.
const triggerInside = (...zIndexes) =>
  zIndexes.reduce((parentElement, zIndex) => ({ zIndex: String(zIndex), parentElement }), null);

const readZIndex = (node) => node.zIndex;
const layerOf = (...zIndexes) => resolveMenuZIndex(collectAncestorZIndexes(triggerInside(...zIndexes), readZIndex));

test("a select on a bare page keeps the base layer", () => {
  assert.equal(layerOf("auto", "auto", "auto"), MENU_BASE_Z_INDEX);
});

test("the menu clears the dialog that owns it", () => {
  // The reported defect, exactly: PosOnlineOrderModal's overlay is z-95 and the city list sat at 90.
  assert.equal(layerOf("auto", 95, "auto", "auto"), 96);
  assert.ok(layerOf("auto", 95, "auto", "auto") > 95, "the list must paint above its own dialog");
});

test("the highest ancestor decides, not the nearest one", () => {
  // The dialog carries the layer; the panels between it and the trigger carry small local ones.
  assert.equal(layerOf(120, 2, 1, "auto"), 121);
});

test("the POS fullscreen band is cleared too, without overflowing the browser ceiling", () => {
  assert.equal(layerOf(2147483000, "auto"), 2147483001);
  assert.equal(layerOf(MAX_Z_INDEX), MAX_Z_INDEX, "z-index past 2^31-1 is invalid, not higher");
});

test("elements with no opinion never lower the menu", () => {
  assert.equal(layerOf("auto", 95, "", "-1", "0"), 96);
});

test("the walk covers the trigger and every ancestor up to the root", () => {
  assert.deepEqual(collectAncestorZIndexes(triggerInside("100", "auto", "5"), readZIndex), ["5", "auto", "100"]);
  assert.deepEqual(collectAncestorZIndexes(null, readZIndex), []);
});

test("ThemedSelect derives the menu layer instead of hard-coding one", () => {
  assert.match(
    themedSelectSource,
    /import \{ collectAncestorZIndexes, resolveMenuZIndex \} from "\.\/selectMenuLayer";/,
    "ThemedSelect must use the shared layer rule"
  );
  assert.match(
    themedSelectSource,
    /zIndex: resolveMenuZIndex\(collectAncestorZIndexes\(trigger, \(node\) => window\.getComputedStyle\(node\)\.zIndex\)\)/,
    "the layer must be measured from the trigger's real ancestors, on open"
  );
  assert.match(themedSelectSource, /zIndex: position\.zIndex,/, "the measured layer must reach the portalled menu");
  assert.doesNotMatch(
    themedSelectSource,
    /className=\{`z-\[\d+\]/,
    "a literal z-index class on the menu would silently outrank the measured one"
  );
});

test("the POS online-order dialog still declares the layer the pickers have to clear", () => {
  // If this dialog ever stops being a z-indexed overlay the guard above stops proving anything,
  // so the scenario itself is pinned rather than assumed.
  assert.match(posOnlineOrderSource, /fixed inset-0 z-\[\d+\]/, "the modal is a stacked overlay above the till");
  assert.match(posOnlineOrderSource, /import ThemedSelect from/, "its city/zone/district pickers are ThemedSelects");
});
