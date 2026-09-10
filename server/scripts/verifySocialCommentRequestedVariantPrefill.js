import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applySocialCommentRequestedVariantToMessage,
  buildPolishedSocialCommentProductReply,
  buildSocialCommentRequestedVariantLines,
  buildSocialCommentSizeQuickReplies,
  matchSocialCommentSizeInput,
  narrowSocialCommentContextToRequest,
  parseSocialCommentSizeQuickReplyPayload,
  resolveSocialCommentRequestedVariant,
} from "../services/socialCommentPrivateReplyService.js";

/* ======================================================
   THE COMMENT ALREADY ANSWERED THE QUESTION
   ------------------------------------------------------
   "42 اسود" under a product post used to buy nothing: the first DM was built from the product
   alone, sent every colour, and asked the colour question anyway.

   What this locks down:
     1. A colour the customer named, in stock and stocking the size they named, narrows the cards
        and the buttons to itself — and the card that goes out is THAT colour's photo.
     2. A colour that does not stock the named size settles nothing; the answer names where the
        size actually is, and the full carousel survives so the customer can see it.
     3. A size ALONE never settles a colour, not even when exactly one colour stocks it. That
        auto-pick is INV-1203.
     4. Nothing recognisable in the comment leaves the message and the context untouched.
====================================================== */

const CONTEXT = {
  __normalized_private_reply_context: true,
  productId: 4,
  productName: "Alexander Mcqueen",
  productImageUrl: "https://cdn.example.com/product-main.jpg",
  productLink: "https://shop.example.com/shop/product/4",
  priceUsed: "1500",
  availableColors: ["Black", "White", "Beige"],
  availableSizes: ["40", "41", "42"],
  availableSizesLabel: "40 | 41 | 42",
  availableVariantRows: [
    { color: "Black", size: "41", stock: 3 },
    { color: "Black", size: "42", stock: 2 },
    { color: "White", size: "40", stock: 4 },
    { color: "White", size: "42", stock: 1 },
    { color: "Beige", size: "40", stock: 5 },
  ],
  colorCards: [
    { colorKey: "black", color: "Black", colorLabel: "أسود", imageUrl: "https://cdn.example.com/black.jpg", productLink: "https://shop.example.com/shop/product/4?color=Black", sizes: ["41", "42"] },
    { colorKey: "white", color: "White", colorLabel: "أبيض", imageUrl: "https://cdn.example.com/white.jpg", productLink: "https://shop.example.com/shop/product/4?color=White", sizes: ["40", "42"] },
    { colorKey: "beige", color: "Beige", colorLabel: "بيج", imageUrl: "https://cdn.example.com/beige.jpg", productLink: "https://shop.example.com/shop/product/4?color=Beige", sizes: ["40"] },
  ],
  carouselEligible: true,
};

const resolve = (commentText) => resolveSocialCommentRequestedVariant({ commentText, normalizedContext: CONTEXT });
const narrow = (commentText) => narrowSocialCommentContextToRequest({
  normalizedContext: CONTEXT,
  requestedVariant: resolve(commentText),
});

// ── 1. Colour + size, both in stock together ──────────────────────────────────────────────────
const blackFortyTwo = resolve("عايز مقاس 42 اسود");
assert.equal(blackFortyTwo.color, "Black", "a typed Arabic colour resolves to the catalog string");
assert.equal(blackFortyTwo.size, "42");
assert.equal(blackFortyTwo.comboAvailable, true);
assert.equal(blackFortyTwo.settledColor, "Black", "an in-stock colour that has the named size settles");
assert.equal(blackFortyTwo.settledSize, "42");

const narrowedToBlack = narrow("عايز مقاس 42 اسود");
assert.deepEqual(narrowedToBlack.availableColors, ["Black"], "only the requested colour is offered");
assert.equal(narrowedToBlack.colorCards.length, 1, "one card, not the whole carousel");
assert.equal(narrowedToBlack.colorCards[0].color, "Black");
assert.equal(narrowedToBlack.carouselEligible, false, "one card is not a carousel");
assert.equal(
  narrowedToBlack.productImageUrl,
  "https://cdn.example.com/black.jpg",
  "the single card must draw the requested colour, not the product's main photo"
);
assert.equal(narrowedToBlack.productLink, "https://shop.example.com/shop/product/4?color=Black");
assert.deepEqual(narrowedToBlack.availableSizes, ["41", "42"], "sizes narrow to the ones this colour has");
assert.equal(narrowedToBlack.requestNarrowed, true);

// ── 2. The colour is real, the size is not in it ──────────────────────────────────────────────
const beigeFortyTwo = resolve("البيج مقاس 42");
assert.equal(beigeFortyTwo.colorAvailable, true, "Beige is in stock");
assert.equal(beigeFortyTwo.comboAvailable, false, "Beige has no 42");
assert.equal(beigeFortyTwo.settledColor, "", "a colour missing the named size settles nothing");
assert.deepEqual(beigeFortyTwo.colorsWithRequestedSize, ["Black", "White"]);

const beigeContext = narrow("البيج مقاس 42");
assert.deepEqual(beigeContext.availableColors, ["Black", "White"], "the cards move to the colours that do have 42");
assert.equal(beigeContext.colorCards.length, 2);
const beigeLines = buildSocialCommentRequestedVariantLines(beigeFortyTwo).join("\n");
assert.ok(beigeLines.includes("42"), "the answer names the size that was asked for");
assert.ok(beigeLines.includes("أسود") && beigeLines.includes("أبيض"), "and says which colours actually have it");
assert.ok(
  beigeLines.includes("بيج") && beigeLines.includes("40"),
  "dropping Beige from the cards is only honest while the text says what Beige does have"
);

// ── 3. A size alone never settles a colour — INV-1203 ─────────────────────────────────────────
const fortyOneOnly = resolve("عندكم 41؟");
assert.equal(fortyOneOnly.size, "41");
assert.equal(fortyOneOnly.color, "");
assert.deepEqual(fortyOneOnly.colorsWithRequestedSize, ["Black"], "only Black stocks a 41");
assert.equal(fortyOneOnly.settledColor, "", "one colour having the size is NOT the customer choosing it");

const fortyOneContext = narrow("عندكم 41؟");
assert.equal(fortyOneContext.availableColors.length, 3, "the colour question must survive a lone size");
assert.equal(fortyOneContext.requestNarrowed, false);
assert.ok(
  buildSocialCommentRequestedVariantLines(fortyOneOnly).join("\n").includes("أسود"),
  "the text still tells the customer where that size lives"
);

// A size two colours share may drop the third — two are still a choice, so nothing is picked.
const fortyTwoOnly = resolve("مقاس 42 متوفر؟");
assert.deepEqual(fortyTwoOnly.colorsWithRequestedSize, ["Black", "White"]);
const fortyTwoContext = narrow("مقاس 42 متوفر؟");
assert.deepEqual(fortyTwoContext.availableColors, ["Black", "White"], "Beige has no 42 and drops out");
assert.equal(fortyTwoContext.colorCards.length, 2);
assert.equal(fortyTwoContext.carouselEligible, true, "two cards with two photos are still a carousel");

// ── 4. Arabic digits, and never a guess between two sizes ─────────────────────────────────────
assert.equal(matchSocialCommentSizeInput("مقاس ٤٢", ["40", "41", "42"]), "42", "Arabic-Indic digits are sizes too");
assert.equal(matchSocialCommentSizeInput("41 ولا 42؟", ["40", "41", "42"]), "", "two sizes is a question, not a choice");
assert.equal(matchSocialCommentSizeInput("السعر 1500", ["40", "41", "42"]), "", "only catalog sizes can match");
assert.equal(matchSocialCommentSizeInput("01142995566", ["40", "41", "42"]), "", "a phone number is not a size");

// ── 5. Nothing recognisable changes nothing ───────────────────────────────────────────────────
const idle = resolve("بكام ده؟");
assert.equal(idle.requested, false);
assert.equal(narrowSocialCommentContextToRequest({ normalizedContext: CONTEXT, requestedVariant: idle }), CONTEXT);
const plain = buildPolishedSocialCommentProductReply({ customerName: "Maged Abuzied", productContext: CONTEXT });
assert.equal(
  applySocialCommentRequestedVariantToMessage({ message: plain, requestedVariant: idle }),
  plain,
  "a comment with nothing in it must leave the message byte-for-byte alone"
);

// ── 6. The copy: the ack lands above the ask, and a settled colour retires the colour question ─
assert.ok(plain.includes("اختار اللون من الأزرار"), "the untouched reply asks for a colour");
// The copy is deliberately short — the cards carry the price, the sizes and the link, and the
// owner cut the carousel explainer and the sign-off on 2026-09-10. A regrowing message is a bug.
assert.ok(plain.split("\n").filter((line) => line.trim()).length <= 3, "the reply stays three lines");
assert.ok(plain.length <= 120, `the reply stays short (was ${plain.length} chars)`);
// The message is rendered from the UN-narrowed product upstream and only meets the comment here,
// so it still carries the colour question while the buttons under it have already become sizes.
const narrowedMessage = applySocialCommentRequestedVariantToMessage({
  message: plain,
  requestedVariant: blackFortyTwo,
});
assert.ok(narrowedMessage.includes("مقاس 42 متاح"), "the reply confirms what the comment asked for");
assert.ok(narrowedMessage.includes("مقاسك"), "and asks for the size instead");
assert.ok(
  !narrowedMessage.includes("اختار اللون"),
  "the colour question is gone once the comment settled the colour"
);
assert.ok(
  narrowedMessage.includes("Maged") && !narrowedMessage.includes("Abuzied"),
  "the greeting uses the first name only — a full profile name wraps onto a second line"
);
const ackIndex = narrowedMessage.indexOf("مقاس 42 متاح");
const askIndex = narrowedMessage.indexOf("مقاسك");
assert.ok(ackIndex >= 0 && askIndex > ackIndex, "the confirmation reads before the ask, not after it");
// A size with no colour keeps the colour question — the answer is added, the ask is untouched.
const sizeOnlyMessage = applySocialCommentRequestedVariantToMessage({ message: plain, requestedVariant: fortyTwoOnly });
assert.ok(sizeOnlyMessage.includes("اختار اللون من الأزرار"), "a lone size must not retire the colour question");
assert.ok(sizeOnlyMessage.includes("مقاس 42 متاح في"), "and the answer still names where that size is");

// ── 7. A narrowed colour still has to be CHOSEN, and the tap must carry it ────────────────────
// This is the whole safety argument: nothing records a colour except a button the customer
// presses, and every size button under a narrowed card names the colour it belongs to.
const narrowedSizeButtons = buildSocialCommentSizeQuickReplies({
  productContext: { product_id: narrowedToBlack.productId, available_sizes: narrowedToBlack.availableSizes },
  selectedColor: narrowedToBlack.availableColors[0],
});
assert.equal(narrowedSizeButtons.length, 2, "the buttons are the sizes this colour has");
for (const button of narrowedSizeButtons) {
  const parsed = parseSocialCommentSizeQuickReplyPayload(button.payload);
  assert.ok(parsed, "a size payload must parse");
  assert.equal(parsed.color, "Black", "a size tap under a narrowed card records the colour too");
}

// ── 8. The comment text has to actually REACH the sender ──────────────────────────────────────
// Everything above passes on a resolver nobody calls. These two hops are the feature.
const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const senderSource = readSource("../services/marketingCommentAutomationService.js");
const resolverCall = senderSource.indexOf("resolveSocialCommentRequestedVariant({");
assert.ok(resolverCall > 0, "sendPrivateReply must resolve what the comment asked for");
assert.ok(
  senderSource.slice(resolverCall, resolverCall + 300).includes("options?.commentText"),
  "the resolver must read the comment text off the send options, not invent one"
);
const unifiedCall = senderSource.indexOf("selectedSource: \"unified_sender\"");
assert.ok(
  senderSource.slice(Math.max(0, unifiedCall - 400), unifiedCall).includes("commentText"),
  "the unified sender must forward the comment text to sendPrivateReply"
);

const workerSource = readSource("../services/backgroundJobs.js");
const workerCall = workerSource.indexOf("sendUnifiedSocialCommentPrivateReply({");
assert.ok(workerCall > 0, "the private-reply worker must still send through the unified sender");
assert.ok(
  workerSource.slice(workerCall, workerCall + 700).includes("commentText"),
  "the worker must hand the customer's own words to the sender"
);

// ── 9. The kill switch actually switches ──────────────────────────────────────────────────────
// This changes the shape of the first DM on every linked post at once, so turning it off has to
// be one restart. A flag that reads its own default wrong is worse than no flag.
const { socialCommentRequestPrefillEnabled } = await import("../services/marketingCommentAutomationService.js");
const previous = process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED;
try {
  delete process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED;
  assert.equal(socialCommentRequestPrefillEnabled(), true, "unset means on");
  process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED = "false";
  assert.equal(socialCommentRequestPrefillEnabled(), false, "false turns it off");
  process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED = "FALSE";
  assert.equal(socialCommentRequestPrefillEnabled(), false, "the switch is not case-sensitive");
  process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED = "true";
  assert.equal(socialCommentRequestPrefillEnabled(), true, "true turns it back on");
} finally {
  if (previous === undefined) delete process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED;
  else process.env.SOCIAL_COMMENT_REQUEST_PREFILL_ENABLED = previous;
}

console.log("verifySocialCommentRequestedVariantPrefill: OK");
