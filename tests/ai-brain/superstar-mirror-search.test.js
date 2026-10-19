import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";
import { productNamingTerms } from "../../server/utils/productNamingTerms.js";

/**
 * The owner's WhatsApp test, production, 2026-10-19 22:59: "سوبر استار ميرور". The alias table knew
 * only the joined spelling "سوبرستار", so the two-word spellings named nothing at all and the
 * Superstar the store sells was never searched for.
 *
 * Brain V2 runs for real against a stubbed catalog (pool.query), as in named-model-requested-grade.
 */

const superstarMirror = { id: 48, name: "Adidas Superstar Black White Sneakers", grade: "mirror_original", status: "active", total_stock: 9, tenant_id: 1 };
const superstarLocal = { id: 731, name: "Adidas Superstar Local", grade: "local", status: "active", total_stock: 5, tenant_id: 1 };
const allStar = { id: 90, name: "Converse All Star", grade: "mirror_original", status: "active", total_stock: 4, tenant_id: 1 };
const samba = { id: 70, name: "Adidas Samba", grade: "mirror_original", status: "active", total_stock: 7, tenant_id: 1 };

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

const { generateAiBrainV2Decision } = await import("../../server/services/aiBrainV2Service.js");
const { rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");

const ask = (raw) => generateAiBrainV2Decision(
  { channel: "whatsapp", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory: {} },
);
const ids = (decision) => (decision.products || []).map((product) => product.id);

test("every Superstar spelling names the Superstar", () => {
  for (const raw of ["سوبر استار ميرور", "سوبر ستار", "سوبرستار", "superstar", "super star"]) {
    const terms = productNamingTerms(raw);
    assert.ok(terms.includes("superstar") || terms.includes("super star"), `${raw} → ${JSON.stringify(terms)}`);
  }
});

for (const raw of ["سوبر استار ميرور", "سوبر ستار ميرور", "super star mirror"]) {
  test(`${raw} — the mirror Superstar only`, async () => {
    catalog = [superstarMirror, superstarLocal, allStar, samba];
    const decision = await ask(raw);
    assert.equal(decision.intent, "product_search");
    assert.deepEqual(ids(decision), [48]);
    assert.equal(decision.debug.grade_found_reply?.grade, "mirror_original");
    const out = await rewriteStructuredDecision({ decision, inbound: { text: raw } });
    assert.equal(out.text, "أيوه يا فندم، Adidas Superstar Black White Sneakers متاح عندنا ميرور اوريجينال 👇");
  });
}

test("no mirror Superstar: said plainly, the grade it does come in is offered", async () => {
  catalog = [superstarLocal, allStar, samba];
  const decision = await ask("سوبر استار ميرور");
  assert.deepEqual(ids(decision), [731], "another model's mirror is not a Superstar");
  assert.match(decision.text, /^للأسف .+ مش متاح عندنا ميرور اوريجينال دلوقتي 🙏\nبس متاح مصري 👇$/);
});
