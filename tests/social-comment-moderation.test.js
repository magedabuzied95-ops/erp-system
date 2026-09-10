import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_BANNED_WORD_EXCEPTIONS,
  findBannedWord,
  normalizeArabicForModeration,
  normalizeModerationWordList,
} from "../server/services/socialCommentModerationService.js";

const check = (commentText, bannedWords = DEFAULT_BANNED_WORDS, exceptions = DEFAULT_BANNED_WORD_EXCEPTIONS) =>
  findBannedWord({ commentText, bannedWords, exceptions });

/* A word filter that matches a substring anywhere is not a filter, it is a random insult
   generator pointed at customers. Everything below exists to keep that from shipping. */

test("real abuse is caught", () => {
  assert.equal(check("انت شرموط").matched, true);
  assert.equal(check("يا خول").matched, true);
  assert.equal(check("this is shit").matched, true);
});

test("an insult stretched out is still the same insult", () => {
  // "زفتتتت" is "زفت" said with feeling.
  assert.equal(check("المنتج زفتتتت").matched, true);
  assert.equal(check("يا حمااااار").matched, true);
});

test("hamza, taa marbuta and harakat do not smuggle an insult through", () => {
  assert.equal(check("أحمق").matched, true, "أ folds to ا");
  assert.equal(check("غَبِيّ").matched, true, "harakat are stripped");
  assert.equal(check("يا كلــــب").matched, true, "tatweel is stripped");
});

/* ── The half that matters more ─────────────────────────────────────────────────────────────── */

test("A CUSTOMER IS NEVER FLAGGED FOR A WORD THAT MERELY CONTAINS ONE", () => {
  // Every one of these is a real thing a customer writes. Each contains a banned word as a
  // SUBSTRING. A filter that hides any of them costs a sale and insults the buyer.
  const innocent = [
    "انا زبون قديم عندكم",      // زبون contains زب
    "الشنطة وصلت مكسورة",        // مكسورة contains كس
    "عايز كسوة كاملة",           // كسوة contains كس
    "بحب الزبادي",               // الزبادي contains زب
    "المقاس ده مكسور شوية",      // مكسور contains كس
    "عندكم شنط جلد؟",
    "الالوان كلها حلوة",
    "بكام الشبشب ده",
  ];
  for (const comment of innocent) {
    const result = check(comment);
    assert.equal(result.matched, false, `"${comment}" was flagged as "${result.word}"`);
  }
});

test("an exception phrase pulls a match back", () => {
  // "زفت" is an insult and also a colour. Without the exception the filter hides a buyer.
  assert.equal(check("عايز اللون زفت").matched, false);
  assert.equal(check("عندي كلب وعايز له شبشب").matched, false);
  // …but the exception must not become a licence: the same word outside it still fires.
  assert.equal(check("المنتج زفت والخدمة اسوأ").matched, true);
});

test("the exception is reported, so a rule that keeps being cancelled is visible", () => {
  const result = check("عايز اللون زفت");
  assert.equal(result.matched, false);
  assert.equal(result.word, "زفت", "the word that was found is still named");
  assert.ok(result.exception, "and so is the phrase that cancelled it");
});

test("an empty list never matches anything", () => {
  assert.equal(findBannedWord({ commentText: "انت شرموط", bannedWords: [] }).matched, false);
  assert.equal(findBannedWord({ commentText: "", bannedWords: DEFAULT_BANNED_WORDS }).matched, false);
});

test("the shipped list is intact — mojibake would break matching in silence", () => {
  // Arabic literals in this repo have been corrupted before and simply stopped matching. If this
  // fails, check the file's encoding before touching the logic.
  assert.ok(DEFAULT_BANNED_WORDS.length > 20);
  assert.ok(DEFAULT_BANNED_WORDS.includes("شرموط"), "a known entry is missing or mangled");
  assert.ok(DEFAULT_BANNED_WORD_EXCEPTIONS.includes("لون زفت"));
  // Every shipped entry has to catch itself. Mojibake would leave the list looking full while
  // matching nothing at all — the failure mode this repo has already lived through.
  for (const word of DEFAULT_BANNED_WORDS) {
    assert.equal(
      findBannedWord({ commentText: word, bannedWords: DEFAULT_BANNED_WORDS }).matched,
      true,
      `the shipped entry "${word}" does not match itself`
    );
    assert.ok(normalizeArabicForModeration(word), `"${word}" normalises to nothing`);
  }
});

test("a tenant's list is normalised the same way the comment is", () => {
  // The owner types "أحمق" into the settings box; the comment says "احمق". Both fold to one form.
  const list = normalizeModerationWordList("أحمق\nغَبِي\n\nأحمق");
  assert.deepEqual(list, ["احمق", "غبي"], "folded, trimmed, de-duplicated");
  assert.equal(findBannedWord({ commentText: "يا احمق", bannedWords: ["أحمق"] }).matched, true);
});

test("the list also accepts one long comma-separated line", () => {
  assert.deepEqual(normalizeModerationWordList("كلب, حمار , خنزير"), ["كلب", "حمار", "خنزير"]);
});

/* ── Wiring ─────────────────────────────────────────────────────────────────────────────────────
   A matcher nobody calls at the right moment passes every test above and still ships the bug. */

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const automationSource = readSource("../server/services/socialCommentAutomationService.js");

test("the moderation gate runs BEFORE the like, the reply and the DM", () => {
  // Thanking someone for an insult and then hiding it is worse than doing either one alone.
  const gate = automationSource.indexOf("const moderationHit");
  const firstStep = automationSource.indexOf("const likeEnabled");
  assert.ok(gate > 0, "the moderation gate is gone");
  assert.ok(firstStep > 0);
  assert.ok(gate < firstStep, "moderation must be decided before any step runs");
});

test("a moderated comment ends the run instead of falling through to the steps", () => {
  const gate = automationSource.indexOf("if (moderationHit.matched) {");
  assert.ok(gate > 0);
  const block = automationSource.slice(gate, gate + 2400);
  assert.match(block, /hideComment\(/, "it has to actually hide");
  assert.match(block, /return returnWithFlowExit\(/, "and stop the run");
});

test("hiding the customer's own comment happens LAST, after they have been served", () => {
  const createLead = automationSource.lastIndexOf('step: "createLead"');
  const hideStep = automationSource.lastIndexOf('step: "hideComment"');
  assert.ok(createLead > 0 && hideStep > 0);
  assert.ok(hideStep > createLead, "the customer gets the reply and the DM before the comment goes");
});

test("nothing in this feature can delete a comment", () => {
  // Hiding is reversible and the author still sees their comment. An automatic filter must not be
  // able to destroy anything, so the delete endpoint is deliberately not wired.
  const senderSource = readSource("../server/services/marketingCommentAutomationService.js");
  assert.ok(!/deleteComment\s*[=(]/.test(senderSource), "a delete path appeared in the sender");
  assert.ok(!/method:\s*"DELETE"/.test(senderSource), "a DELETE call appeared in the sender");
  assert.match(senderSource, /export const hideComment/);
  assert.match(senderSource, /export const unhideComment/, "the undo has to exist too");
});

test("both switches ship OFF", () => {
  // The filter hides real customers when it is wrong, and hiding every comment costs reach.
  // Neither is a thing to turn on for a shop without them looking first.
  assert.match(
    readSource("../server/services/socialAutomationSettingsService.js"),
    /banned_words_enabled:\s*false/,
    "the word filter must ship disarmed"
  );
  assert.match(
    readSource("../server/services/socialCommentsCenterService.js"),
    /hideComments:\s*value\.hideComments\s*\?\?\s*value\.hide_comments\s*\?\?\s*false/,
    "hiding customer comments must default to off per post"
  );
});
