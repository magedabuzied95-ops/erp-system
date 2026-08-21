import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as shared from "../src/modules/aiSupport/lib/conversationHelpers.js";

const desktop = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8").split(/\r?\n/);
const pwa = readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8").split(/\r?\n/);

const DECL = /^const ([A-Za-z0-9_]+)\s*=/;
const topLevelConsts = (lines) => {
  const names = new Set();
  for (const line of lines) {
    const m = DECL.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
};

/*
 * The two AI Inbox surfaces are separate implementations of the same product.
 * They still define helpers under the same name in both files — 45 of them,
 * with genuinely different behaviour that has to be reconciled one at a time.
 * `firstNonEmpty` is a good example of why one at a time: the two spellings look
 * interchangeable, but the desktop routes every value through a `clean` that
 * uses `||`, so firstNonEmpty(0, "x") answers "x" there and "0" in the PWA.
 *
 * This number is a RATCHET, not a target. It may go down as helpers converge or
 * move into the shared module. It may not go up: a new same-named helper in both
 * pages is a new place for a fix to land on one surface and not the other, which
 * is exactly how the private reply path got a nameless-greeting guard that the
 * public path did not.
 *
 * If this fails after you added a helper: put it in
 * src/modules/aiSupport/lib/conversationHelpers.js and import it in both pages.
 * If it fails after you REMOVED one, lower the number.
 */
const MAX_DUPLICATED_HELPERS = 45;

test("duplicated helpers between the two inbox surfaces do not increase", () => {
  const desktopNames = topLevelConsts(desktop);
  const pwaNames = topLevelConsts(pwa);
  const duplicated = [...desktopNames].filter((name) => pwaNames.has(name)).sort();

  assert.ok(
    duplicated.length <= MAX_DUPLICATED_HELPERS,
    `${duplicated.length} helpers are defined in BOTH inbox pages (budget ${MAX_DUPLICATED_HELPERS}).\n` +
    `New ones: put them in src/modules/aiSupport/lib/conversationHelpers.js.\n` +
    duplicated.join(", ")
  );
});

test("the shared helpers are defined once, in the shared module", () => {
  const desktopNames = topLevelConsts(desktop);
  const pwaNames = topLevelConsts(pwa);
  for (const name of Object.keys(shared)) {
    assert.ok(!desktopNames.has(name), `${name} is still defined locally in AiInbox.jsx`);
    assert.ok(!pwaNames.has(name), `${name} is still defined locally in AiInboxPwa.jsx`);
  }
});

test("both pages import from the shared module", () => {
  for (const [label, lines] of [["desktop", desktop], ["pwa", pwa]]) {
    const source = lines.join("\n");
    assert.match(source, /from "\.\.\/lib\/conversationHelpers"/, `${label} must import the shared helpers`);
  }
});

test("the extracted helpers still behave the way both pages relied on", () => {
  // Moved verbatim, so this is a characterisation test: it pins the behaviour
  // the two surfaces were each getting before the move.
  assert.equal(shared.clean("  hi  "), "hi");
  assert.equal(shared.clean(null), "");
  assert.equal(shared.clean(undefined), "");
  assert.deepEqual(shared.asArray([1, 2]), [1, 2]);
  assert.deepEqual(shared.asArray("nope"), []);

  // A conversation id can contain a colon (whatsapp:lid:123), so the endpoint
  // builders have to encode it or the path splits in the wrong place.
  assert.equal(shared.encodeConversationId("whatsapp:lid:123"), encodeURIComponent("whatsapp:lid:123"));
  assert.match(shared.aiInboxConversationEndpoint("whatsapp:lid:123", "/send"), /%3A/);

  // Generic placeholder names must never be shown as a customer's name.
  assert.equal(shared.isGenericCustomerName("عميل"), true);
  assert.equal(shared.isGenericCustomerName("Customer"), true);
  assert.equal(shared.isGenericCustomerName("Maged"), false);
});

test("every client request id is unique", () => {
  // Sends are deduped by client_request_id, so a collision silently drops a
  // message the operator believes they sent.
  const ids = new Set(Array.from({ length: 500 }, () => shared.buildClientRequestId()));
  assert.equal(ids.size, 500);
});
