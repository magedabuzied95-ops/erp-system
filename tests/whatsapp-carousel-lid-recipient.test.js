/*
 * A product carousel reaches a WhatsApp username customer (LID, no phone).
 *
 * LIVE 2026-10-20: cards sent from the inbox to @x1_youssef_12 (216917574942919@lid) went out as
 * one photo + caption per colour: sendCartCarouselMessage accepted a phone only and threw
 * WHATSAPP_PHONE_REQUIRED, and the caller fell back to per-card sends. Text and image sends
 * already address a LID chat as "<lid>@lid".
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.WHATSAPP_GATEWAY_PROVIDER = "evolution";
process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.EVOLUTION_INSTANCE_NAME = "test_instance";

const gateway = await import("../server/services/whatsappGatewayService.js");

test("a carousel to a LID customer is sent to <lid>@lid, not refused", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/message/sendCarousel/")) bodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ key: { id: "3EB0LIDCAROUSEL", remoteJid: "216917574942919@lid" }, status: "PENDING" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await gateway.sendCartCarouselMessage({
      phone: "216917574942919@lid",
      body: "أيوه متاح إن شاء الله 👇",
      cards: [
        { imageUrl: "https://cdn.example.com/a.jpg", body: "White", buttonId: "choose_color:1", buttonText: "اطلب" },
        { imageUrl: "https://cdn.example.com/b.jpg", body: "Black", buttonId: "choose_color:2", buttonText: "اطلب" },
      ],
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(bodies.length, 1, "the carousel endpoint was called");
  assert.equal(bodies[0].number, "216917574942919@lid");
});

test("a phone number still goes as a phone", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/message/sendCarousel/")) bodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ key: { id: "3EB0PHONE" }, status: "PENDING" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    await gateway.sendCartCarouselMessage({
      phone: "01024960585",
      body: "x",
      cards: [{ imageUrl: "https://cdn.example.com/a.jpg", body: "White", buttonId: "choose_color:1" }],
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.match(bodies[0].number, /^20?1024960585$|^201024960585$/);
});
