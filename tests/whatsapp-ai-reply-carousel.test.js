/*
 * The AI auto-reply sends its product cards as ONE WhatsApp carousel.
 *
 * 2026-10-19, owner's live test (ai_support_sessions 2391): three AI answers with several colours
 * each reached the phone as loose photos with a caption apiece. triggerWhatsappAiAutoReply only
 * ever looped sendImageMessage — the carousel lived in the inbox send alone. Two or more cards now
 * go as a carousel from the conversation's own number; a carousel Evolution refuses falls back to
 * the photos, and one whose request timed out does not (it may already be on the phone).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.WHATSAPP_GATEWAY_PROVIDER = "evolution";
process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.EVOLUTION_INSTANCE_NAME = "default_instance";

const gateway = await import("../server/services/whatsappGatewayService.js");

// The shape triggerWhatsappAiAutoReply hands its send loop (sendableImageCards).
const aiCard = (id, color, price) => ({
  resolved_image_url: `https://cdn.example.com/${id}.jpg`,
  product: {
    id: "77",
    name: `Nike Air Force 1 - ${color}`,
    color,
    selected_variant_id: id,
    selected_variant: { id, display_price: price },
    available_sizes: ["40", "41", "42"],
    product_url: "https://m1store-egy.com/p/77",
  },
});
const cards = [aiCard("901", "White", 1850), aiCard("902", "Black", 1850), aiCard("903", "Red", 1900)];

const ok = () =>
  new Response(JSON.stringify({ key: { id: "3EB0AICAROUSEL", remoteJid: "201024960585@s.whatsapp.net" }, status: "PENDING" }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

const withFetch = async (responses, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next();
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
};

test("two or more AI cards go as one carousel from the conversation's own number", async () => {
  await withFetch([ok], async (calls) => {
    const outcome = await gateway.sendAiReplyProductCarousel({
      phone: "01024960585",
      instance: "second_line",
      body: "عندنا 3 ألوان",
      cards,
      conversationId: "whatsapp:201024960585",
    });
    assert.equal(outcome.sent_count, 3, "every card was delivered by the carousel");
    assert.equal(calls.length, 1, "one request, not one per photo");
    assert.equal(calls[0].url, "http://evolution.test/message/sendCarousel/second_line");
    assert.equal(calls[0].body.body, "عندنا 3 ألوان", "the AI's words are the lead line");
    assert.equal(calls[0].body.cards.length, 3);
    assert.deepEqual(calls[0].body.cards.map((card) => card.buttons[0].id), ["choose_color:901", "choose_color:902", "choose_color:903"]);
    assert.match(calls[0].body.cards[2].body, /^Red\n1,900 جنيه\nالمقاسات: 40 \/ 41 \/ 42$/);
  });
});

test("an empty AI text still gives the carousel a lead line (Evolution 400s an empty body)", async () => {
  await withFetch([ok], async (calls) => {
    await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "", cards: cards.slice(0, 2) });
    assert.ok(calls[0].body.body.length > 0);
  });
});

test("one card is left to the photo send", async () => {
  await withFetch([], async (calls) => {
    const outcome = await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "x", cards: cards.slice(0, 1) });
    assert.equal(outcome.sent_count, 0);
    assert.equal(calls.length, 0);
  });
});

test("a carousel Evolution refuses falls back to photos, and says so in the log", async () => {
  const refused = () =>
    new Response(JSON.stringify({ status: 400, error: "Bad Request", response: { message: ["cards is not valid"] } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  const logged = [];
  const originalError = console.error;
  console.error = (tag, ...rest) => { logged.push(String(tag)); };
  try {
    await withFetch([refused], async () => {
      const outcome = await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "x", cards });
      assert.equal(outcome.sent_count, 0, "nothing delivered, so every card goes as a photo");
      assert.equal(outcome.reason, "carousel_failed");
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.includes("[whatsapp-ai-carousel-failed]"));
});

test("a carousel whose request timed out is not repeated as photos", async () => {
  const aborted = () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withFetch([aborted], async () => {
      const outcome = await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "x", cards });
      assert.equal(outcome.sent_count, 3);
      assert.equal(outcome.reason, "carousel_timeout");
    });
  } finally {
    console.error = originalError;
  }
});

test("the auto-reply sends through the carousel and skips the cards it delivered", () => {
  const source = fs.readFileSync(new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export const triggerWhatsappAiAutoReply"));
  const carouselAt = fn.indexOf("await sendAiReplyProductCarousel(");
  const loopAt = fn.indexOf("normalized_image_url }] of sendableImageCards.entries()) {");
  assert.ok(carouselAt > 0, "the auto-reply tries the carousel");
  assert.ok(loopAt > carouselAt, "before the photo loop");
  assert.match(fn.slice(loopAt, loopAt + 200), /if \(sendIndex < aiCarousel\.sent_count\) continue;/);
});
