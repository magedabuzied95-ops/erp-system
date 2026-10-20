import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { customerWaitingSince } from "../src/modules/aiSupport/lib/conversationHelpers.js";

const at = (minute) => new Date(Date.UTC(2026, 9, 21, 10, minute)).toISOString();
const row = (kind, minute) => ({ kind, message: { created_at: at(minute) } });

test("the wait starts at the first customer message after our last reply", () => {
  const rows = [row("customer", 0), row("ai", 1), row("customer", 5), row("customer", 9)];
  assert.equal(customerWaitingSince(rows), Date.parse(at(5)));
});

test("nobody is waiting when the newest message is ours", () => {
  for (const kind of ["staff", "ai", "product_card"]) {
    assert.equal(customerWaitingSince([row("customer", 0), row(kind, 2)]), 0, kind);
  }
});

test("a thread with only customer messages waits from the first one", () => {
  assert.equal(customerWaitingSince([row("customer", 3), row("customer", 1)]), Date.parse(at(1)));
  assert.equal(customerWaitingSince([]), 0);
});

test("the desktop reply box draws the clock from the open thread", () => {
  const source = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
  assert.match(source, /customerWaitingSince\(selectedTranscriptRows\)/);
  assert.equal(source.split("customerWaitingSinceAt={selectedCustomerWaitingSince}").length - 1, 2);
  assert.match(source, /<ReplyWaitClock since=\{customerWaitingSinceAt\} \/>/);
});
