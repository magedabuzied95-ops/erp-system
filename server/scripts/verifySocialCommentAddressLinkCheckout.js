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

console.log("social comment address-link checkout OK");
