import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";

/**
 * The owner's live WhatsApp test, 2026-10-19 (whatsapp:201024960585):
 *   "بكام الشحن للاسكندرية ؟"     → price_objection, "السعر غير متاح ... contact_support"
 *   "متاح معاينه قبل الاستلام ؟"   → size_followup, told inspection is NOT available (false)
 *   "متاح استبدال او استرجاع ؟"    → no reply: "استرجاع" escalated it as a complaint
 * Each is now answered from the store's own settings — the checkout's shipping zones, the Bosta
 * open-package setting, the online invoice's policy — on every channel.
 */

// A live-looking OpenAI that would re-word anything handed to it: the store answers must not reach it.
process.env.AI_SUPPORT_ENABLED = "true";
process.env.OPENAI_AGENT_API_KEY = "test-key-not-real";
process.env.AI_GROUNDED_REPLY_REWRITE = "1";

const SETTINGS = {
  "storefront.default_shipping_price": 60,
  "storefront.shipping_zones": [
    { id: "alx", governorate: "Alexandria", price: 75, active: true },
    { id: "dmt", governorate: "دمياط", price: 45, active: true },
    { id: "cai-1", governorate: "Cairo", city: "Nasr City", price: 65, active: true },
    { id: "cai-2", governorate: "Cairo", city: "Maadi", price: 70, active: true },
  ],
  "storefront.free_shipping_threshold": 0,
  "orders.bosta_allow_open_package": "allow",
  "orders.cod_policy_mode": "open",
};
const POLICY = "يمكنك الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام.";

pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (/FROM system_settings/.test(query)) {
    const key = params[0];
    return { rows: key in SETTINGS ? [{ value: SETTINGS[key] }] : [] };
  }
  if (/FROM invoice_templates/.test(query)) {
    return { rows: [{ id: 1, tenant_id: 1, name: "default", is_default: true, scope_channel: "all", scope_branch_id: null,
      config: { footer: { return_policy_enabled: true, return_policy_ar: POLICY } } }] };
  }
  return { rows: [] };
};

const { detectStoreFactsQuestion, extractGovernorateFromMessage } = await import("../../server/utils/storeFactsQuestion.js");
const {
  buildStoreFactsDecision, buildOpenPackageReply, buildExchangeReturnReply, shippingFeeForGovernorate, buildShippingFeeReply, websiteShippingQuoteFor,
} = await import("../../server/services/aiStoreFactsReplyService.js");
const { detectEscalation } = await import("../../server/services/aiEscalationDetector.js");
const { stripInternalActionNames, sanitizeGroundedAiReply } = await import("../../server/services/aiReplyQualityService.js");
const { generateUnifiedConversationDecision } = await import("../../server/services/aiUnifiedDecisionService.js");

const { getSharedOpenAiClient } = await import("../../server/services/openaiSupportService.js");
let rewriteCalls = 0;
getSharedOpenAiClient().responses.create = async () => {
  rewriteCalls += 1;
  return { status: "completed", output_text: JSON.stringify({ answer: "السعر غير متاح حاليًا contact_support", confidence: 0.9, needs_human_support: false, sources_used: [], suggested_products: [], suggested_actions: ["contact_support"] }) };
};

const { getShippingQuote } = await import("../../server/controllers/storefrontController.js");
const zones = SETTINGS["storefront.shipping_zones"];
const fee = async (id, extra = {}) => shippingFeeForGovernorate({ quote: { ...(await websiteShippingQuoteFor(id)), ...extra }, zones }, id);

// What the website's checkout shows: its own route, with the Bosta picker's governorate name.
const websitePrice = async (governorate) => {
  let body = null;
  await getShippingQuote({ query: { governorate } }, { json: (value) => { body = value; return value; }, status: () => ({ json: () => null }) });
  return body?.quote?.price;
};

test("the three owner questions are read as store questions, not price / size", () => {
  assert.equal(detectStoreFactsQuestion("بكام الشحن للاسكندرية ؟"), "shipping_fee");
  assert.equal(detectStoreFactsQuestion("متاح معاينه قبل الاستلام ؟"), "open_package");
  assert.equal(detectStoreFactsQuestion("متاح استبدال او استرجاع ؟"), "exchange_return");
  assert.equal(extractGovernorateFromMessage("بكام الشحن للاسكندرية ؟"), "alexandria");
  assert.equal(extractGovernorateFromMessage("الشحن لكفر الشيخ كام"), "kafr-el-sheikh");
  assert.equal(extractGovernorateFromMessage("الشحن للمنصورة بكام"), "dakahlia");
});

test("product, tracking and complaint messages stay with the brain", () => {
  for (const message of ["بكام الجوردن 4", "الشحنه فين", "الشحن بياخد كام يوم", "عايز ارجع الكوتشي فيه مشكلة", "متاح مقاس 42"]) {
    assert.equal(detectStoreFactsQuestion(message), "", message);
  }
});

test("the shipping fee is the price the website's checkout shows for that governorate", async () => {
  // The fixture's numbers are made up; the point is that the bot and the website agree.
  for (const [id, governorate] of [["alexandria", "Alexandria"], ["damietta", "Damietta"], ["aswan", "Aswan"]]) {
    assert.equal((await fee(id)).price, await websitePrice(governorate), id);
  }
  assert.equal(buildShippingFeeReply({ fee: await fee("alexandria") }), "الشحن للإسكندرية 75 جنيه 🚚");
  assert.equal(buildShippingFeeReply({ fee: await fee("damietta") }), "الشحن لدمياط 45 جنيه 🚚");
  // Priced city by city: the website needs the city, the bot gives the range.
  assert.match(buildShippingFeeReply({ fee: await fee("cairo") }), /^الشحن للقاهرة من 60 لـ 70 جنيه حسب المنطقة/);
  // No zone ⇒ the website charges the default fee, and so does the answer.
  assert.equal(buildShippingFeeReply({ fee: await fee("aswan") }), "الشحن لأسوان 60 جنيه 🚚");
  assert.match(buildShippingFeeReply({ fee: await fee("aswan", { free_shipping_threshold: 1500 }) }), /مجاني لو الأوردر 1,500 جنيه/);
});

test("the live Alexandria answer: website fee, Arabic delivery time, free-shipping line, prepaid fee", async () => {
  const live = await buildStoreFactsDecision({
    message: "بكام الشحن للاسكندرية ؟",
    loaders: {
      shippingQuote: async ({ governorate }) => (governorate === "Alexandria"
        ? { price: 100, match_level: "governorate", free_shipping_threshold: 3500, estimated_delivery_text: "4-5 business days" }
        : { price: 120, match_level: "default", free_shipping_threshold: 3500 }),
      advanceNotice: async () => "💳 رسوم الشحن 100 جنيه تتحوّل مقدّم قبل الشحن.",
    },
  });
  assert.equal(live.text, [
    "الشحن للإسكندرية 100 جنيه 🚚",
    "التوصيل من 4 لـ 5 أيام عمل",
    "والشحن مجاني لو الأوردر 3,500 جنيه أو أكتر.",
    "💳 رسوم الشحن 100 جنيه تتحوّل مقدّم قبل الشحن.",
  ].join("\n"));
});

test("no governorate ⇒ the bot asks which one, and the bare answer gets the fee", async () => {
  const ask = await buildStoreFactsDecision({ message: "الشحن بكام؟" });
  assert.match(ask.text, /أنهي محافظة/);
  assert.equal(ask.memory_updates.last_intent, "shipping_fee_ask_governorate");
  const answer = await buildStoreFactsDecision({ message: "اسكندرية", memory: { preferences: { last_intent: "shipping_fee_ask_governorate" } } });
  assert.match(answer.text, /^الشحن للإسكندرية 75 جنيه/);
  assert.equal(await buildStoreFactsDecision({ message: "اسكندرية" }), null);
});

test("inspection before delivery follows the Bosta open-package setting, never invented", async () => {
  assert.match(buildOpenPackageReply({ mode: "allow" }), /تقدر تفتح الشحنة وتعاين الأوردر/);
  assert.match(buildOpenPackageReply({ mode: "deny" }), /مش متاح/);
  assert.match(buildOpenPackageReply({ mode: "unknown" }), /زمايلي يأكدلك/);
  const inherit = await buildStoreFactsDecision({ message: "متاح معاينه قبل الاستلام ؟", loaders: { openPackageSetting: () => "inherit" } });
  // \b never fires next to an Arabic letter, so the bare-word half of this used to check nothing.
  assert.doesNotMatch(inherit.text, /مش متاح|(?<![\p{L}\p{N}])متاح(?![\p{L}\p{N}])/u);
});

test("exchange / return is the invoice's policy; without one a colleague confirms", () => {
  assert.equal(buildExchangeReturnReply({ policy: POLICY }), `بالنسبة للاستبدال والاسترجاع:\n${POLICY}`);
  assert.match(buildExchangeReturnReply({ policy: "" }), /زمايلي يأكدلك/);
});

test("a policy question is not escalated; a complaint still is", () => {
  assert.equal(detectEscalation("متاح استبدال او استرجاع ؟").shouldEscalate, false);
  assert.equal(detectEscalation("ينفع ارجع الكوتشي لو المقاس مش مظبوط؟").shouldEscalate, false);
  assert.equal(detectEscalation("عايز ارجع الكوتشي فيه مشكلة").shouldEscalate, true);
  assert.equal(detectEscalation("ده نصب").shouldEscalate, true);
});

test("internal action names never reach the customer", () => {
  const leaked = "السعر غير متاح حاليًا، ممكن تتواصل مع خدمة العملاء contact_support";
  assert.equal(stripInternalActionNames(leaked), "السعر غير متاح حاليًا، ممكن تتواصل مع خدمة العملاء");
  assert.equal(sanitizeGroundedAiReply({ reply: "شوف الموديل (view_product).\nhttps://m1.store/p/air_force_1?utm_source=wa" }).reply,
    "شوف الموديل.\nhttps://m1.store/p/air_force_1?utm_source=wa");
});

test("the unified decision answers all three, on every channel, with no rewrite", async () => {
  for (const channel of ["whatsapp", "facebook_messenger", "instagram"]) {
    const run = (message) => generateUnifiedConversationDecision({ channel, message, external_conversation_id: `${channel}:t` }, { memory: {}, tenantId: 1 });
    const shipping = await run("بكام الشحن للاسكندرية ؟");
    assert.equal(shipping.intent, "shipping_fee");
    assert.equal(shipping.text, "الشحن للإسكندرية 75 جنيه 🚚");
    const inspect = await run("متاح معاينه قبل الاستلام ؟");
    assert.equal(inspect.intent, "open_package");
    assert.match(inspect.text, /تقدر تفتح الشحنة وتعاين الأوردر قدام المندوب/);
    const exchange = await run("متاح استبدال او استرجاع ؟");
    assert.equal(exchange.intent, "exchange_return");
    assert.equal(exchange.text, `بالنسبة للاستبدال والاسترجاع:\n${POLICY}`);
    for (const reply of [shipping, inspect, exchange]) {
      assert.doesNotMatch(reply.text, /[a-z]+_[a-z]+/);
      assert.equal(reply.debug.grounded_rewrite_applied, undefined);
      assert.equal(reply.handoff.needs_human_support, false);
    }
  }
  assert.equal(rewriteCalls, 0, "the store's words are never re-worded");
});

test("right after a fee answer, a bare governorate is the next fee question", async () => {
  // Production 2026-10-19: "الشحن للقاهرة كام" → 100, then "واسيوط" got "تحت أمرك. ابعت الموديل...".
  const answer = await buildStoreFactsDecision({ message: "واسيوط", memory: { preferences: { last_intent: "shipping_fee" } } });
  assert.ok(answer, "the follow-up must be answered as a shipping question");
  assert.equal(answer.detected_intent, "shipping_fee");
  assert.match(answer.text, /^الشحن لأسيوط/);
});

test("a bare governorate follow-up also works from the Meta runtime memory shape", async () => {
  const answer = await buildStoreFactsDecision({ message: "واسيوط", memory: { lastIntent: "shipping_fee" } });
  assert.ok(answer);
  assert.equal(answer.detected_intent, "shipping_fee");
});
