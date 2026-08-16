import assert from "node:assert/strict";
import test from "node:test";

import { francoToArabic, looksLikeFranco, withFrancoExpansion } from "../../server/utils/francoArabic.js";
import { understandCustomerMessage } from "../../server/services/aiUnderstandingService.js";

test("franco is recognised by its digit-letters", () => {
  for (const message of ["3ayez crocs", "bkam da?", "el se3r kam", "msh 3ageb"]) {
    assert.equal(looksLikeFranco(message), true, `${message} should read as franco`);
  }
});

test("plain English is not treated as franco", () => {
  // The vocabulary would mangle real English ("el" -> "ال", "fe" -> "فيه"), so the
  // detector has to keep genuinely English messages away from it.
  for (const message of ["do you have crocs in size 44", "how much is this", "hello"]) {
    assert.equal(looksLikeFranco(message), false, `${message} must not read as franco`);
  }
});

test("pure Arabic is not treated as franco", () => {
  assert.equal(looksLikeFranco("عايز كروكس مقاس 44"), false);
});

test("brands and sizes survive the rewrite for the Latin retrievers", () => {
  // The catalog is Latin. Rewriting "crocs" into Arabic would break the very lookup
  // the message exists to trigger.
  const rewritten = francoToArabic("3ayez crocs mas 44");
  assert.match(rewritten, /crocs/, "the brand must stay Latin");
  assert.match(rewritten, /44/, "the size must survive");
  assert.match(rewritten, /مقاس/, "the intent word must become Arabic");
});

test("expansion keeps both scripts rather than replacing one", () => {
  // A mixed message carries signal in each half.
  const expanded = withFrancoExpansion("عايز crocs mas 44");
  assert.match(expanded, /crocs/);
  assert.match(expanded, /مقاس/);
});

test("expansion is a no-op on text that is not franco", () => {
  assert.equal(withFrancoExpansion("do you have crocs"), "do you have crocs");
  assert.equal(withFrancoExpansion("عايز كروكس"), "عايز كروكس");
  assert.equal(withFrancoExpansion(""), "");
});

test("franco messages reach the same intents their Arabic equivalents do", async () => {
  const cases = [
    ["bkam da?", "price_question"],
    ["el se3r kam", "price_question"],
    ["3andokom puma?", "product_availability"],
    ["msh 3ageb ghali awy", "objection"],
    ["3ayez akalem mowazaf", "human_handoff"],
  ];
  for (const [message, expected] of cases) {
    const understanding = await understandCustomerMessage({ tenantId: null, message });
    assert.equal(understanding.primary_intent, expected, `${message} should read as ${expected}`);
  }
});

test("an angry franco customer still reaches a human", async () => {
  // The failure this prevents: a refund demand typed in Latin letters being answered
  // with product suggestions, which is what happened before the rewrite existed.
  const understanding = await understandCustomerMessage({ tenantId: null, message: "3ayez felosy terga3" });
  assert.equal(understanding.requires_human, true);
});

test("entities still resolve from a franco message", async () => {
  const understanding = await understandCustomerMessage({ tenantId: null, message: "3ayez crocs mas 44" });
  assert.equal(understanding.entities.brand, "Crocs");
  assert.equal(understanding.entities.size, "44");
});

test("English messages keep working unchanged", async () => {
  const understanding = await understandCustomerMessage({
    tenantId: null,
    message: "do you have crocs in size 44",
  });
  assert.equal(understanding.primary_intent, "product_availability");
  assert.equal(understanding.entities.brand, "Crocs");
});
