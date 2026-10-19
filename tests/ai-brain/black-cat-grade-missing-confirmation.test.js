import test from "node:test";
import assert from "node:assert/strict";

import {
  BARE_CONFIRMATION_TEXT,
  buildBaseText,
  detectExplicitModel,
  missingGradeText,
} from "../../server/services/aiBrainV2Service.js";
import { rewriteStructuredDecision } from "../../server/services/aiUnifiedDecisionService.js";
import { productGrade } from "../../server/config/productGrades.js";

/**
 * The owner's WhatsApp test, 2026-10-19:
 *  - "متاح بلاك كات ؟" got the black Air Force that was on screen, not the Jordan 4 Black Cat;
 *  - "متاح الترا بوست ميرور ؟" got Vietnamese pairs as if they were mirror;
 *  - "تمام" got "تحت أمرك. ابعت الموديل أو السؤال اللي محتاجه."
 */

test("بلاك كات names the Jordan 4", () => {
  for (const message of ["متاح بلاك كات ؟", "عايز البلاك كات", "black cat 42", "Black Cat"]) {
    assert.equal(detectExplicitModel(message)?.model, "jordan4", message);
  }
  assert.equal(detectExplicitModel("عايزه بلاك"), null, "plain black is a colour, not a model");
  assert.equal(detectExplicitModel("ايرفورس اسود"), null);
});

test("a grade the model is not sold in is said plainly, then the grades it comes in", () => {
  const cards = [
    { name: "Adidas Ultra Boost - Navy", base_name: "Adidas Ultra Boost", grade: "imported_from_vietnam" },
    { name: "Adidas Ultra Boost - Grey", base_name: "Adidas Ultra Boost", grade: "local" },
  ];
  const line = missingGradeText({ requestedGrade: productGrade("mirror_original"), cards });
  assert.equal(line, "للأسف Adidas Ultra Boost مش متاح عندنا ميرور اوريجينال دلوقتي 🙏\nبس متاح مصري ومستورد فيتنامي 👇");
});

test("the rewrite keeps the missing-grade sentence word for word", async () => {
  const sentence = "للأسف Adidas Ultra Boost مش متاح عندنا ميرور اوريجينال دلوقتي 🙏\nبس متاح مستورد فيتنامي 👇";
  const decision = {
    intent: "product_search",
    text: sentence,
    product_cards: [
      { name: "Adidas Ultra Boost - Navy", grade: "imported_from_vietnam" },
      { name: "Adidas Ultra Boost - Grey", grade: "local" },
    ],
    debug: { grade_missing_reply: { text: sentence, grade: "mirror_original" } },
  };
  const out = await rewriteStructuredDecision({ decision, inbound: { text: "متاح الترا بوست ميرور ؟" } });
  assert.equal(out.text, sentence, "neither the grade intro nor OpenAI may replace it");
});

test("a bare تمام gets a warm close, kept as written", async () => {
  assert.equal(buildBaseText({ intent: "bare_confirmation", cards: [] }), BARE_CONFIRMATION_TEXT);
  assert.doesNotMatch(BARE_CONFIRMATION_TEXT, /ابعت الموديل/);
  const decision = { intent: "bare_confirmation", text: BARE_CONFIRMATION_TEXT, product_cards: [] };
  const out = await rewriteStructuredDecision({ decision, inbound: { text: "تمام" } });
  assert.equal(out.text, BARE_CONFIRMATION_TEXT);
});
