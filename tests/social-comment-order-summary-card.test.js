import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The last step before a customer confirms used to be a paragraph: product, size, colour, price,
// with the two buttons floating underneath as quick replies. It should show what they picked —
// the chosen colour's own photo, that colour-and-size's price, and the buttons ON the card.
// These guards keep the three things that make it arrive, and the one that keeps it safe:
// the card carries the payloads the confirm step already listens for, Instagram is not excluded,
// the picture is the VARIANT's, and a refused template still leaves the customer a way to confirm.

const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);

const builder = meta.slice(
  meta.indexOf("const buildSocialCommentOrderSummaryCardPayload = ({"),
  meta.indexOf("const sendSocialCommentOrderSummaryCard = async ({")
);
const sender = meta.slice(
  meta.indexOf("const sendSocialCommentOrderSummaryCard = async ({"),
  meta.indexOf("// The one live address link for this conversation.")
);
const summary = meta.slice(
  meta.indexOf("const sendOrderSummary = async ({"),
  meta.indexOf("// Colour settled → offer the sizes THAT COLOUR actually has.")
);

test("the card carries the payloads the confirm step already listens for", () => {
  // legacyActionFromPayload maps a bare ORDER_CONFIRM/ORDER_CANCEL to confirm/cancel, and
  // socialCommentQuickReplyPayloadFromMessage reads postback_payload as readily as a quick reply.
  // Renaming either payload here silently turns both buttons into dead pixels.
  assert.match(
    builder,
    /\{ type: "postback", title: "✅ تأكيد الطلب", payload: "ORDER_CONFIRM" \}/,
    "confirm is a postback carrying ORDER_CONFIRM"
  );
  assert.match(
    builder,
    /\{ type: "postback", title: "❌ إلغاء الطلب", payload: "ORDER_CANCEL" \}/,
    "cancel is a postback carrying ORDER_CANCEL"
  );
  assert.match(meta, /rawPayload\.startsWith\("ORDER_CONFIRM"\)\s*\n?\s*\?\s*"confirm"/, "and the handler still resolves that payload");
});

test("Instagram gets the same card, minus the field its template does not carry", () => {
  assert.match(
    sender,
    /!\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\.includes\(channel\)/,
    "both Meta channels may receive the card"
  );
  assert.match(builder, /template_type: "generic"/, "the same generic template the colour carousel proves on Instagram");
  assert.match(
    builder,
    /\.\.\.\(isMessenger \? \{ image_aspect_ratio: "square" \} : \{\}\)/,
    "image_aspect_ratio is a Messenger field; Instagram rejects the payload that carries it"
  );
  assert.match(sender, /await postMetaMessageWithThreadControl\(\{/, "the card rides the sender that knows about graph.instagram.com");
});

test("the picture and the price are the chosen COLOUR's, not the product's roll-up", () => {
  // resolveSocialCommentSalesFlowDraftOrderData returns the variant row's own image and the price
  // of that exact colour+size. The product cover quotes one photo and one number for every colour.
  assert.match(
    summary,
    /imageUrl: text\(summaryVariantData\?\.productImageUrl \|\| productData\?\.productImageUrl \|\| ""\)/,
    "the variant's photo wins over the cover"
  );
  assert.match(
    summary,
    /const summaryPriceUsed = text\(summaryVariantData\?\.selectedPriceText \|\| ""\)/,
    "and the variant's price wins over the product's"
  );
  assert.match(builder, /اللون: \$\{colorLabel\}/, "the subtitle names the colour");
  assert.match(builder, /المقاس: \$\{text\(selectedSize\)\}/, "and the size");
});

test("a card that cannot be built or sent still leaves the customer a way to confirm", () => {
  // Meta drops an element whose image_url it cannot fetch, and a relative /uploads path renders
  // blank — so no absolute photo means the text summary, which carries the same two quick replies.
  assert.match(
    sender,
    /const absoluteImageUrl = absolutePublicUploadUrl\(text\(imageUrl\)\)/,
    "the path gets the backend origin before Meta is asked to fetch it"
  );
  assert.match(
    sender,
    /if \(!recipientId \|\| !\/\^https\?:\\\/\\\/\/i\.test\(absoluteImageUrl\)\) return false;/,
    "no absolute photo ⇒ no card"
  );
  assert.match(sender, /catch \(error\) \{[\s\S]{0,400}?return false;\s*\}\s*\};/, "and a throw returns false rather than escaping the sales flow");
  assert.match(sender, /\}\)\.catch\(\(error\) => \{[\s\S]{0,400}?return null;\s*\}\);\s*if \(!result\) return false;/, "a Meta rejection is caught at the POST, not left to reject");
  const fallback = summary.slice(summary.indexOf("const summaryCardSent = await sendSocialCommentOrderSummaryCard"));
  assert.match(fallback, /if \(summaryCardSent\) \{/, "the text path runs only when the card did not");
  assert.match(fallback, /const reviewResult = await sendSocialCommentSalesFlowText\(\{/, "and that path is the one that shipped before");
  assert.match(summary, /quickReplies,/, "with its quick replies intact");
});

test("the card replaces the paragraph instead of repeating it", () => {
  // Owner decree on duplicate labels: the same four lines printed under a picture of them is noise.
  const cardBranch = summary.slice(
    summary.indexOf("if (summaryCardSent) {"),
    summary.indexOf("const reviewResult = await sendSocialCommentSalesFlowText({")
  );
  assert.ok(cardBranch.length > 0, "the card branch is gone");
  assert.doesNotMatch(cardBranch, /summaryMessage/, "the text summary must not go out beside the card");
  assert.match(cardBranch, /return \{ sent: true, surface: "card" \};/, "the card branch returns before the text send");
});
