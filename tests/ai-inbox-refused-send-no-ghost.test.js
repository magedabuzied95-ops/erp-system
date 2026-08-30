import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A send the server REFUSES (24h window closed, duplicate address link) never reaches the provider
// and never stores a row. The AI Inbox used to paint a failed bubble for it anyway. That bubble keeps
// its client-only `sending-…` id forever, so cache reconciliation read it as "still in flight" and
// saveThread persisted it — one refusal per retry, stacked beside the single real failed row the
// server did store. Hana Hesham's Messenger thread showed six identical failure bubbles while the
// database held exactly one row (id 706435, 2026-08-29 11:46:36 UTC).
//
// The contract this rests on: a refusal answers `sent: false` and carries NO `failed_message`.

const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const inboxRoutes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
const cacheStore = readFileSync(new URL("../src/modules/aiSupport/services/inboxCache/inboxCacheStore.js", import.meta.url), "utf8");

test("every outbound refusal answers sent:false so the client can tell it from a real failure", () => {
  for (const code of ["OUTBOUND_WINDOW_CLOSED", "ADDRESS_LINK_ALREADY_SENT"]) {
    const refusal = inboxRoutes.slice(0, inboxRoutes.indexOf(code));
    const body = refusal.slice(refusal.lastIndexOf("return res.status("));
    assert.match(body, /sent: false/, `${code} must answer sent:false`);
  }
});

test("a refusal carries no failed_message — nothing was stored to echo back", () => {
  const guardBody = inboxRoutes.slice(
    inboxRoutes.indexOf("OUTBOUND_WINDOW_CLOSED") - 400,
    inboxRoutes.indexOf("OUTBOUND_WINDOW_CLOSED") + 400
  );
  assert.doesNotMatch(guardBody, /failed_message/);
});

test("the 24h-window burst guard still gates Meta sends", () => {
  assert.match(inboxRoutes, /const recentWindowFailureBlock = async/);
  assert.match(inboxRoutes, /if \(!mockDelivery && isMetaConversation\) \{\s*\n\s*const recentWindowError = await recentWindowFailureBlock/);
});

test("the inbox drops the optimistic bubble when the server refused without sending", () => {
  assert.match(inbox, /const refusedWithoutSending = err\?\.responseBody\?\.sent === false && !failedMessage;/);
  // The refusal arm filters the bubble out; it must not fall through to the "mark it failed" arm.
  const branch = inbox.slice(inbox.indexOf("const refusedWithoutSending"), inbox.indexOf("const refusedWithoutSending") + 900);
  assert.match(branch, /refusedWithoutSending\s*\n?\s*\?\s*asArray\(conversation\.messages\)\.filter\(\(item\) => item\.id !== optimistic\.id\)/);
});

test("a transport error still keeps its bubble — it proves nothing about what happened", () => {
  // The guard is `sent === false`, not a truthiness/negation test, so an absent responseBody
  // (fetch/network failure) can never satisfy it.
  assert.doesNotMatch(inbox, /const refusedWithoutSending = !err\?\.responseBody\?\.sent/);
  assert.match(inbox, /=== false && !failedMessage;/);
});

test("reconciliation can evict a terminal client-only bubble, not just server-id ones", () => {
  assert.match(cacheStore, /const terminalClientOnly = !hasServerId && clean\(message\?\.delivery_status\) === "failed";/);
  assert.match(cacheStore, /if \(!hasServerId && !terminalClientOnly\) return true;/);
});
