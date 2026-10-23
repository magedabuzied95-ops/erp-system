import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";
import { productNamingTerms } from "../../server/utils/productNamingTerms.js";

/**
 * The owner's WhatsApp test, production, 2026-10-19 22:01: "متاح الترا بوست ميرور ؟" was answered
 * with 10 Vietnamese Ultra Boost cards and "كلهم مستوردين من فيتنام". The store has a mirror one —
 * id 65 "Adidas UltraBoost22" — written as one word, so the phrase "ultra boost" never matched it,
 * and dozens of imported Ultra Boost rows came first in the 40-row search.
 *
 * Brain V2 runs for real against a stubbed catalog (pool.query) shaped like production's.
 */

const imported = Array.from({ length: 45 }, (_, index) => ({
  id: 800 + index,
  name: `Adidas Ultra Boost ${index + 1}`,
  grade: "imported_from_vietnam",
  status: "active",
  total_stock: 4,
  tenant_id: 1,
}));
const mirror = { id: 65, name: "Adidas UltraBoost22", grade: "mirror_original", status: "active", total_stock: 11, tenant_id: 1 };
const local = { id: 724, name: "Adidas Ultra Boost Local", grade: "local", status: "active", total_stock: 6, tenant_id: 1 };
const skechersMirror = { id: 66, name: "Skechers Ultra Light", grade: "mirror_original", status: "active", total_stock: 3, tenant_id: 1 };

let catalog = [];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("information_schema.columns")) {
    const columns = {
      products: ["id", "name", "sku", "status", "total_stock", "tenant_id", "description", "gender", "grade"],
    }[params[0]] || [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) {
    // Filtered only when the SQL itself filters, so the test reads the query, not just the params.
    const gradeMatch = query.match(/LOWER\(COALESCE\(p\.grade, ''\)\) = \$(\d+)/);
    const grade = gradeMatch ? params[Number(gradeMatch[1]) - 1] : "";
    const patterns = params.slice(1)
      .filter((param, index) => typeof param === "string" && !(gradeMatch && index + 2 === Number(gradeMatch[1])))
      .map((param) => new RegExp(escape(param.replace(/^%|%$/g, "")), "i"));
    const hits = (row) => patterns.filter((re) => re.test(row.name)).length;
    const limit = Number(query.match(/LIMIT (\d+)/)?.[1] || 40);
    return {
      rows: catalog
        .filter((row) => !grade || row.grade === grade)
        .filter((row) => hits(row) > 0)
        .sort((left, right) => hits(right) - hits(left) || right.id - left.id)
        .slice(0, limit),
    };
  }
  if (/FROM products/.test(query) && params.length) return { rows: catalog.filter((row) => String(row.id) === String(params[0])) };
  return { rows: [] };
};

const { generateAiBrainV2Decision, namedProductTermsMatched } = await import("../../server/services/aiBrainV2Service.js");
const { gradesNamedOutsideGuide, rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");

const ask = (raw) => generateAiBrainV2Decision(
  { channel: "whatsapp", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory: {} },
);
const grades = (decision) => [...new Set((decision.products || []).map((product) => product.grade))];

test("\"Ultra Boost\" is the same name as \"UltraBoost22\"", () => {
  const terms = productNamingTerms("متاح الترا بوست ميرور ؟");
  assert.deepEqual(terms, ["ultra", "boost", "ultra boost"]);
  assert.equal(namedProductTermsMatched(mirror, terms).phrase, true);
  assert.deepEqual(productNamingTerms("ultraboost mirror"), ["ultraboost"], "a grade is never part of the name");
});

test("متاح الترا بوست ميرور ؟ — the mirror pair, said as mirror", async () => {
  catalog = [...imported, mirror, local, skechersMirror];
  const decision = await ask("متاح الترا بوست ميرور ؟");
  assert.equal(decision.intent, "product_search");
  assert.deepEqual((decision.products || []).map((product) => product.id), [65]);
  assert.equal(decision.text, "أيوه يا فندم، Adidas UltraBoost22 متاح عندنا ميرور اوريجينال 👇");
  assert.equal(decision.debug.grade_found_reply?.grade, "mirror_original");
  const out = await rewriteStructuredDecision({ decision, inbound: { text: "متاح الترا بوست ميرور ؟" } });
  assert.equal(out.text, decision.text, "OpenAI never re-describes the grade");
});

test("another grade that has the model: only that grade", async () => {
  catalog = [...imported, mirror, local];
  const egyptian = await ask("متاح الترا بوست مصري ؟");
  assert.deepEqual((egyptian.products || []).map((product) => product.id), [724]);
  assert.equal(egyptian.text, "أيوه يا فندم، Adidas Ultra Boost Local متاح عندنا مصري 👇");
  const vietnamese = await ask("عايز الترا بوست فيتنامي");
  assert.deepEqual(grades(vietnamese), ["imported_from_vietnam"]);
});

test("no mirror of the model: said plainly, the grades it does come in are labelled", async () => {
  catalog = [...imported, local, skechersMirror];
  const decision = await ask("متاح الترا بوست ميرور ؟");
  assert.ok(!(decision.products || []).some((product) => product.grade === "mirror_original"), "the Skechers mirror is another model");
  assert.match(decision.text, /^للأسف .+ مش متاح عندنا ميرور اوريجينال دلوقتي 🙏\nبس متاح مصري ومستورد فيتنامي 👇$/);
  assert.ok((decision.product_cards || []).every((card) => card.grade_label), "every card says its own grade");
});

// Owner, 2026-10-23: a model in several grades, none named → ask which one, no cards yet.
test("no grade named: the customer is asked which of the grades the model comes in", async () => {
  catalog = [...imported.slice(0, 5), mirror, local];
  const asked = await ask("متاح الترا بوست ؟");
  assert.equal(asked.intent, "grade_question");
  assert.deepEqual(asked.product_cards, []);
  assert.match(asked.text, /موجود مصري، مستورد فيتنامي وميرور اوريجينال يا فندم، حضرتك محتاج أنهي فيهم؟$/);
  assert.equal(asked.ai_memory_patch.preferences.pending_grade_question.query, "متاح الترا بوست ؟");
});

test("no grade named, for the agent's own search: every grade the model comes in", async () => {
  catalog = [...imported.slice(0, 5), mirror, local];
  const decision = await generateAiBrainV2Decision(
    { channel: "whatsapp", text: normalizeArabicIntentPayload("متاح الترا بوست ؟").normalizedForIntent, metadata: { original_message: "متاح الترا بوست ؟", tenant_id: 1, source: "claude_agent_search" } },
    { tenantId: 1, memory: {} },
  );
  assert.deepEqual(grades(decision).sort(), ["imported_from_vietnam", "local", "mirror_original"]);
  assert.equal(decision.debug.grade_found_reply, undefined);
  assert.equal(decision.debug.grade_missing_reply, undefined);
});

test("a rewrite naming a grade the cards do not carry is dropped", () => {
  const mirrorGuide = [{ grade: "mirror_original" }];
  assert.deepEqual(gradesNamedOutsideGuide("أيوه متاح، كلهم مستوردين من فيتنام", mirrorGuide), ["imported_from_vietnam"]);
  assert.deepEqual(gradesNamedOutsideGuide("متاح ميرور اوريجينال بالألوان دي", mirrorGuide), []);
  assert.deepEqual(gradesNamedOutsideGuide("متاح بالألوان دي", []), []);
  assert.deepEqual(gradesNamedOutsideGuide("ده اوريجينال", mirrorGuide), ["original"]);
});

test("«ميرور» answering the grade question shows the mirror pair of that model", async () => {
  catalog = [...imported.slice(0, 5), mirror, local];
  const asked = await ask("متاح الترا بوست ؟");
  const memory = { preferences: asked.ai_memory_patch.preferences };
  const answer = await generateAiBrainV2Decision(
    { channel: "whatsapp", text: "ميرور", metadata: { original_message: "ميرور", tenant_id: 1 } },
    { tenantId: 1, memory },
  );
  assert.deepEqual((answer.products || []).map((product) => product.id), [65]);
  assert.equal(answer.ai_memory_patch.preferences.pending_grade_question, null, "the question is closed");
});
