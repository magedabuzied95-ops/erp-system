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
  assert.match(page, /await loadSessions\(\);[\s\S]{0,400}?setBranchDrawerOpen\(true\);/, "the saved count has to be visible where it landed");
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
  assert.match(page, /function CountSessionRow\(\{ row, active, busy = false, onSelect, onRename, onDelete \}\)/);
  assert.match(page, /<InventoryImage src=\{row\.cover_image_url\} alt=\{model\} \/>/);
  assert.match(page, /const model = String\(row\.cover_product_name \?\? ""\)\.trim\(\);/);
  assert.equal((page.match(/<CountSessionRow/g) || []).length, 2, "the drawer and the desktop column both use it");
});

// ---- What a count is called -----------------------------------------------

const { countSessionTitle, isUnnamedCountTitle } = await import(
  "../src/modules/employees/services/employeeDrafts/countSessionTitle.js"
);

test("a count of one model is called by that model", () => {
  assert.equal(
    countSessionTitle({ title: "جرد جديد", cover_product_name: "Nike Air Force 1", model_count: 1 }),
    "Nike Air Force 1"
  );
  // A count created on an English phone and read on an Arabic one, and the
  // other way round: both default titles have to be recognised as "unnamed".
  assert.equal(
    countSessionTitle({ title: "New stock count", cover_product_name: "Adidas Samba", model_count: 1 }),
    "Adidas Samba"
  );
  assert.equal(
    countSessionTitle({ title: "", cover_product_name: "Adidas Samba", model_count: 1 }),
    "Adidas Samba"
  );
});

test("a name the employee typed is never taken away", () => {
  assert.equal(
    countSessionTitle({ title: "جرد الرف الثالث", cover_product_name: "Nike Air Force 1", model_count: 1 }),
    "جرد الرف الثالث"
  );
});

test("a count of several models keeps the generic name", () => {
  // No single model speaks for it, and naming it after the first would be a lie.
  assert.equal(
    countSessionTitle({ title: "جرد جديد", cover_product_name: "Nike Air Force 1", model_count: 4 }),
    "جرد جديد"
  );
  assert.equal(countSessionTitle({ title: "جرد جديد", cover_product_name: "", model_count: 1 }), "جرد جديد");
  assert.equal(countSessionTitle({}), "");
});

test("the default titles are recognised whatever the casing", () => {
  assert.ok(isUnnamedCountTitle("جرد جديد"));
  assert.ok(isUnnamedCountTitle("NEW STOCK COUNT"));
  assert.ok(isUnnamedCountTitle("  "));
  assert.ok(!isUnnamedCountTitle("جرد الرف الثالث"));
});

test("the screen uses that rule, and the server sends what it needs", () => {
  assert.match(page, /import \{ countSessionTitle \} from "\.\.\/services\/employeeDrafts\/countSessionTitle\.js";/);
  assert.match(page, /const title = countSessionTitle\(row\);/, "the list row");
  assert.match(page, /const openCountTitle = useMemo\(/, "the open count names itself the same way");
  assert.match(page, /model_count: models\.length,/);
  // Saying the model name twice in one row is the thing the owner keeps asking
  // not to see.
  assert.match(page, /const subtitle = model && model !== title \? model : row\.branch_name/);
  // The server has to say how many models the count holds, or every count of
  // one model keeps the generic name.
  assert.match(service, /COUNT\(DISTINCT product_id\)::int AS model_count/);
  assert.match(service, /COALESCE\(items\.model_count, 0\)::int AS model_count/);
  // And searching for the model has to find the count that carries its name.
  assert.match(page, /\$\{row\.title \|\| ""\} \$\{row\.cover_product_name \|\| ""\}/);
});

// ---- Renaming and throwing away a count ------------------------------------

const routes = read("../server/routes/employeePortal.js");

test("a count can be renamed and deleted from the list", () => {
  assert.match(page, /onRename=\{handleRenameSession\}/, "the desktop column");
  assert.match(page, /onRename=\{onRenameSession\}/, "the drawer");
  assert.equal((page.match(/onDelete=\{(handleDeleteSession|onDeleteSession)\}/g) || []).length, 2);
  assert.match(page, /const handleRenameSession = useCallback\(async \(row, nextTitle\) => \{/);
  assert.match(page, /const handleDeleteSession = useCallback\(async \(row\) => \{/);
  // The row is a div now: a rename and a delete control cannot live inside
  // another button.
  assert.match(page, /\{\/\* The row is a div, not a button/);
});

test("deleting says what it is about to take, and cannot be undone silently", () => {
  assert.match(page, /const confirmed = window\.confirm\(\s*\n?\s*tt\("employeePortal\.stockCount\.confirmDeleteCount", \{ name: label, count: toNumber\(row\.item_count, 0\) \}\)/);
  const ar = JSON.parse(read("../src/locales/ar/employeePortal.json"));
  const en = JSON.parse(read("../src/locales/en/employeePortal.json"));
  for (const copy of [ar.stockCount.confirmDeleteCount, en.stockCount.confirmDeleteCount]) {
    assert.match(copy, /\{\{name\}\}/, "the employee has to be told WHICH count");
    assert.match(copy, /\{\{count\}\}/, "and how much goes with it");
  }
  // Nothing local may outlive the count, or the next flush re-creates it.
  assert.match(page, /await clearInventoryDraft\(\{ \.\.\.draftIdentity, sessionId: row\.id \}\);/);
  assert.match(page, /setOutbox\(\{\}\);\s*\n\s*setItems\(\[\]\);\s*\n\s*setSession\(null\);/);
});

test("a count already with the manager is nobody's to change from a phone", () => {
  // The row hides the controls…
  assert.match(page, /const editable = \["draft", "in_progress"\]\.includes\(status\);/);
  assert.match(page, /\{editable \? \(/);
  // …and the server refuses anyway, because a hidden button is not a rule.
  assert.match(routes, /router\.delete\("\/:token\/inventory\/sessions\/:sessionId"/);
  assert.match(routes, /if \(!\["draft", "in_progress"\]\.includes\(status\)\) \{[\s\S]{0,320}?inventory_count_session_not_deletable/);
  // It deletes through loadEmployeeInventorySession, which owns the branch and
  // owner checks — a count that is not yours cannot be deleted by id.
  assert.match(routes, /router\.delete\("\/:token\/inventory\/sessions\/:sessionId",[\s\S]{0,200}?loadEmployeeInventorySession\(req, res\)/);
  // And the employee id travels as an employee, not as a users row.
  assert.match(routes, /deletedByEmployeeId: scoped\.employee\.id \|\| null,/);
  assert.match(service, /deleted_by_employee_id: normalizeNullableId\(data\.deletedByEmployeeId/);
});

test("the list of counts is wide enough to read on a phone", () => {
  assert.match(page, /className="absolute inset-y-0 end-0 flex h-full w-full flex-col[^"]*sm:w-\[min\(100vw,30rem\)\]"/);
  assert.doesNotMatch(page, /w-\[min\(100vw,22rem\)\]/, "22rem truncated the model names it now leads with");
});

// ---- Putting a count down actually puts it down ---------------------------

test("parking a count closes the sheet", () => {
  assert.match(page, /const closeOpenCount = useCallback\(\(\) => \{/);
  assert.match(page, /closeOpenCount\(\);\s*\n\s*setBranchDrawerOpen\(true\);/, "save as draft");
  assert.match(page, /if \(String\(row\.id\) === String\(session\?\.id\)\) closeOpenCount\(\);/, "deleting the open count");
  // Everything the open count was holding goes with it.
  assert.match(page, /setOutbox\(\{\}\);\s*\n\s*setItems\(\[\]\);\s*\n\s*setSession\(null\);\s*\n\s*setSelectedSessionId\(""\);/);
});

test("a count that was put down does not open itself again", () => {
  // Two effects would otherwise pick it straight back up: the arrival
  // convenience, and the route, whose address bar still names it for a render
  // or two after the navigate.
  assert.match(page, /if \(autoSelectedRef\.current \|\| routeSessionId \|\| selectedSessionId/);
  assert.match(page, /autoSelectedRef\.current = true;\s*\n\s*setSelectedSessionId\(String\(preferred\.id\)\);/, "arriving counts as having chosen");
  assert.match(page, /routeSessionId !== closedSessionRef\.current/);
  assert.match(page, /closedSessionRef\.current = String\(routeSessionId \|\| session\?\.id \|\| ""\);/);
  // Picking it again undoes the suppression, or it could never be reopened.
  assert.match(page, /const selectSession = useCallback\(\(nextSessionId\) => \{\s*\n[\s\S]{0,120}?closedSessionRef\.current = "";/);
});

test("leaving a count keeps the installed app inside its own shell", () => {
  // A hardcoded /employee-portal throws /employee-app and /employee/portal out
  // of their routes.
  assert.doesNotMatch(page, /navigate\(`\/employee-portal\/\$\{encodeURIComponent\(token\)\}\/inventory/);
  assert.match(page, /navigate\(`\$\{buildEmployeePortalHomePath\(\{ pathname: window\.location\.pathname, token \}\)\}\/inventory`, \{ replace: true \}\)/);
  assert.match(page, /const base = buildEmployeePortalHomePath\(\{ pathname: window\.location\.pathname, token \}\);\s*\n\s*navigate\(`\$\{base\}\/inventory\/\$\{encodeURIComponent\(nextSessionId\)\}`\)/);
});

// ---- Who took the count, and when ------------------------------------------

test("every count says who took it and when", () => {
  assert.match(page, /function CountTakenBy\(\{ row, className = "" \}\)/);
  assert.match(page, /const who = String\(row\?\.created_by_employee_name \?\? ""\)\.trim\(\);/);
  assert.match(page, /const when = countTakenAt\(row\?\.created_at\);/);
  // Both surfaces: the row in the list and the count that is open.
  assert.match(page, /<CountTakenBy row=\{row\} className="mt-0\.5" \/>/, "the list row");
  assert.match(page, /<CountTakenBy row=\{session\} className="mt-1" \/>/, "the open count");
});

test("the time shown is the shop's clock, with a month nobody has to decode", () => {
  // A phone on another zone would date the count a day out in a record read a
  // year later, and ١٠/١٠ cannot be read as a date without guessing an order.
  assert.match(page, /formatInAppTimezone\(\s*\n?\s*value,\s*\n?\s*\{ day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" \}/);
  assert.match(page, /import \{ formatInAppTimezone \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/appTimezone";/);
  assert.doesNotMatch(page, /countTakenAt = \(value\) =>\s*\n?\s*new Date\(/, "never the device's own formatting");
  assert.match(page, /i18n\.language === "en" \? "en-GB" : "ar-EG"/);
});

test("the name comes from the employee record, so it outlives the person leaving", () => {
  // Employees are archived, not erased, so the join still resolves their name.
  // BOTH surfaces select it — the list and the open count — and dropping it
  // from one leaves that screen quietly nameless.
  assert.equal(
    (service.match(/ce\.full_name AS created_by_employee_name/g) || []).length,
    2,
    "the sessions list and the single-session read both need the name"
  );
  assert.equal(
    (service.match(/LEFT JOIN employees ce ON ce\.id = s\.created_by_employee_id/g) || []).length,
    3,
    "those two queries plus the count query they share a WHERE with"
  );
  // A count with no name on it shows the date alone instead of inventing one.
  assert.match(page, /if \(!who && !when\) return null;/);
  assert.match(page, /\{who \? \(/);
});
