import test from "node:test";
import assert from "node:assert/strict";

// INV-681 was cancelled three seconds after the customer wrote "طيب مش مشكلة، انا ممكن الغى
// الاوردر واعمله وقت تانى حتى اكون رجعت القاهرة" — she was talking about a LATER order, and this
// one was cancelled and its stock returned underneath her. The same detector had already told her
// "طلبك رقم INV-681 مؤكد بالفعل" minutes earlier, off a "yes"-shaped word.
//
// The cause: order decisions were taken from the canonical intent signals that drive the AI reply
// layer. Those match a word ANYWHERE in a sentence, and the words are Egyptian Arabic's most
// ordinary filler — "مش" is the negation particle inside "مش مشكلة" (no problem), i.e. agreement.
//
// These tests execute the real exported functions. Neutering the guard must fail them.
const { resolveOrderDecision, orderAwaitsDecision } = await import(
  "../server/services/whatsappOrderConfirmationService.js"
);

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 30, 18, 0, 0);

const pendingOrder = { id: 681, status: "pending_confirmation", whatsapp_confirmation_sent_at: new Date(NOW - HOUR) };
const confirmedOrder = { id: 681, status: "confirmed", whatsapp_confirmation_sent_at: new Date(NOW - HOUR) };
const staleOrder = { id: 681, status: "confirmed", whatsapp_confirmation_sent_at: new Date(NOW - 200 * HOUR) };
const neverPromptedOrder = { id: 681, status: "confirmed", whatsapp_confirmation_sent_at: null };

// The exact message that cancelled INV-681, as WhatsApp delivered it.
const INV_681_MESSAGE = [
  "طيب مش مشكلة",
  "انا ممكن الغى الاوردر واعمله وقت تانى حتى اكون رجعت القاهرة",
  "ولو حضرتك حابب ابعتك فلوس الشحن مفيش مشكلة قولى بس كام وابعتلى الرقم اللى احول عليه",
].join("\n");

const decide = (replyText, order = pendingOrder, buttonAction = "") =>
  resolveOrderDecision({ order, buttonAction, replyText, now: NOW });

test("the sentence that cancelled INV-681 decides nothing", () => {
  assert.equal(decide(INV_681_MESSAGE), "");
  assert.equal(decide(INV_681_MESSAGE, confirmedOrder), "");
});

test("ordinary Egyptian filler never decides an order", () => {
  // Every one of these used to resolve to confirm or cancel via the canonical intent signals.
  const harmless = [
    "طيب مش مشكلة",       // "no problem" — agreement, built on the negation particle
    "مش عارف",             // "I don't know"
    "لا مفيش مشكلة",       // "no worries"
    "تمام شكرا",           // "ok thanks"
    "اه اتواصلوا معايا",   // "yes they contacted me"
    "ماشي",                // "fine"
    "حاضر هستنى",          // "sure, I'll wait"
    "اكيد يا فندم",        // "of course"
    "ممكن الغى الاوردر واعمله تانى وقت تانى", // talking ABOUT cancelling, not asking
  ];
  for (const reply of harmless) {
    assert.equal(decide(reply), "", `"${reply}" must not decide an order`);
    assert.equal(decide(reply, confirmedOrder), "", `"${reply}" must not decide a confirmed order`);
  }
});

test("a tapped button still decides, however late it lands", () => {
  // Buttons stay tappable forever and name both the action and the order; the caller answers the
  // state the order is actually in. Losing this would undo the late-button-tap handling.
  assert.equal(decide("❌ إلغاء الطلب", staleOrder, "cancel"), "cancel");
  assert.equal(decide("", confirmedOrder, "confirm"), "confirm");
  assert.equal(decide("", neverPromptedOrder, "edit"), "edit");
});

test("a reply that is the action label and nothing else still decides", () => {
  assert.equal(decide("إلغاء الطلب"), "cancel");
  assert.equal(decide("الغاء"), "cancel");
  assert.equal(decide("❌ إلغاء الطلب"), "cancel");
  assert.equal(decide("تأكيد الطلب"), "confirm");
  assert.equal(decide("تاكيد"), "confirm");
  assert.equal(decide("cancel"), "cancel");
  assert.equal(decide("تعديل الطلب"), "edit");
});

test("the action label inside a sentence decides nothing", () => {
  // The whole point: "إلغاء" as a word in a sentence is discussion, not an instruction.
  assert.equal(decide("ممكن اعرف شروط إلغاء الطلب ايه؟"), "");
  assert.equal(decide("انا عايز تعديل الطلب بتاعي بس مش دلوقتي"), "");
});

test("a typed word only decides while we are waiting on that order", () => {
  assert.equal(decide("إلغاء الطلب", pendingOrder), "cancel");
  assert.equal(decide("إلغاء الطلب", confirmedOrder), "cancel", "inside the prompt window");
  assert.equal(decide("إلغاء الطلب", staleOrder), "", "the prompt is long gone");
  assert.equal(decide("إلغاء الطلب", neverPromptedOrder), "", "we never asked about this order");
});

test("no order means no decision", () => {
  assert.equal(resolveOrderDecision({ order: null, buttonAction: "cancel", replyText: "إلغاء", now: NOW }), "");
  assert.equal(resolveOrderDecision(), "");
});

test("orderAwaitsDecision is what bounds a typed decision", () => {
  assert.equal(orderAwaitsDecision(pendingOrder, NOW), true);
  assert.equal(orderAwaitsDecision(confirmedOrder, NOW), true);
  assert.equal(orderAwaitsDecision(staleOrder, NOW), false);
  assert.equal(orderAwaitsDecision(neverPromptedOrder, NOW), false);
  assert.equal(orderAwaitsDecision(null, NOW), false);
  // pg hands timestamps back as Date objects; the webhook path has also seen ISO strings.
  assert.equal(orderAwaitsDecision({ status: "confirmed", whatsapp_confirmation_sent_at: new Date(NOW - HOUR).toISOString() }, NOW), true);
});
