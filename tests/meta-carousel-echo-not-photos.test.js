// We send a product as ONE swipeable carousel and write ONE transcript row for it, cards
// included. Meta then echoes the template back under a message id that row never carried. The
// webhook normaliser dropped the template's payload and kept the first element's image_url, so
// every echo handler downstream saw "a photo": the inbox drew loose colour pictures under a
// carousel the customer had received exactly once, and never as pictures.
import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMetaWebhookMessages,
  metaTemplateElements,
  noteMetaTemplateSend,
  recentMetaTemplateSend,
} from "../server/services/aiChannelAdapterService.js";
import { classifyMetaCarouselEcho, metaTemplateProductCards } from "../server/services/metaIntegrationService.js";

const IG_BUSINESS_ID = "17841400000000001";

const element = (n) => ({
  title: `Black & White ${n} — 650 جنيه`,
  subtitle: "المقاسات: 41 / 42 / 43",
  image_url: `https://api.example.com/uploads/colour-${n}.jpg`,
  buttons: [{ type: "postback", title: "اطلب اللون ده ✅", payload: `choose_color:${100 + n}` }],
});

const echoOf = async (customerId, message) => {
  const messages = await extractMetaWebhookMessages({
    tenantId: 1,
    body: {
      object: "instagram",
      entry: [{
        id: IG_BUSINESS_ID,
        messaging: [{ sender: { id: IG_BUSINESS_ID }, recipient: { id: customerId }, timestamp: 1756300000000, message: { is_echo: true, ...message } }],
      }],
    },
  });
  assert.equal(messages.length, 1);
  return messages[0];
};

test("a template echo keeps its card set and offers no photo to store", async () => {
  const message = await echoOf("cust-shape-1", {
    mid: "mid.template-1",
    attachments: [{ type: "template", payload: { template_type: "generic", elements: [element(1), element(2), element(3)] } }],
  });
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].type, "template");
  assert.equal(message.attachments[0].url, "", "the first colour's image_url must not be mined out of the template");
  assert.equal(metaTemplateProductCards(message.attachments).length, 3);
});

test("the elements are found when the echo nests them under payload.generic", async () => {
  const message = await echoOf("cust-shape-2", {
    mid: "mid.template-2",
    attachments: [{ type: "template", payload: { generic: { elements: [element(1), element(2)] } } }],
  });
  const cards = metaTemplateProductCards(message.attachments);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].variant_id, "101");
  assert.equal(cards[0].price, 650);
});

test("elements under a non-template type are ignored", () => {
  assert.deepEqual(metaTemplateElements({ type: "image", payload: { elements: [element(1)] } }), []);
});

test("the echo of a carousel we just sent is a duplicate — even before our own row exists", async () => {
  const customerId = "cust-dup-1";
  noteMetaTemplateSend({ recipientId: customerId, elements: [element(1), element(2)] });
  const message = await echoOf(customerId, {
    mid: "mid.template-3",
    attachments: [{ type: "template", payload: { template_type: "generic", elements: [element(1), element(2)] } }],
  });
  const verdict = await classifyMetaCarouselEcho({ tenantId: 1, message });
  assert.equal(verdict.duplicate, true);
});

test("the same carousel echoed as bare pictures of our own card images is a duplicate too", async () => {
  const customerId = "cust-dup-2";
  noteMetaTemplateSend({ recipientId: customerId, elements: [element(1), element(2), element(3)] });
  const message = await echoOf(customerId, {
    mid: "mid.images-1",
    attachments: [element(1), element(2), element(3)].map((el) => ({ type: "image", payload: { url: el.image_url } })),
  });
  const verdict = await classifyMetaCarouselEcho({ tenantId: 1, message });
  assert.equal(verdict.duplicate, true);
});

test("a real photo sent right after a carousel is NOT swallowed", async () => {
  const customerId = "cust-photo-1";
  noteMetaTemplateSend({ recipientId: customerId, elements: [element(1), element(2)] });
  const message = await echoOf(customerId, {
    mid: "mid.photo-1",
    attachments: [{ type: "image", payload: { url: "https://scontent.cdninstagram.com/v/t1/real-photo.jpg" } }],
  });
  const verdict = await classifyMetaCarouselEcho({ tenantId: 1, message });
  assert.equal(verdict.isCardSet, false);
  assert.equal(verdict.duplicate, false);
});

test("a captioned message is never treated as the carousel's pictures", async () => {
  const customerId = "cust-caption-1";
  noteMetaTemplateSend({ recipientId: customerId, elements: [element(1)] });
  const message = await echoOf(customerId, {
    mid: "mid.caption-1",
    text: "ده اللون اللي سألتي عليه",
    attachments: [{ type: "image", payload: { url: element(1).image_url } }],
  });
  const verdict = await classifyMetaCarouselEcho({ tenantId: 1, message });
  assert.equal(verdict.duplicate, false);
});

test("the note is per customer", () => {
  noteMetaTemplateSend({ recipientId: "cust-a", elements: [element(1)] });
  assert.ok(recentMetaTemplateSend("cust-a"));
  assert.equal(recentMetaTemplateSend("cust-never-sent"), null);
});
