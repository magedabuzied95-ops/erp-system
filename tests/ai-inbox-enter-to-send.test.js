import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pwaSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url),
  "utf8"
);

test("AI Inbox composer sends with Enter and advertises the send keyboard action", () => {
  assert.match(pwaSource, /function PwaReplyEditor\(\{[^}]*onSubmit[^}]*disabled/);
  assert.match(pwaSource, /enterKeyHint="send"/);
  assert.match(pwaSource, /if \(event\.key !== "Enter"\) return/);
  assert.match(pwaSource, /submitCurrentText\(event\)/);
  assert.match(pwaSource, /onSubmit=\{sendManualReply\}/);
  assert.match(pwaSource, /disabled=\{sending\}/);
});

test("AI Inbox composer keeps Shift+Enter for an intentional new line", () => {
  assert.match(pwaSource, /if \(event\.shiftKey\) \{/);
  assert.match(pwaSource, /allowLineBreakRef\.current = true/);
  assert.match(pwaSource, /\["insertParagraph", "insertLineBreak"\]\.includes\(inputType\)/);
  assert.match(pwaSource, /if \(allowLineBreakRef\.current\) \{/);
});
