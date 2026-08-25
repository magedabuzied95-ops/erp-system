import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Proven live on 2026-08-25: with link previews enabled, Baileys acks the message with
// DELIVERY_ACK and it never renders on the recipient's phone. Probes to the owner's number —
// plain text arrived, the same text carrying a URL did not, and the same URL with
// linkPreview:false arrived. Everything transactional we send carries a link.

const source = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8"
);
const fnStart = source.indexOf("export const sendTextMessage");
assert.ok(fnStart > -1, "sendTextMessage exists");
const fnSource = source.slice(fnStart, source.indexOf("\nexport const", fnStart + 10));

test("a message carrying a link is sent with previews disabled", () => {
  assert.match(fnSource, /linkPreview: false/);
  assert.ok(!/linkPreview: true/.test(fnSource), "previews must never be requested");
});

test("the preview flag is decided by whether the body actually has a URL", () => {
  const hasLinkLine = fnSource.match(/const hasLink = .+/);
  assert.ok(hasLinkLine, "the body is still scanned for a URL");
  assert.match(hasLinkLine[0], /https\?:/, "it matches http and https");
  assert.match(fnSource, /\.\.\.\(hasLink \? \{ linkPreview: false \} : \{\}\)/);
});

// Behavioral: run the REAL detection against the messages we actually send, so a message that
// starts carrying a link in future is covered without anyone remembering this test exists.
const hasLinkSrc = fnSource.match(/const hasLink = (\/.+\/i)\.test\(body\)/);
assert.ok(hasLinkSrc, "the URL pattern is readable");
// eslint-disable-next-line no-new-func
const hasLink = new Function("body", `return ${hasLinkSrc[1]}.test(body);`);

test("the real confirmation messages are recognised as carrying links", async () => {
  const { buildOrderConfirmedMessage, buildCodOrderConfirmationMessage } =
    await import("../server/utils/orderConfirmationMessage.js");
  const confirmed = buildOrderConfirmedMessage({
    customerName: "ماجد",
    order: { invoice_number: "INV-1" },
    trackingUrl: "https://m1store-egy.com/track?order=INV-1",
  });
  assert.equal(hasLink(confirmed), true, "the confirmation reply carries the tracking link");

  const fallback = buildCodOrderConfirmationMessage({
    customerName: "ماجد",
    order: { invoice_number: "INV-1" },
    confirmationLink: "https://m1store-egy.com/c/AbC",
    withActions: true,
  });
  assert.equal(hasLink(fallback), true, "the COD text fallback carries the confirmation link");
});

test("a message with no link asks for nothing", () => {
  assert.equal(hasLink("تم تأكيد طلبك رقم INV-1. شكراً لك."), false);
});
