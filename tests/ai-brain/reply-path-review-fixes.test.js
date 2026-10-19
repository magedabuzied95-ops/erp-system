import test from "node:test";
import assert from "node:assert/strict";

import {
  getOpenAiSupportRuntimeConfig,
  noteOpenAiFailure,
  noteOpenAiSuccess,
  pickModelSuggestedProducts,
  resolveSupportSamplingParams,
} from "../../server/services/openaiSupportService.js";
import { isBareGreetingOrAck } from "../../server/services/whatsappGatewayService.js";

/**
 * Cover for the 2026-10-19 review of the customer reply path, ahead of the owner
 * paying for OpenAI: failures that were silent, a model that could invent products,
 * and a WhatsApp guard that answered price questions with a greeting.
 */

const invalidKeyError = () => Object.assign(new Error("Incorrect API key provided"), { status: 401, code: "invalid_api_key" });

test("a wrong or revoked key blocks text generation and says so", () => {
  noteOpenAiSuccess();
  const ms = noteOpenAiFailure(invalidKeyError());
  assert.ok(ms > 60_000, "an invalid key is permanent until changed; it must not be retried on every message");
  const runtime = getOpenAiSupportRuntimeConfig();
  assert.equal(runtime.text_generation_block_reason, "openai_invalid_key");
  assert.equal(runtime.last_error.status, 401);
  noteOpenAiSuccess();
});

test("the admin status remembers the last success", () => {
  noteOpenAiSuccess();
  assert.ok(getOpenAiSupportRuntimeConfig().last_success_at, "last_success_at must be stamped");
});

test("the model can only choose among the products it was given", () => {
  const input = [
    { id: 11, name: "Air Force 1", price: 1450, total_stock: 3 },
    { id: 12, name: "Samba", price: 1600, total_stock: 0 },
  ];
  const invented = [{ id: 999, name: "Yeezy 350", price: 99, total_stock: 50 }];
  assert.deepEqual(pickModelSuggestedProducts(invented, input), input, "an unknown id falls back to our own list");

  const reordered = [
    { id: "12", name: "Samba (cheap!)", price: 1, total_stock: 100 },
    { id: 11, name: "AF1", price: 2, total_stock: 100 },
  ];
  const picked = pickModelSuggestedProducts(reordered, input);
  assert.deepEqual(picked.map((product) => product.id), [12, 11], "the model's order is kept");
  assert.equal(picked[0].price, 1600, "price comes from our row, never the model");
  assert.equal(picked[0].name, "Samba");
});

test("temperature is only sent where the model accepts it", () => {
  const before = process.env.AI_SUPPORT_TEMPERATURE;
  delete process.env.AI_SUPPORT_TEMPERATURE;
  assert.deepEqual(resolveSupportSamplingParams("gpt-4o"), { temperature: 0.4 });
  assert.deepEqual(resolveSupportSamplingParams("gpt-5"), {}, "reasoning models reject temperature");
  assert.deepEqual(resolveSupportSamplingParams("o4-mini"), {});
  process.env.AI_SUPPORT_TEMPERATURE = "0.2";
  assert.deepEqual(resolveSupportSamplingParams("gpt-5"), { temperature: 0.2 });
  if (before === undefined) delete process.env.AI_SUPPORT_TEMPERATURE;
  else process.env.AI_SUPPORT_TEMPERATURE = before;
});

test("the WhatsApp price guard fires only on a bare greeting", () => {
  for (const greeting of ["السلام عليكم", "السلام عليكم ورحمة الله وبركاته", "أهلاً", "مساء الخير", "تمام شكراً", "صباح الفل يا باشا"]) {
    assert.equal(isBareGreetingOrAck(greeting), true, `"${greeting}" is a greeting`);
  }
  // These used to get "وعليكم السلام، أهلاً بيك يا فندم" instead of their answer.
  for (const question of ["الشحن بكام لاسكندرية؟", "الإجمالي كام؟", "السلام عليكم الشحن بكام", "عايز اعرف العربون كام", ""]) {
    assert.equal(isBareGreetingOrAck(question), false, `"${question}" is not a bare greeting`);
  }
});

test("only the listed test numbers get the automatic WhatsApp reply", async () => {
  const { parseAiTestContacts, isAiTestContact } = await import("../../server/utils/aiAutoReplyGate.js");
  const contacts = parseAiTestContacts("01024960585\n+20 100 000 0000, junk");
  for (const phone of ["201024960585", "01024960585", "+201024960585", "201024960585@s.whatsapp.net", "00201000000000"]) {
    assert.equal(isAiTestContact(contacts, phone), true, `${phone} is a listed number`);
  }
  assert.equal(isAiTestContact(contacts, "201111111111"), false, "a real customer is not a test number");
  assert.equal(isAiTestContact(parseAiTestContacts(""), "201024960585"), false, "an empty setting changes nothing");
});

test("a photo the bot could not match is acknowledged, not answered with a generic line", async () => {
  const { buildBaseText, VISUAL_SEARCH_NO_MATCH_TEXT } = await import("../../server/services/aiBrainV2Service.js");
  const reply = buildBaseText({ intent: "visual_search", cards: [] });
  assert.equal(reply, VISUAL_SEARCH_NO_MATCH_TEXT);
  assert.match(reply, /الصورة/);
  assert.doesNotMatch(reply, /ابعت الموديل أو السؤال اللي محتاجه/);
});
