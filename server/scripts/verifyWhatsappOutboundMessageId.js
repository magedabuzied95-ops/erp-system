import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { providerMessageIdFromSendResponse } from "../services/aiChannelAdapterService.js";

/* ======================================================
   THE WHATSAPP DUPLICATE WAS NEVER A SECOND SEND
   ------------------------------------------------------
   Ten outbound rows in a week were written twice: once by us with an EMPTY provider id, then
   again 1-3 seconds later by delivery reconciliation carrying the Evolution id. The customer
   received one message each time; the inbox showed two.

   The cause was one read. Cloud answers { messages: [{ id: wamid }] }; Evolution answers
   { success, instanceName, result: <baileys> } with the id at result.key.id. The reader knew only
   the Cloud shapes, so every Evolution send — text, image, carousel — stored no provider id, and
   a row with no provider id cannot be matched to its own echo.
====================================================== */

// ── Every shape these transports actually return ──────────────────────────────────────────────
assert.equal(
  providerMessageIdFromSendResponse({ success: true, instanceName: "m1", result: { key: { id: "3EB0BE2C1C6E1D07A2249B" } } }),
  "3EB0BE2C1C6E1D07A2249B",
  "an Evolution send puts its id at result.key.id — missing it is the whole bug"
);
assert.equal(
  providerMessageIdFromSendResponse({ messages: [{ id: "wamid.HBgMMjAx" }] }),
  "wamid.HBgMMjAx",
  "the Cloud shape must keep working"
);
assert.equal(providerMessageIdFromSendResponse({ message_id: "abc" }), "abc");
assert.equal(providerMessageIdFromSendResponse({ result: { message_id: "r1" } }), "r1");
assert.equal(providerMessageIdFromSendResponse({ result: { messageId: "r2" } }), "r2");
assert.equal(providerMessageIdFromSendResponse({ key: { id: "bare" } }), "bare", "a bare baileys response is still an id");
assert.equal(providerMessageIdFromSendResponse({ id: "plain" }), "plain", "a transport that answers with a bare id must not be dropped");

// ── Nothing invented when there is nothing to read ────────────────────────────────────────────
assert.equal(providerMessageIdFromSendResponse(null), "");
assert.equal(providerMessageIdFromSendResponse({}), "");
assert.equal(providerMessageIdFromSendResponse({ success: true, result: {} }), "");
assert.equal(providerMessageIdFromSendResponse({ messages: [] }), "");

// ── The specific id wins over the generic one ─────────────────────────────────────────────────
// Evolution's envelope carries instanceName and phone at the top level; an `id` there would not
// be the message's. The nested key must outrank it.
assert.equal(
  providerMessageIdFromSendResponse({ id: "envelope", result: { key: { id: "message" } } }),
  "message",
  "the message id must outrank whatever the envelope calls id"
);

// ── The reader is the one the sender uses ─────────────────────────────────────────────────────
const adapter = readFileSync(fileURLToPath(new URL("../services/aiChannelAdapterService.js", import.meta.url)), "utf8");
assert.match(
  adapter,
  /const messageId = providerMessageIdFromSendResponse\(response\);/,
  "trackSuccess must read through this function, or the shapes above prove nothing"
);
assert.match(
  adapter,
  /message_id: firstMessageId \|\| "",/,
  "the id it finds has to reach the caller that stores it"
);

// ── And the shape it reads is the shape the gateway returns ───────────────────────────────────
// Asserting the two files agree: a sender that stopped returning `result` would silently empty
// the provider id again, and the duplicate would come straight back.
const gateway = readFileSync(fileURLToPath(new URL("../services/whatsappGatewayService.js", import.meta.url)), "utf8");
assert.match(
  gateway,
  /return \{\s*success: true,\s*provider: current\.provider,\s*instanceName: current\.instanceName,\s*phone,\s*result: data,/,
  "the Evolution button/carousel sender must keep returning the raw response under `result`"
);
assert.match(
  gateway,
  /return \{ success: true, provider: current\.provider, instanceName: current\.instanceName, phone: sendTarget, result: data \};/,
  "the Evolution text sender must keep returning the raw response under `result`"
);

console.log("whatsapp outbound message id OK");
