import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  customerSizeLabel,
  customerSizeLabels,
  matchOfferedSize,
} from "../server/services/footwearSizeResolver.js";
import {
  buildSocialCommentOrderPreviewMessage,
  buildSocialCommentOrderReviewMessage,
  buildSocialCommentOrderSummaryMessage,
  buildSocialCommentOrderSummaryMessageV2,
  buildSocialCommentSizeQuickReplies,
  SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX,
} from "../server/services/socialCommentPrivateReplyService.js";
import { orchestrateAiResponse } from "../server/services/aiResponseOrchestratorService.js";

// Crocs are stocked under the factory marking (M6/W8) but the site prints the EU pair (38/39).
// Every size the chat sales flow shows a customer must read like the site; the payloads, the
// stored state and the order keep the marking.

const source = (file) => readFileSync(new URL(`../server/services/${file}`, import.meta.url), "utf8");

test("a Crocs marking reads as its EU pair; any other size reads as stored", () => {
  assert.equal(customerSizeLabel("M6/W8"), "38/39");
  assert.equal(customerSizeLabel("C10"), "27/28");
  assert.equal(customerSizeLabel("38/39"), "38/39");
  assert.equal(customerSizeLabel("42"), "42");
  assert.equal(customerSizeLabel("XL"), "XL");
  assert.deepEqual(customerSizeLabels(["J3", "M3/W5", "M6/W8", "42"]), ["34/35", "38/39", "42"]);
});

test("a typed EU size maps back to the offered stock marking", () => {
  const offered = ["C10", "J3", "M6/W8", "M7/W9"];
  assert.equal(matchOfferedSize("38/39", offered), "M6/W8");
  assert.equal(matchOfferedSize("38 / 39", offered), "M6/W8");
  assert.equal(matchOfferedSize("M6/W8", offered), "M6/W8");
  assert.equal(matchOfferedSize("27", offered), "C10");
  // 39 is in both 38/39 and 39/40 — ambiguous, so nothing is guessed.
  assert.equal(matchOfferedSize("39", offered), "");
  assert.equal(matchOfferedSize("44/45", offered), "");
  // Ordinary footwear stays an exact match.
  assert.equal(matchOfferedSize("41", ["40", "41"]), "41");
  assert.equal(matchOfferedSize("41/42", ["40", "41"]), "");
});

test("Messenger/Instagram size buttons read EU; the payload keeps the marking", () => {
  const replies = buildSocialCommentSizeQuickReplies({
    productContext: { product_id: 7, available_sizes: ["M6/W8", "J3", "M3/W5"] },
    selectedColor: "Black",
  });
  assert.deepEqual(replies.map((reply) => reply.title).sort(), ["34/35", "38/39"]);
  const payloads = replies.map((reply) => JSON.parse(reply.payload.slice(SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX.length)));
  assert.ok(payloads.some((payload) => payload.size === "M6/W8"));
  assert.ok(payloads.every((payload) => ["M6/W8", "J3", "M3/W5"].includes(payload.size)));
  const plain = buildSocialCommentSizeQuickReplies({ productContext: { product_id: 7, available_sizes: ["41", "42"] } });
  assert.deepEqual(plain.map((reply) => reply.title), ["41", "42"]);
});

test("the private-reply order summaries, preview and review print EU", () => {
  const order = { productName: "Crocband", selectedSize: "M6/W8", selectedColor: "Black", priceUsed: "300" };
  assert.match(buildSocialCommentOrderSummaryMessage(order), /المقاس: 38\/39/);
  assert.match(buildSocialCommentOrderSummaryMessageV2(order), /المقاس: 38\/39/);
  assert.match(buildSocialCommentOrderPreviewMessage(order), /المقاس\n38\/39/);
  assert.match(buildSocialCommentOrderReviewMessage(order), /المقاس\n38\/39/);
  for (const build of [buildSocialCommentOrderSummaryMessageV2, buildSocialCommentOrderReviewMessage]) {
    assert.doesNotMatch(build(order), /M6\/W8/);
  }
});

test("the Meta sales flow prints every chosen size through the label and reads typed EU sizes", () => {
  const meta = source("metaIntegrationService.js");
  assert.match(meta, /`المقاس: \$\{customerSizeLabel\(selectedSize\)\}`/);
  assert.match(meta, /المقاس \$\{customerSizeLabel\(selectedSize\)\} متوفر/);
  assert.match(meta, /`المقاس \$\{customerSizeLabel\(selectedSize\)\} مش متوفر في اللون/);
  assert.match(meta, /`المقاس \$\{customerSizeLabel\(selectedSize\)\} غير متوفر حالياً/);
  assert.match(meta, /size \? `المقاس: \$\{customerSizeLabel\(size\)\}`/);
  assert.match(meta, /return customerSizeLabels\(sorted\)\.join/);
  assert.match(meta, /option === typed\) \|\| matchOfferedSize\(typed, offered\)/);
  assert.doesNotMatch(meta, /`المقاس: \$\{text\(selectedSize\)\}`/);
});

test("the WhatsApp sales flow lists and summarises EU, with row ids still on the marking", () => {
  const whatsapp = source("whatsappSalesFlowService.js");
  assert.match(whatsapp, /title: customerSizeLabel\(size\),/);
  assert.match(whatsapp, /rowId: buildSizeRowId\(\{ productId, color, size \}\)/);
  assert.match(whatsapp, /المقاسات المتاحة في اللون ده:\\n\$\{customerSizeLabels\(sizes\)\.join/);
  assert.match(whatsapp, /`📏 المقاس: \$\{customerSizeLabel\(size\)\}`/);
  assert.match(whatsapp, /const matched = matchOfferedSize\(body, sizes\)/);
});

test("AI reply templates fill {size} and {sizes} with EU", () => {
  const product = { id: 1, name: "Crocband", product_type: "Crocs" };
  const asked = orchestrateAiResponse({
    intent: "SIZE_CHECK",
    customerMessage: "المقاسات",
    selectedProduct: product,
    productContext: { productId: 1, productName: "Crocband" },
    availableSizes: ["M6/W8", "M7/W9"],
    price: "300",
  });
  assert.doesNotMatch(asked.replyText, /M6\/W8|M7\/W9/);
  assert.match(asked.replyText, /38\/39/);
  const unavailable = orchestrateAiResponse({
    intent: "SIZE_CHECK",
    customerMessage: "عندك 38/39",
    selectedProduct: product,
    selectedSize: "M6/W8",
    productContext: { productId: 1, productName: "Crocband", sizeAvailable: false },
    availableSizes: ["M7/W9"],
    price: "300",
  });
  assert.doesNotMatch(unavailable.replyText, /M6\/W8|M7\/W9/);
  assert.match(unavailable.replyText, /39\/40/);
  assert.match(source("aiUnifiedDecisionService.js"), /const sizeLabel = customerSizeLabel\(requestedSize\);/);
});
