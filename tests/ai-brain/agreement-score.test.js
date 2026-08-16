import assert from "node:assert/strict";
import test from "node:test";

import {
  AGREEMENT_VERDICTS,
  scoreAgreement,
  similarityScore,
  summarizeAgreement,
} from "../../server/services/aiAgreementScoreService.js";

const DRAFT = "أهلاً بيك 🌹 الكروكس متوفر مقاس 44 بسعر 950 جنيه، تحب أحجزهولك؟";

test("a reply sent unchanged scores as sent_as_is", () => {
  const result = scoreAgreement({ draftText: DRAFT, sentText: DRAFT });
  assert.equal(result.verdict, "sent_as_is");
  assert.equal(result.similarity, 1);
});

test("orthography and emoji are not disagreement", () => {
  // An employee fixing a hamza or dropping an emoji has not disagreed with the draft.
  // Without folding, Arabic spelling variation alone would depress every score and the
  // metric would report a problem that does not exist.
  const sent = "اهلا بيك الكروكس متوفر مقاس 44 بسعر 950 جنيه، تحب احجزهولك؟";
  const result = scoreAgreement({ draftText: DRAFT, sentText: sent });
  assert.equal(result.verdict, "sent_as_is", `scored ${result.similarity}`);
});

test("a small factual edit is lightly_edited, not agreement", () => {
  const sent = "أهلاً بيك 🌹 الكروكس متوفر مقاس 44 بسعر 1050 جنيه، تحب أحجزهولك؟";
  const result = scoreAgreement({ draftText: DRAFT, sentText: sent });
  assert.equal(result.verdict, "lightly_edited");
});

test("a full rewrite is recorded as a rewrite", () => {
  const sent = "للأسف المقاس ده خلص من عندنا، بس ممكن أرشحلك موديل تاني قريب منه.";
  const result = scoreAgreement({ draftText: DRAFT, sentText: sent });
  assert.equal(result.verdict, "rewritten");
});

test("a draft the employee never used counts as discarded, not as missing data", () => {
  // The strongest evidence against autonomy. Treating it as "no data" would quietly
  // remove the worst cases from the denominator and inflate the readiness rate.
  const result = scoreAgreement({ draftText: DRAFT, sentText: "" });
  assert.equal(result.scored, true);
  assert.equal(result.verdict, "discarded");
  assert.equal(result.similarity, 0);
});

test("no draft is not scored at all", () => {
  const result = scoreAgreement({ draftText: "", sentText: "أهلاً" });
  assert.equal(result.scored, false);
  assert.equal(result.reason, "no_draft");
});

test("keeping the draft and adding to it scores higher than deleting half of it", () => {
  // These mean opposite things: an addition is the AI being incomplete, a deletion is
  // the AI being wrong. Plain Jaccard would punish both equally.
  const added = similarityScore(DRAFT, `${DRAFT} ولو حابب أبعتلك صور تانية قولي.`);
  const deleted = similarityScore(DRAFT, "الكروكس متوفر.");
  assert.ok(added > deleted, `addition ${added} must outrank deletion ${deleted}`);
});

test("an empty sample reports insufficient data rather than a rate", () => {
  const summary = summarizeAgreement([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.auto_send_ready_rate, null);
  assert.equal(summary.recommendation, "insufficient_data");
});

test("a small sample never recommends autonomy, however perfect", () => {
  // A 100% rate over nine replies is not evidence. The sample floor is as much a part
  // of the recommendation as the rate.
  const perfect = Array.from({ length: 9 }, () => ({ scored: true, verdict: "sent_as_is", similarity: 1 }));
  assert.equal(summarizeAgreement(perfect).recommendation, "insufficient_data");
});

test("heavily edited drafts do not count toward auto-send readiness", () => {
  // "the employee kept about half of it" is not evidence that sending the whole thing
  // unattended would have been fine.
  const scores = [
    ...Array.from({ length: 60 }, () => ({ scored: true, verdict: "sent_as_is", similarity: 1 })),
    ...Array.from({ length: 60 }, () => ({ scored: true, verdict: "heavily_edited", similarity: 0.6 })),
  ];
  const summary = summarizeAgreement(scores);
  assert.equal(summary.auto_send_ready_rate, 0.5);
  assert.equal(summary.recommendation, "keep_human_approval");
});

test("a strong, large sample supports autonomy without enabling it", () => {
  const scores = Array.from({ length: 200 }, (_, index) => ({
    scored: true,
    verdict: index < 190 ? "sent_as_is" : "rewritten",
    similarity: index < 190 ? 1 : 0.2,
  }));
  const summary = summarizeAgreement(scores);
  assert.equal(summary.recommendation, "autonomy_supported");
  // It is a recommendation, not a switch: nothing here turns anything on.
  assert.ok(!("enabled" in summary));
});

test("unscored entries are excluded from the denominator", () => {
  const scores = [
    { scored: true, verdict: "sent_as_is", similarity: 1 },
    { scored: false, reason: "no_draft" },
  ];
  assert.equal(summarizeAgreement(scores).total, 1);
});

test("every verdict the scorer produces is a declared verdict", () => {
  const produced = [
    scoreAgreement({ draftText: DRAFT, sentText: DRAFT }).verdict,
    scoreAgreement({ draftText: DRAFT, sentText: "" }).verdict,
    scoreAgreement({ draftText: DRAFT, sentText: "كلام مختلف تماماً عن ده" }).verdict,
  ];
  for (const verdict of produced) assert.ok(AGREEMENT_VERDICTS.includes(verdict), `${verdict} is undeclared`);
});
