import assert from "node:assert/strict";
import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";

const cases = [
  { input: "ايوه", signals: ["yes"] },
  { input: "أيوة", signals: ["yes"] },
  { input: "اه", signals: ["yes"] },
  { input: "اها", signals: ["yes"] },
  { input: "تمام", signals: ["yes"] },
  { input: "ماشي", signals: ["yes"] },
  { input: "ينفع", signals: ["yes"] },
  { input: "لا", signals: ["no", "reject"] },
  { input: "لأ", signals: ["no", "reject"] },
  { input: "لاء", signals: ["no", "reject"] },
  { input: "مش عايز", signals: ["no", "reject"] },
  { input: "عايزه", signals: ["buy"] },
  { input: "هاخده", signals: ["buy"] },
  { input: "احجزهولي", signals: ["buy"] },
  { input: "ابعت صور", signals: ["more_images"] },
  { input: "صور تاني", signals: ["more_images"] },
  { input: "صور اكتر", signals: ["more_images"] },
  { input: "في بديل", signals: ["alternatives"] },
  { input: "لون تاني", signals: ["color"] },
  { input: "مقاس ٤٢", signals: ["size"] },
  { input: "مقاس 42", signals: ["size"] },
  { input: "بكام", signals: ["price"] },
  { input: "سعره كام", signals: ["price"] },
  { input: "فين الاوردر", signals: ["order_tracking"] },
  { input: "رقم الطلب", signals: ["order_tracking"] },
  { input: "شكرا", signals: ["thanks"] },
];

for (const { input, signals } of cases) {
  const payload = normalizeArabicIntentPayload(input);
  for (const signal of signals) {
    assert.ok(
      payload.canonicalSignals.includes(signal),
      `Expected "${input}" to include canonical signal "${signal}", got ${JSON.stringify(payload.canonicalSignals)}`
    );
  }
  console.log(JSON.stringify({
    input,
    normalizedText: payload.normalizedText,
    normalizedForIntent: payload.normalizedForIntent,
    canonicalSignals: payload.canonicalSignals,
  }));
}

console.log(`Verified ${cases.length} Arabic intent signal cases.`);
