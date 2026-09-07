import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ======================================================
   SOCIAL COMMENT SALES FLOW — SCRIPTED REPLIES MUST SURVIVE
   ------------------------------------------------------
   Order 1203 (Messenger, 2026-09-07) was created correctly, but the customer
   read "ابعتلي اسمك ورقمك لو تحب نكمل." instead of "تم تأكيد طلبك بنجاح" and
   sent their shipping data all over again.

   sendAndLogMetaText hands its text to orchestrateFinalReply, which THROWS THE
   TEXT AWAY and regenerates one from the conversation — and with no product
   price in scope the price guard's fallback is an ask for name and phone. The
   sales flow's scripted lines are not suggestions, so they must go out through
   sendSocialCommentSalesFlowText (force_reply_text_passthrough) instead.

   This is a source sweep: it fails the moment a social_comment_sales_flow_*
   reply is wired back to the raw sender.
====================================================== */

const source = readFileSync(
  fileURLToPath(new URL("../services/metaIntegrationService.js", import.meta.url)),
  "utf8"
);

// Walk back from each scripted intent to the call that carries it.
const SENDER_OPEN = /await (sendAndLogMetaText|sendSocialCommentSalesFlowText)\(\{/g;

const senderForOffset = (offset) => {
  SENDER_OPEN.lastIndex = 0;
  let sender = "";
  let match = null;
  while ((match = SENDER_OPEN.exec(source)) !== null) {
    if (match.index > offset) break;
    sender = match[1];
  }
  return sender;
};

const intentPattern = /detectedIntent:\s*"(social_comment_[a-z0-9_]+)"/g;
const offenders = [];
let seen = 0;
let hit = null;
while ((hit = intentPattern.exec(source)) !== null) {
  seen += 1;
  const sender = senderForOffset(hit.index);
  if (sender !== "sendSocialCommentSalesFlowText") {
    const line = source.slice(0, hit.index).split("\n").length;
    offenders.push(`${hit[1]} (line ${line}) is sent through ${sender || "an unknown sender"}`);
  }
}

assert.ok(seen >= 8, `expected the sales flow to still script its replies, found ${seen}`);
assert.deepEqual(
  offenders,
  [],
  `social comment sales flow replies must keep their scripted text:\n  - ${offenders.join("\n  - ")}`
);

// The passthrough flag is the whole point of the wrapper; if it ever stops
// setting it, every assertion above passes while the bug comes straight back.
const wrapperStart = source.indexOf("const sendSocialCommentSalesFlowText = async ({");
assert.ok(wrapperStart > 0, "sendSocialCommentSalesFlowText is gone");
const wrapperBody = source.slice(wrapperStart, wrapperStart + 2600);
assert.match(
  wrapperBody,
  /force_reply_text_passthrough: true/,
  "sendSocialCommentSalesFlowText no longer preserves the scripted reply text"
);

// And the flag has to still mean something inside the sender.
assert.match(
  source,
  /const preserveReplyText = Boolean\(metadata\?\.force_reply_text_passthrough\);/,
  "sendAndLogMetaText no longer honours force_reply_text_passthrough"
);

console.log(`social comment sales flow reply passthrough OK (${seen} scripted replies checked)`);
