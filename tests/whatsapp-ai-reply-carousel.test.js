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
const aiCard = (id, color, price, grade = "") => ({
  resolved_image_url: `https://cdn.example.com/${id}.jpg`,
  product: {
    id: "77",
    ...(grade ? { grade_label: grade } : {}),
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

// Since 0488423 a named-model answer carries every grade (local first, up to 10 each). WhatsApp
// splits like Messenger/Instagram (metaCarouselChunks): a new carousel at each grade change and at
// 10 cards, with the "🔹 <grade>" line over each grade's first carousel.
const LOCAL = "محلي";
const MIRROR = "ميرور اوريجينال";
const gradedCards = [
  ...Array.from({ length: 5 }, (_, i) => aiCard(`10${i}`, `Local ${i}`, 900, LOCAL)),
  ...Array.from({ length: 12 }, (_, i) => aiCard(`20${i}`, `Mirror ${i}`, 1600, MIRROR)),
];
const carouselCalls = (calls) => calls.filter((call) => call.url.includes("/message/sendCarousel/"));

test("a multi-grade answer goes as one carousel per grade, split again at 10, each grade labelled", async () => {
  await withFetch(Array.from({ length: 6 }, () => ok), async (calls) => {
    const outcome = await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "الفرق بين الدرجات", cards: gradedCards });
    assert.equal(outcome.sent_count, 17, "all 17 cards, no cap at 6");
    const sent = carouselCalls(calls);
    assert.deepEqual(sent.map((call) => call.body.cards.length), [5, 10, 2]);
    assert.equal(sent[0].body.body, `الفرق بين الدرجات\n\n🔹 ${LOCAL}`, "the AI's words, then the first grade's label");
    assert.equal(sent[1].body.body, `🔹 ${MIRROR}`, "the next grade opens with its own label");
    assert.ok(!sent[2].body.body.includes("🔹"), "the same grade continued is not labelled again");
    assert.ok(sent[2].body.body.length > 0);
  });
});

test("a single-grade answer carries no grade label", async () => {
  const oneGrade = gradedCards.slice(5, 8);
  await withFetch([ok], async (calls) => {
    await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: "عندنا 3 ألوان", cards: oneGrade });
    assert.equal(carouselCalls(calls)[0].body.body, "عندنا 3 ألوان");
  });
});

test("AI words longer than a carousel body go first as their own text, whole", async () => {
  const longText = "ملاحظة ".repeat(200).trim();
  await withFetch(Array.from({ length: 6 }, () => ok), async (calls) => {
    const outcome = await gateway.sendAiReplyProductCarousel({ phone: "01024960585", body: longText, cards: gradedCards.slice(0, 7) });
    assert.equal(outcome.sent_count, 7);
    const textCall = calls.find((call) => call.url.includes("/message/sendText/"));
    assert.ok(textCall, "the long text was sent on its own");
    assert.equal(textCall.body.text, longText);
    const sent = carouselCalls(calls);
    assert.deepEqual(sent.map((call) => call.body.body), [`🔹 ${LOCAL}`, `🔹 ${MIRROR}`]);
  });
});

test("the auto-reply hands the carousel the AI's own reply, not the plan's blank text", () => {
  const source = fs.readFileSync(new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export const triggerWhatsappAiAutoReply"));
  const call = fn.slice(fn.indexOf("await sendAiReplyProductCarousel("), fn.indexOf("cards: sendableImageCards,"));
  assert.match(call, /replyText: generated\.replyText/);
});
