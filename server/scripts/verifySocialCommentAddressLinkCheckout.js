import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ======================================================
   THE ADDRESS CARD IS THE CHECKOUT
   ------------------------------------------------------
   Bosta will not accept a shipment without a city, a zone, a district and a building number.
   A line of free text in a Messenger bubble cannot produce any of them — the directory has 555
   zones and 3580 districts — so INV-1215's shipment form opened completely empty.

   After "✅ تأكيد الطلب" the flow now sends a CARD whose one button opens the address form as a
   sheet inside Messenger (`webview_height_ratio`, no domain whitelisting needed), and the
   customer's submit is what registers the order. What this pins down:

     1. The confirm step no longer asks for an address as text.
     2. The button really is a webview, not a plain link out to a browser.
     3. Submitting the address creates the order, and the Bosta ids reach it.
     4. Typing an address at that step re-sends the link instead of parsing text Bosta cannot use.
====================================================== */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const metaService = read("../services/metaIntegrationService.js");
const addressService = read("../services/conversationAddressRequestService.js");

// ── 1. Confirm hands over the address form ────────────────────────────────────────────────────
const confirmStart = metaService.indexOf('if (resolvedAction === "confirm") {');
assert.ok(confirmStart > 0, "the confirm branch is gone");
const confirmBody = metaService.slice(confirmStart, metaService.indexOf('reason: "social_comment_sales_flow_confirmed"', confirmStart));
assert.match(
  confirmBody,
  /await buildSocialCommentAddressLink\(/,
  "confirming must mint the address link"
);
assert.match(
  confirmBody,
  /await sendSocialCommentAddressCard\(/,
  "confirming must send the address card"
);
assert.match(
  confirmBody,
  /addressLink \? "awaiting_address_link" : "awaiting_customer_data"/,
  "the flow must move to the address-link step whenever a link exists"
);
// The old text ask survives ONLY as the no-public-url fallback, never as the first choice.
const textAskIndex = confirmBody.indexOf("لإتمام الطلب برجاء إرسال بيانات الشحن");
assert.ok(textAskIndex > 0, "the text fallback should still exist for a deployment with no public URL");
assert.ok(
  confirmBody.indexOf("addressCardSent") < textAskIndex,
  "the card path must be chosen before the text ask, not after it"
);

// ── 2. The button opens INSIDE Messenger ──────────────────────────────────────────────────────
const cardStart = metaService.indexOf("const buildSocialCommentAddressCardPayload");
assert.ok(cardStart > 0, "the address card builder is gone");
const cardBody = metaService.slice(cardStart, metaService.indexOf("const sendSocialCommentAddressCard", cardStart));
assert.match(cardBody, /template_type: "generic"/, "the card must be a generic template");
assert.match(cardBody, /type: "web_url"/, "the card's button must be a web_url button");
assert.match(
  cardBody,
  /webview_height_ratio: "tall"/,
  "without webview_height_ratio the button throws the customer out to a browser"
);
// Messenger defaults a generic template to "horizontal", which crops a shoe into a letterbox
// strip — the difference between the small card the owner saw and the full-size ones.
assert.match(
  cardBody,
  /image_aspect_ratio: "square"/,
  "the card must ship square or Messenger crops the photo into a thin strip"
);
assert.match(cardBody, /priceUsed/, "the card must carry a price");

// The comment→DM cards go out from a different service and were the ones arriving small. They
// default to square for Messenger — but image_aspect_ratio is a MESSENGER-only field, so the
// Instagram caller must opt out of it or Instagram's template reference refuses the payload.
const { buildSocialCommentMessengerCarouselPayload, buildSocialCommentInstagramPrivateReplyPayload } = await import(
  "../services/marketingCommentAutomationService.js"
);
const colorCards = ["Black", "White"].map((color, index) => ({
  color,
  colorLabel: color,
  productName: "Test",
  imageUrl: `https://cdn.example.com/${index}.jpg`,
  productLink: "https://shop.example.com/p",
  sizes: ["41", "42"],
}));
const messengerCarousel = buildSocialCommentMessengerCarouselPayload({
  commentId: "123",
  postId: "P1",
  productId: 769,
  colorCards,
  productName: "Test",
  productPrice: "900",
});
assert.equal(
  messengerCarousel?.message?.attachment?.payload?.image_aspect_ratio,
  "square",
  "a comment→DM Messenger carousel must ship square or the photo arrives cropped small"
);

// The colour choice must live ON the card. Quick replies are ephemeral — Messenger shows them
// only under the newest message, so any card or message arriving after the text wipes them and
// the customer is left with no way to pick a colour at all.
const firstElement = messengerCarousel?.message?.attachment?.payload?.elements?.[0] || {};
const colorButton = (firstElement.buttons || []).find((button) => button?.type === "postback");
assert.ok(colorButton, "every colour card needs its own postback button to choose that colour");
assert.ok(
  colorButton.payload.startsWith("SOCIAL_COLOR_SELECT::"),
  "the card button must carry the same payload the colour quick replies use, so one handler serves both"
);
assert.deepEqual(
  JSON.parse(colorButton.payload.slice("SOCIAL_COLOR_SELECT::".length)),
  { color: "Black", size: "", product_id: 769, post_id: "P1", comment_id: "123", conversation_id: "" },
  "the card button must name its colour and product"
);
assert.ok(colorButton.payload.length <= 1000, "Meta caps a postback payload at 1000 characters");
assert.ok(
  [...colorButton.title].length <= 20,
  "Meta caps a button title at 20 characters"
);
const instagramPlan = buildSocialCommentInstagramPrivateReplyPayload({
  commentId: "123",
  normalizedContext: { carouselEligible: true, colorCards, productName: "Test", priceUsed: "900" },
});
assert.equal(
  "image_aspect_ratio" in (instagramPlan?.payload?.message?.attachment?.payload || {}),
  false,
  "image_aspect_ratio is Messenger-only; Instagram's template must not carry it"
);

// The card prices and pictures the exact variant, not the product roll-up.
assert.match(
  confirmBody,
  /resolveSocialCommentSalesFlowDraftOrderData\(\{[\s\S]{0,200}selectedColor,/,
  "the confirm card must price the chosen colour and size, not the product roll-up"
);

// ── 3. The submit registers the order, carrying Bosta's ids ───────────────────────────────────
assert.match(
  addressService,
  /completeSocialCommentOrderFromAddressRequest/,
  "submitting the address must be able to close the pending Messenger order"
);
// Failure-isolated: an order that cannot be created must not cost the customer their address.
const submitHookStart = addressService.indexOf("completeSocialCommentOrderFromAddressRequest");
const submitHookBody = addressService.slice(Math.max(0, submitHookStart - 600), submitHookStart + 600);
assert.match(submitHookBody, /try \{/, "the order hook must not be able to fail the address submit");
assert.match(submitHookBody, /catch \(error\)/, "the order hook must catch its own failures");

const completeStart = metaService.indexOf("export const completeSocialCommentOrderFromAddressRequest");
assert.ok(completeStart > 0, "the address-submit order path is gone");
const completeBody = metaService.slice(completeStart, metaService.indexOf("export const dispatchSocialCommentMessengerQuickReplySelection", completeStart));
assert.match(
  completeBody,
  /structuredAddress: address/,
  "the submitted Bosta address must reach the order"
);
assert.match(
  completeBody,
  /!productId \|\| !selectedColor \|\| !selectedSize/,
  "an address submitted on a chat with no settled variant must not invent an order"
);

// Every Bosta field has to be forwarded onto the order payload, or the shipment form opens empty.
const draftStart = metaService.indexOf("const createSocialCommentDraftOrder = async");
assert.ok(draftStart > 0, "createSocialCommentDraftOrder is gone");
const draftBody = metaService.slice(draftStart, metaService.indexOf("const draft = await createAiOrderDraft(payload)", draftStart));
for (const field of [
  "shipping_city_id",
  "shipping_zone_id",
  "shipping_district_id",
  "building_number",
  "floor_number",
  "apartment_number",
  "landmark",
  "street_address",
]) {
  assert.match(
    draftBody,
    new RegExp(`${field}: text\\(structuredAddress\\?\\.${field}`),
    `the order payload must forward ${field} — Bosta refuses a shipment without the location ids`
  );
}

// ── 4. Typed addresses are redirected, not parsed ─────────────────────────────────────────────
assert.match(
  metaService,
  /reason: "social_comment_address_link_resent"/,
  "an address typed at the link step must be answered with the link, not parsed"
);
const resendStart = metaService.indexOf('=== "awaiting_address_link" &&');
assert.ok(resendStart > 0, "the address-link text handler is gone");
const resendBody = metaService.slice(resendStart, resendStart + 900);
assert.match(
  resendBody,
  /!resolvedAction/,
  "a quick-reply tap must never be mistaken for a typed address"
);

// ── 5. Instagram runs the same flow ───────────────────────────────────────────────────────────
// Instagram rides the same webhook and its DM endpoint takes the same message body, quick replies
// included. The flow used to refuse it on the channel name alone, and the dispatcher hard-coded
// Messenger — which built a facebook_messenger conversation id for an Instagram thread and then
// looked up state belonging to a different conversation entirely.
assert.match(
  metaService,
  /if \(!\[AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS\.INSTAGRAM\]\.includes\(text\(message\?\.channel \|\| ""\)\)\) return null;/,
  "the sales flow must accept Instagram, not only Messenger"
);
assert.match(
  metaService,
  /const dispatchChannel = String\(body\?\.object \|\| ""\)[\s\S]{0,120}AI_AGENT_CHANNELS\.INSTAGRAM/,
  "the quick-reply dispatcher must derive its channel from the webhook, not hard-code Messenger"
);
const dispatchStart = metaService.indexOf("export const dispatchSocialCommentMessengerQuickReplySelection");
const dispatchBody = metaService.slice(dispatchStart, metaService.indexOf("const result = await handleSocialCommentMessengerQuickReplySelection", dispatchStart));
assert.doesNotMatch(
  dispatchBody,
  /channel: AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER|\$\{AI_AGENT_CHANNELS\.FACEBOOK_MESSENGER\}:/,
  "no part of the dispatcher may still stamp Messenger onto an Instagram tap"
);

// Messenger-only template fields must not ship to Instagram, which rejects the payload.
const cardIgBody = metaService.slice(cardStart, metaService.indexOf("const buildSocialCommentAddressLink", cardStart));
assert.match(
  cardIgBody,
  /\.\.\.\(isMessenger \? \{ image_aspect_ratio: "square" \} : \{\}\)/,
  "image_aspect_ratio is Messenger-only and must be conditional"
);
assert.match(
  cardIgBody,
  /\.\.\.\(isMessenger \? \{ webview_height_ratio: "tall" \} : \{\}\)/,
  "webview_height_ratio is Messenger-only and must be conditional"
);
// Instagram Business Login sends through graph.instagram.com, not /me/messages on the page.
assert.match(
  cardIgBody,
  /postMetaMessageWithThreadControl\(/,
  "the address card must send through the helper that knows the Instagram endpoint"
);
assert.doesNotMatch(
  cardIgBody,
  /\$\{GRAPH_BASE_URL\}\/me\/messages/,
  "a raw /me/messages POST cannot reach an Instagram thread"
);

console.log("social comment address-link checkout OK");
