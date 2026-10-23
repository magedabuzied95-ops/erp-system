import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { gradeQuestionText, withPendingGradeQuery, GRADE_QUESTION_INTENT } from "../../server/services/aiBrainV2Service.js";
import { SKIP_INTENTS } from "../../server/services/aiClaudeSalesAgentService.js";
import { captionShoeSize, visualSizeAnswer, buildVisualRecognitionPayload } from "../../server/services/aiInboxService.js";
import { samePictureRow } from "../../server/services/aiVisualProductRecognitionService.js";
import { PRODUCT_GRADES } from "../../server/config/productGrades.js";

/** The owner's WhatsApp test, 2026-10-23 (Air Max 97, then a Jordan 4 photo asking for 45). */
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const grade = (key) => PRODUCT_GRADES.find((item) => item.key === key);

test("a model in two grades asks which one, in the owner's words", () => {
  assert.equal(
    gradeQuestionText({ grades: [grade("local"), grade("mirror_original")], modelName: "Nike Air Max 97" }),
    "Nike Air Max 97 موجود مصري وميرور اوريجينال يا فندم، حضرتك محتاج أنهي فيهم؟"
  );
  assert.match(gradeQuestionText({ grades: [grade("local"), grade("imported_from_vietnam"), grade("mirror_original")] }), /مصري، مستورد فيتنامي وميرور اوريجينال/);
  assert.ok(SKIP_INTENTS.includes(GRADE_QUESTION_INTENT), "the agent never re-words it or adds cards");
});

test("the brain asks before any card, never for the agent's own searches", () => {
  const brain = read("../../server/services/aiBrainV2Service.js");
  const ask = brain.slice(brain.indexOf("const askGradeFirst"), brain.indexOf("const productCards = await buildPresentationProductCards({"));
  assert.match(ask, /intent === "product_search" && namedMatches\.length > 0 && !requestedGrade && !askedColorway/);
  assert.match(ask, /normalizedInbound\.metadata\?\.source !== "claude_agent_search"/);
  assert.match(ask, /if \(gradesSelling\.length >= 2\) \{\s*return gradeQuestionDecision\(/);
  const unified = read("../../server/services/aiUnifiedDecisionService.js");
  assert.match(unified, /"greeting", "grade_question"\]\.includes\(intent\)\) return decision;/);
});

test("«ميرور» answering the question is searched as the model plus that grade, within the hour", () => {
  const memory = { preferences: { pending_grade_question: { query: "عايز ايرماكس ٩٧", asked_at: new Date().toISOString() } } };
  assert.equal(withPendingGradeQuery("ميرور", memory), "عايز ايرماكس ٩٧ ميرور");
  assert.equal(withPendingGradeQuery("المصري", memory), "عايز ايرماكس ٩٧ المصري");
  assert.equal(withPendingGradeQuery("فيه جوردن فور؟", memory), "فيه جوردن فور؟", "no grade named: a new question");
  assert.equal(withPendingGradeQuery("ميرور", {}), "ميرور");
  const stale = { pending_grade_question: { query: "عايز ايرماكس ٩٧", asked_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() } };
  assert.equal(withPendingGradeQuery("ميرور", stale), "ميرور");
});

// The Jordan 4 «Gray» card sent back as a screenshot: CLIP 0.955 for Gray, 0.875 for Black&white.
test("our own photo sent back is that colour; a near tie is left to the vision pick", () => {
  const rows = [
    { product_id: 39, color: "Gray", similarity: 0.955 },
    { product_id: 39, color: "Black&white", similarity: 0.875 },
    { product_id: 39, color: "Grey", similarity: 0.83 },
  ];
  assert.equal(samePictureRow(rows)?.color, "Gray");
  assert.equal(samePictureRow([{ ...rows[0], similarity: 0.95 }, { ...rows[1], similarity: 0.93 }]), null, "too close to call");
  assert.equal(samePictureRow([{ ...rows[0], similarity: 0.88 }, rows[2]]), null, "a look-alike, not the same picture");
});

const jordan = [
  { color: "Black&white", available_sizes: ["42", "44", "45"] },
  { color: "black&red", available_sizes: ["41", "43", "44", "45"] },
  { color: "Gray", available_sizes: ["41", "43", "44"] },
  { color: "Navy", available_sizes: ["41", "42", "43", "44"] },
];

test("«دا موجود ٤٥ ؟» under the photo answers 45 for that colour, then where 45 is", () => {
  assert.equal(captionShoeSize("دا موجود ٤٥ ؟"), "45");
  assert.equal(captionShoeSize("ده موجود؟"), "");
  const missing = visualSizeAnswer({ cards: jordan, recognition: { photoMatch: "same", matchedColor: "Gray" }, caption: "دا موجود ٤٥ ؟" });
  assert.equal(missing.text, "اللون ده مش متاح منه مقاس 45 للأسف 🙏 المتاح منه: 41، 43، 44.\nومقاس 45 متاح في الألوان دي من نفس الموديل 👇");
  assert.deepEqual(missing.cards.map((card) => card.color), ["Black&white", "black&red"]);
  const found = visualSizeAnswer({ cards: jordan, recognition: { photoMatch: "same", matchedColor: "Navy" }, caption: "ده متاح 42؟" });
  assert.equal(found.text, "أيوه مقاس 42 متاح في اللون ده 👇");
  assert.deepEqual(found.cards.map((card) => card.color), ["Navy"]);
  assert.equal(visualSizeAnswer({ cards: jordan, recognition: { photoMatch: "closest", closest: true, matchedColor: "Gray" }, caption: "٤٥" }), null, "not sure of the colour: no size verdict");
  const payload = buildVisualRecognitionPayload({ cards: jordan, recognition: { photoMatch: "same", matchedColor: "Gray" }, caption: "دا موجود ٤٥ ؟" });
  assert.equal(payload.channel_reply.text, missing.text);
  assert.equal(payload.product_cards.length, 2);
});
