/*
 * How an employee finds their way around their own counts.
 *
 * What these guard: the list of counts is one icon in the top bar instead of a
 * card that held nothing else on a phone; parking a count is an act the
 * employee can perform, not just something that happens; and a count is
 * recognised in the list by its first model's picture, because every count is
 * called "جرد جديد" until someone renames it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/modules/employees/pages/EmployeePortalInventory.jsx");
const nav = read("../src/modules/employees/components/EmployeePortalNavControls.jsx");
const service = read("../server/services/inventoryCountService.js");

test("the list of counts is an icon in the top bar, not a card", () => {
  assert.match(nav, /trailing = null,/, "the nav row has to be able to carry a control");
  assert.match(nav, /\$\{trailing \? "justify-between" : "justify-start"\}/, "a trailing control belongs at the far end");
  assert.match(page, /trailingClassName="lg:hidden"/, "a desktop keeps its own column, and an empty pill is not a control");
  assert.match(page, /trailing=\{\([\s\S]{0,800}?<Menu className="h-5 w-5" \/>/);
  // The card the button used to live in no longer renders on a phone.
  assert.match(page, /<section className="hidden rounded-\[var\(--radius-card\)\][^"]*lg:block">/);
  assert.doesNotMatch(
    page,
    /lg:hidden"\s*\n\s*aria-label=\{tt\("employeePortal\.stockCount\.branchCounts"\)\}\s*\n\s*>\s*\n\s*<Menu className="h-4 w-4" \/>\s*\n\s*\{tt\("employeePortal\.stockCount\.branchCounts"\)\}/,
    "the old in-card button is gone"
  );
});

test("parking a count is a button, and it ends on the list", () => {
  assert.match(page, /const handleSaveDraft = useCallback\(async \(\) => \{/);
  // Everything still owed goes out first, or the employee is told it did not.
  assert.match(page, /setSessionSavingDraft\(true\);[\s\S]{0,400}?flushOutbox\(\{ silent: false \}\)/);
  assert.match(page, /await loadSessions\(\);\s*\n\s*setBranchDrawerOpen\(true\);/, "the saved count has to be visible where it landed");
  assert.match(page, /onClick=\{handleSaveDraft\}/);
  assert.match(page, /employeePortal\.stockCount\.saveDraft/);
  const ar = JSON.parse(read("../src/locales/ar/employeePortal.json"));
  const en = JSON.parse(read("../src/locales/en/employeePortal.json"));
  for (const key of ["saveDraft", "draftSaved"]) {
    assert.ok(ar.stockCount[key], `ar is missing ${key}`);
    assert.ok(en.stockCount[key], `en is missing ${key}`);
  }
});

test("a count is recognised in the list by its first model's picture", () => {
  // Server: the cover comes from the first row put on the sheet.
  assert.match(service, /cover\.cover_image_url,\s*\n\s*cover\.cover_product_name/);
  assert.match(service, /LEFT JOIN LATERAL \([\s\S]{0,600}?ORDER BY ci\.created_at ASC, ci\.id ASC\s*\n\s*LIMIT 1\s*\n\s*\) cover ON TRUE/);
  // Screen: one row component, so the phone's drawer and the desktop column
  // can never drift apart.
  assert.match(page, /function CountSessionRow\(\{ row, active, onSelect \}\)/);
  assert.match(page, /<InventoryImage src=\{row\.cover_image_url\} alt=\{row\.cover_product_name \|\| ""\} \/>/);
  assert.match(page, /\{row\.cover_product_name \|\| row\.branch_name/);
  assert.equal((page.match(/<CountSessionRow/g) || []).length, 2, "the drawer and the desktop column both use it");
});
