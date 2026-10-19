import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import pool from "../../server/database/db.js";

/**
 * The owner, 2026-10-19: the grade notes are his own words; the bot mentions that prices differ
 * between grades and leaves each price on its card; warranty / exchange comes from what the
 * invoice says. The online invoice's policy is read from Invoice Studio, the same row the printed
 * invoice uses, so an edit there reaches the bot without a deploy.
 */

const ONLINE_POLICY = "يمكنك الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام.";
let policyEnabled = true;
pool.query = async (sql) => {
  const query = String(sql);
  if (/FROM invoice_templates/.test(query)) {
    return { rows: [{ id: 1, tenant_id: 1, name: "default", is_default: true, scope_channel: "all", scope_branch_id: null,
      config: { footer: { return_policy_enabled: policyEnabled, return_policy_ar: ONLINE_POLICY } } }] };
  }
  return { rows: [] };
};

const { gradeGuideFor, storeReturnPolicyFor } = await import("../../server/services/aiUnifiedDecisionService.js");

test("the grade guide carries the owner's notes, local first", () => {
  const guide = gradeGuideFor([{ grade: "mirror_original" }, { grade: "imported_from_vietnam" }, { grade: "local" }]);
  assert.deepEqual(guide.map((entry) => entry.grade_label), ["محلي", "مستورد فيتنامي", "ميرور اوريجينال"]);
  assert.match(guide[0].note, /مصري/);
  assert.match(guide[1].note, /تشطيب أنضف/);
  assert.match(guide[2].note, /طبق الأصل/);
});

test("the exchange policy is the online invoice's own text", async () => {
  assert.equal(await storeReturnPolicyFor(1), ONLINE_POLICY);
});

test("a policy hidden on the invoice is not promised in chat", async () => {
  policyEnabled = false;
  const { resetInvoiceTemplateResolveCache } = await import("../../server/services/invoiceTemplateService.js").catch(() => ({}));
  if (typeof resetInvoiceTemplateResolveCache === "function") resetInvoiceTemplateResolveCache();
  const value = await storeReturnPolicyFor(2);
  policyEnabled = true;
  assert.equal(value, "");
});

test("the rewrite gets the policy and the price and warranty rules", () => {
  const unified = fs.readFileSync(new URL("../../server/services/aiUnifiedDecisionService.js", import.meta.url), "utf8");
  assert.match(unified, /store_return_policy: await storeReturnPolicyFor\(tenantId\),/);
  const openai = fs.readFileSync(new URL("../../server/services/openaiSupportService.js", import.meta.url), "utf8");
  assert.match(openai, /prices differ from grade to grade and that each card carries its own price; do not write the prices/);
  assert.match(openai, /answer with store_return_policy, keeping its terms as written\. Never promise a warranty/);
});
