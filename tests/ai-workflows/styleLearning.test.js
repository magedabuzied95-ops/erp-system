// Phase 11.2 — bounded style learning: corrections must be injected as STYLE EXAMPLES (tone/phrasing), never
// as reusable factual answer memory. The grounding gate stays last + authoritative (asserted elsewhere).

import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyCorrectionContextSource, deriveTenantStyleProfile, normalizeStyleText, correctionStyleSignals } from "../../server/services/aiCorrectionMemoryService.js";
import { renderGroundedAvailability, guardNoFalseAvailability } from "../../server/services/aiInboxGroundingGate.js";

// Fixtures — NO real production corrections are created; these are in-memory only.
const conciseEdit = (intent = "PRODUCT_AVAILABILITY", finalText = "أيوه متاح إن شاء الله 🌹") => ({
  intent,
  ai_wrong_answer: "أيوه 👍 المنتج مقاس 45 متوفر حاليًا (3 قطع بس). تحب أجهزلك الطلب؟",
  employee_correct_answer: finalText,
});
const normalEdit = (intent = "PRODUCT_AVAILABILITY") => ({
  intent,
  ai_wrong_answer: "أيوه المنتج متوفر.",
  employee_correct_answer: "أيوه المنتج مقاس 45 متوفر حاليًا عندنا 3 قطع في المخزن، تحب أجهزلك الطلب؟",
});
const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const STABLE_CONCISE_PROFILE = {
  PRODUCT_AVAILABILITY: {
    brevity: { value: "concise", status: "stable", evidence: 5, threshold: 5 },
    exact_stock_count: { value: "usually_omit", status: "stable", evidence: 5, threshold: 5 },
    emoji: { value: "light", status: "stable", evidence: 5, threshold: 5 },
  },
};

test("threshold: 1 edit → no stable preference", () => {
  const p = deriveTenantStyleProfile(times(1, () => conciseEdit()));
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.status, "learning");
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.value, null);
});

test("threshold: 4 consistent edits → still no stable preference", () => {
  const p = deriveTenantStyleProfile(times(4, () => conciseEdit()));
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.status, "learning");
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.evidence, 4);
});

test("threshold: 5 consistent edits → preference becomes stable", () => {
  const p = deriveTenantStyleProfile(times(5, () => conciseEdit()));
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.status, "stable");
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.value, "concise");
  assert.equal(p.PRODUCT_AVAILABILITY.exact_stock_count.value, "usually_omit");
});

test("conflict: mixed concise/normal edits → no false stable preference", () => {
  const p = deriveTenantStyleProfile([...times(5, () => conciseEdit()), ...times(5, () => normalEdit())]);
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.status, "conflicting");
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.value, null);
});

test("normalization: Arabic ٤٥ and 45 fold to the same token", () => {
  assert.equal(normalizeStyleText("مقاس ٤٥"), normalizeStyleText("مقاس 45"));
});

test("different wording, same PRODUCT_AVAILABILITY intent, all contribute", () => {
  const varied = [
    conciseEdit("PRODUCT_AVAILABILITY", "أيوه متاح 🌹"),
    conciseEdit("PRODUCT_AVAILABILITY", "متاح إن شاء الله 🌹"),
    conciseEdit("PRODUCT_AVAILABILITY", "أيوه متوفر يا فندم 🌹"),
    conciseEdit("PRODUCT_AVAILABILITY", "متاح 🌹"),
    conciseEdit("PRODUCT_AVAILABILITY", "أكيد متاح 🌹"),
  ];
  const p = deriveTenantStyleProfile(varied);
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.status, "stable"); // wording varies, style signal still accrues
});

test("different intent does NOT contaminate availability style", () => {
  const p = deriveTenantStyleProfile([...times(5, () => conciseEdit("PRODUCT_AVAILABILITY")), ...times(5, () => conciseEdit("ORDER_STATUS"))]);
  assert.equal(p.PRODUCT_AVAILABILITY.brevity.evidence, 5); // only the 5 availability edits count for availability
  assert.ok(!p.ORDER_STATUS || p.ORDER_STATUS.brevity.evidence === 5); // order-status kept separate
});

test("learned concise style renders the verified AVAILABLE fact correctly (no stock, asserts available)", () => {
  const rendered = renderGroundedAvailability({ typeLabel: "Air Jordan 4", sizeTxt: " مقاس 41", stock: 2, styleProfile: STABLE_CONCISE_PROFILE });
  assert.match(rendered, /متاح/);           // availability fact asserted
  assert.doesNotMatch(rendered, /قطع|2/);   // exact stock omitted per learned preference
});

test("SAFETY: an unavailable fact can NEVER become available through style", () => {
  const neutral = "المنتج مقاس 44 مش متوفر حاليًا.";
  // even if some styled text tried to say 'متاح', the guard reverts it for a non-available action
  assert.equal(guardNoFalseAvailability("unavailable", "أيوه متاح حاليًا 🌹", neutral), neutral);
  assert.equal(guardNoFalseAvailability("clarify_size", "متوفر", neutral), neutral);
  // an available action is untouched
  assert.equal(guardNoFalseAvailability("available", "أيوه متاح حاليًا", "x"), "أيوه متاح حاليًا");
});

test("SAFETY: price/stock/product are NOT learnable as style (profile has only presentation signals)", () => {
  const p = deriveTenantStyleProfile(times(5, () => conciseEdit()));
  const keys = Object.keys(p.PRODUCT_AVAILABILITY);
  for (const k of keys) assert.ok(["brevity", "exact_stock_count", "emoji"].includes(k), `unexpected style key ${k}`);
  // no signal value is ever a raw price/stock/product number
  for (const k of keys) assert.doesNotMatch(String(p.PRODUCT_AVAILABILITY[k].value ?? ""), /^\d+$/);
});

test("learning disabled (no profile) → neutral renderer keeps full facts", () => {
  const rendered = renderGroundedAvailability({ typeLabel: "Air Jordan 4", sizeTxt: " مقاس 41", stock: 2, styleProfile: null });
  assert.match(rendered, /متوفر حاليًا/);
  assert.match(rendered, /قطعتين/); // Phase 12.2 — grammatical Arabic count (2 → قطعتين), stock fact unchanged
});

test("reset profile → deriving from no corrections yields an empty profile (audit rows unaffected)", () => {
  assert.deepEqual(deriveTenantStyleProfile([]), {});
});

const CORRECTION = {
  id: 2,
  customer_question: "عندكم جوردن فور مقاس 45؟",
  ai_wrong_answer: "أيوه 👍 المنتج مقاس 45 متوفر حاليًا (3 قطع بس). تحب أجهزلك الطلب؟",
  employee_correct_answer: "أيوه متاح إن شاء الله 🌹",
  correction_type: "incomplete_answer",
  product_id: 39,
  conversation_id: "facebook_messenger:5036593356360590",
};

test("correction is framed as a STYLE EXAMPLE, not factual answer memory", () => {
  const [block] = buildReplyCorrectionContextSource([CORRECTION], "عندكم نايك اير ماكس مقاس 44؟");
  assert.match(block.title, /STYLE EXAMPLE/);
  assert.match(block.content, /Imitate ONLY the tone/i);
  assert.match(block.content, /phrasing/i);
  // explicitly forbids reusing facts from the example
  assert.match(block.content, /NEVER copy the specific stock count, price, size availability, product/);
  // the preferred phrasing (the style signal) is present
  assert.match(block.content, /أيوه متاح إن شاء الله/);
});

test("STYLE EXAMPLE does NOT present the old stock count as a fact to reuse", () => {
  const [block] = buildReplyCorrectionContextSource([CORRECTION], "q");
  // the old '3 قطع' appears only inside the 'style to avoid' phrasing line, never as a standalone fact label
  assert.doesNotMatch(block.content, /Available: |In stock: |Stock: 3|السعر:|المتاح:/);
  // and it is labelled as style-to-avoid, not authoritative
  assert.match(block.content, /style to avoid/);
});
