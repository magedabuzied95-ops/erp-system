import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  addressRulesFor,
  genderizeDecision,
  genderizeReply,
  inferCustomerGender,
  resolveCustomerGender,
} from "../../server/utils/customerGender.js";
import { buildInstructions, DEFAULT_PERSONA } from "../../server/services/aiPersonaService.js";

/**
 * The owner, 2026-10-20, after seeing GENI ERP's agent: a woman must be spoken to as a woman, and
 * when the name says nothing the reply stays neutral. The gender is decided once, from the name,
 * never guessed by the reply writer.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const genderOf = (name) => inferCustomerGender(name).gender;

test("real chat names from the inbox", () => {
  for (const name of ["SAMAR🌸", "RASHA KAMEL", "Heba Gamal El-Dine", "Dr.Amany", "ph.Dina", "Marwa samir", "Miss Samar Samy", "شيماء", "ام حور", "منى", "مروه", "دينا", "Zeinab Medhat", "EMAN"]) {
    assert.equal(genderOf(name), "female", name);
  }
  for (const name of ["Mohamed Khalil", "Adam🥰yehia🥰omar", "مصطفى", "يحيى", "حمزة", "طه", "رضا", "مينا", "عبدالرحمن", "أبو كريم", "ahmed.tours", "Mostafa", "Akram Aboud"]) {
    assert.equal(genderOf(name), "male", name);
  }
});

test("no sign, a shared name or a username stays unknown", () => {
  for (const name of ["", ".", "01277496336", "妮哈尔", "نور", "Alaa", "Ragaa Al-sharkawy", "nadakalabala@gmail.com", "rodyandmohamed554", "Bosy"]) {
    assert.equal(genderOf(name), "unknown", name);
  }
});

test("only the first name counts — the second word is the father's", () => {
  assert.equal(genderOf("Yasmin Mohamed"), "female");
  assert.equal(genderOf("Amira Samy"), "female");
  assert.equal(genderOf("Elham Hamdy"), "female");
});

test("kunya and titles decide before the name", () => {
  assert.equal(genderOf("om_yousef"), "female");
  assert.equal(genderOf("abo_karim"), "male");
  assert.equal(genderOf("دكتورة نور"), "female");
  assert.equal(genderOf("Mr Alaa"), "male");
});

test("a staff override wins", () => {
  assert.equal(resolveCustomerGender({ name: "Mohamed", override: "female" }).gender, "female");
  assert.equal(resolveCustomerGender({ name: "Mohamed", override: "bogus" }).gender, "male");
});

test("a template written to a man goes to a woman in the feminine", () => {
  assert.equal(genderizeReply("أهلاً بيك يا فندم", "female"), "أهلاً بيكي يا فندم");
  assert.equal(genderizeReply("أيوه متاح إن شاء الله 👇\nتحب أحجزهولك؟", "female"), "أيوه متاح إن شاء الله 👇\nتحبي أحجزهولك؟");
  assert.equal(genderizeReply("ابعتلي المقاس لو عايز", "female"), "ابعتيلي المقاس لو عايزة");
  assert.equal(genderizeReply("تحبي؟", "female"), "تحبي؟", "already feminine is left alone");
});

test("men and unknown customers get the template exactly as written", () => {
  const reply = "أهلاً بيك يا فندم\nتحب أحجزهولك؟";
  assert.equal(genderizeReply(reply, "male"), reply);
  assert.equal(genderizeReply(reply, "unknown"), reply);
});

test("every customer-facing text field of a decision is switched, together", () => {
  const decision = {
    text: "صباح النور\nتحت أمر حضرتك؟ تحب تشوف إيه؟",
    answer: "صباح النور\nتحت أمر حضرتك؟ تحب تشوف إيه؟",
    channel_reply: { text: "صباح النور\nتحت أمر حضرتك؟ تحب تشوف إيه؟" },
    reply_parts: ["صباح النور", "تحت أمر حضرتك؟ تحب تشوف إيه؟"],
  };
  const out = genderizeDecision(decision, "female");
  assert.equal(out.text, "صباح النور\nتحت أمر حضرتك؟ تحبي تشوفي إيه؟");
  assert.equal(out.channel_reply.text, out.text);
  assert.equal(out.reply_parts.join("\n"), out.text, "WhatsApp still sends the parts separately");
});

test("the model is told the gender, and told never to guess it", () => {
  const female = buildInstructions({ persona: DEFAULT_PERSONA, customerGender: "female" });
  assert.match(female, /# مخاطبة العميل:/);
  assert.match(female, /متستنتجوش من الاسم/);
  assert.match(female, /صيغة المؤنث/);
  const unknown = buildInstructions({ persona: DEFAULT_PERSONA, customerGender: "unknown" });
  assert.match(unknown, /ممنوع «أستاذ» أو «أستاذة»/);
  assert.doesNotMatch(buildInstructions({ persona: DEFAULT_PERSONA }), /# مخاطبة العميل:/, "callers that never computed it keep their prompt");
  assert.equal(addressRulesFor("male").some((line) => /صيغة المذكر/.test(line)), true);
});

test("the live decision and the Meta greeting both use it", () => {
  const unified = read("../../server/services/aiUnifiedDecisionService.js");
  assert.match(unified, /customerGender: genderRead\.gender,/);
  assert.match(unified, /if \(!agentDecision\) decision = genderizeDecision\(decision, genderRead\.gender\);/);
  const meta = read("../../server/services/metaIntegrationService.js");
  assert.match(meta, /const greetingParts = greetingReplyParts\(message\.message_text \|\| ""\)\.map\(\(part\) => genderizeReply\(part, greetingGender\)\);/);
});
