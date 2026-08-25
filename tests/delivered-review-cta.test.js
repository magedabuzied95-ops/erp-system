import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getGoogleReviewUrl } from "../server/utils/publicUrl.js";

// The delivery message doubles as the review ask: one message, at the moment the customer has the
// product in hand. Evolution refuses to mix a CTA button with reply buttons, so this is the whole
// message — which makes the fallback load-bearing: a button that fails must not cost the customer
// the news that their parcel arrived.

const shipping = fs.readFileSync(
  new URL("../server/services/whatsappShippingService.js", import.meta.url), "utf8"
);
const gateway = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8"
);
const orders = fs.readFileSync(
  new URL("../server/controllers/ordersController.js", import.meta.url), "utf8"
);

test("the review link has exactly one definition", () => {
  assert.match(getGoogleReviewUrl(), /^https:\/\/g\.page\/r\/[A-Za-z0-9_-]+\/review$/);
  // a second copy of the Place ID is a second chance to send customers to another shop
  assert.ok(
    !/g\.page\/r\//.test(orders),
    "ordersController must import the link, not carry its own copy"
  );
  assert.match(orders, /import \{ getGoogleReviewUrl \} from "\.\.\/utils\/publicUrl\.js"/);
});

test("only the delivered notification carries the review button", () => {
  assert.match(shipping, /const reviewUrl = type === "delivered" \? getGoogleReviewUrl\(\) : ""/);
});

test("a failing button never costs the customer the delivery message", () => {
  // search forward from the branch: the function name also appears in the import line above it
  const from = shipping.indexOf("const reviewUrl =");
  assert.ok(from > -1, "the delivered branch exists");
  const branch = shipping.slice(from, shipping.indexOf("appendWhatsappOutboundSupportReply", from));
  assert.match(branch, /catch \(ctaError\)/, "the CTA send is wrapped");
  // the fallback must live INSIDE the catch - the same call also appears in the non-delivered
  // else-branch below, so matching the whole branch would pass with the catch gutted.
  const catchFrom = branch.indexOf("catch (ctaError)");
  const catchBlock = branch.slice(catchFrom, branch.indexOf("} else {", catchFrom));
  assert.ok(catchBlock.includes("result = await sendTextMessage({ phone, message })"), "the catch falls back to plain text");
  assert.ok(!/throw /.test(catchBlock), "a failed button must not propagate and kill the notification");
  // and the non-delivered path still sends plainly
  assert.ok(branch.slice(branch.indexOf("} else {")).includes("sendTextMessage({ phone, message })"), "the non-delivered path still sends plainly");
});

test("the CTA sender refuses a half-built button rather than sending a dead one", () => {
  const fn = gateway.slice(gateway.indexOf("export const sendCtaUrlMessage"), gateway.indexOf("export const buildOrderConfirmationMessage"));
  assert.match(fn, /if \(!text\(url\) \|\| !text\(displayText\)\)/);
  assert.match(fn, /WHATSAPP_CTA_INCOMPLETE/);
});

test("the CTA sender carries its own not-delivered fallback", () => {
  const fn = gateway.slice(gateway.indexOf("export const sendCtaUrlMessage"), gateway.indexOf("export const buildOrderConfirmationMessage"));
  assert.match(fn, /fallbackOnNotDelivered/);
  assert.match(fn, /sendTextMessage\(\{ phone: normalizedPhone/);
  // the button is a single cta; mixing with reply buttons is rejected by Evolution
  assert.match(fn, /buttons: \[\{ type: "url"/);
});

// ---- the POS receipt carries the same ask ----
const confirmation = fs.readFileSync(
  new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8"
);

test("the POS receipt carries the review button too", () => {
  const from = confirmation.indexOf("result = await sendCtaUrlMessage(");
  assert.ok(from > -1, "the receipt sends via the CTA sender");
  const block = confirmation.slice(from, confirmation.indexOf("console.info(logTags.sent", from));
  assert.ok(block.includes("getGoogleReviewUrl()"), "it uses the one shared review link");
  assert.ok(block.includes("قيّمنا على جوجل"), "the label names where the button goes");
});

test("a failing button never costs the customer their invoice", () => {
  const from = confirmation.indexOf("catch (ctaError)");
  assert.ok(from > -1, "the receipt CTA is wrapped");
  const catchBlock = confirmation.slice(from, confirmation.indexOf("console.info(logTags.sent", from));
  assert.ok(catchBlock.includes("result = await sendTextMessage({ phone, message })"), "it falls back to the plain receipt");
  assert.ok(!catchBlock.includes("throw "), "a failed button must not propagate");
});

test("both review asks use the same label and the same link", () => {
  const labels = [shipping, confirmation].map((src) => (src.match(/displayText: "([^"]+)"/) || [])[1]);
  assert.equal(labels[0], labels[1], "delivery and receipt say the same thing");
  for (const src of [shipping, confirmation]) {
    assert.ok(src.includes("getGoogleReviewUrl()"), "no hardcoded review link");
    assert.ok(!/g\.page\/r\//.test(src), "the Place ID lives in one place only");
  }
});

test("a CTA title is always non-empty and never repeats the body", () => {
  // Evolution always renders the title: blank prints "**" on the phone, omitting the key prints
  // "*undefined*". So the header has to carry real words - and not the same words as line one.
  for (const [name, src] of [["delivery", shipping], ["receipt", confirmation]]) {
    const from = src.indexOf("sendCtaUrlMessage({");
    assert.ok(from > -1, name + " sends a CTA");
    const call = src.slice(from, src.indexOf("});", from));
    const title = (call.match(/title: ([A-Za-z_][A-Za-z0-9_.]*|"[^"]*")/) || [])[1];
    assert.ok(title, name + " passes a title");
    assert.notEqual(title, '""', name + " title must not be blank - it renders as **");
  }
});

test("the receipt greeting moves into the title instead of being printed twice", () => {
  const from = confirmation.indexOf("sendCtaUrlMessage({");
  const call = confirmation.slice(from, confirmation.indexOf("});", from));
  assert.ok(call.includes("title: INVOICE_RECEIPT_GREETING"), "the greeting is the header");
  assert.ok(call.includes("withGreeting: false"), "and the body drops it");
  assert.ok(call.includes("fallbackText: message"), "the plain fallback keeps the full text");
});

test("the delivery headline comes from the editable template, not a hardcoded string", () => {
  assert.ok(shipping.includes("const [deliveredHeadline"), "the headline is split off the template");
  const from = shipping.indexOf("sendCtaUrlMessage({");
  const call = shipping.slice(from, shipping.indexOf("});", from));
  assert.ok(call.includes("title: deliveredHeadline"), "the header is the template first line");
  assert.ok(call.includes("text: deliveredBody"), "the body is the remainder");
});
