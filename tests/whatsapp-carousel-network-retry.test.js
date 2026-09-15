/*
 * A WhatsApp carousel survives a short DNS/network blip on Evolution's side.
 *
 * 2026-09-15: Evolution could not resolve api.m1store-egy.com for ~20s while fetching the card
 * photos, answered 500 "getaddrinfo EAI_AGAIN", and a 22-colour carousel went out as 22 loose
 * photos. Evolution downloads the photos before it sends, so that failure delivered nothing and
 * one retry is safe. A timeout on our own request is NOT retried — the carousel may be out.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.WHATSAPP_GATEWAY_PROVIDER = "evolution";
process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.EVOLUTION_INSTANCE_NAME = "test_instance";

const gateway = await import("../server/services/whatsappGatewayService.js");

const cards = [
  { imageUrl: "https://cdn.example.com/a.jpg", body: "White", buttonId: "choose_color:1", buttonText: "اطلب" },
  { imageUrl: "https://cdn.example.com/b.jpg", body: "Brown", buttonId: "choose_color:2", buttonText: "اطلب" },
];

const dnsFailure = () =>
  new Response(
    JSON.stringify({ status: 500, error: "Internal Server Error", response: { message: ["Error: getaddrinfo EAI_AGAIN api.m1store-egy.com"] } }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
const sent = () =>
  new Response(JSON.stringify({ key: { id: "3EB0CAROUSEL", remoteJid: "201070300563@s.whatsapp.net" }, status: "PENDING" }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

const withFetch = async (responses, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
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

test("a DNS blip on Evolution's photo fetch is retried once and the carousel goes out", async () => {
  await withFetch([dnsFailure, sent], async (calls) => {
    const result = await gateway.sendCartCarouselMessage({ phone: "01070300563", body: "اختار اللون", cards });
    assert.equal(calls.filter((url) => url.includes("/message/sendCarousel/")).length, 2);
    assert.ok(result);
  });
});

test("a second network failure is thrown so the caller falls back to per-card photos", async () => {
  await withFetch([dnsFailure, dnsFailure], async (calls) => {
    await assert.rejects(
      gateway.sendCartCarouselMessage({ phone: "01070300563", body: "اختار اللون", cards }),
      (error) => error.code === "EVOLUTION_API_ERROR",
    );
    assert.equal(calls.length, 2);
  });
});

test("only Evolution-reported network errors qualify for the retry", () => {
  const is = gateway.isEvolutionImageFetchNetworkError;
  assert.equal(is({ code: "EVOLUTION_API_ERROR", status: 500, responseRaw: "getaddrinfo EAI_AGAIN api.m1store-egy.com" }), true);
  assert.equal(is({ code: "EVOLUTION_API_ERROR", status: 500, responseRaw: "connect ECONNREFUSED 1.2.3.4:443" }), true);
  assert.equal(is({ code: "EVOLUTION_API_ERROR", status: 400, responseRaw: "getaddrinfo EAI_AGAIN x" }), false);
  assert.equal(is({ code: "EVOLUTION_API_ERROR", status: 500, responseRaw: "Invalid carousel card" }), false);
  assert.equal(is({ code: "EVOLUTION_BUTTONS_TIMEOUT", status: "timeout", message: "Evolution sendButtons request timed out" }), false);
  assert.equal(is(null), false);
});
