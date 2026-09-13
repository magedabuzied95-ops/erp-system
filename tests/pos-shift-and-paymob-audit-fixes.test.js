import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const posSource = read("../server/controllers/posController.js");
const expensesSource = read("../server/routes/expenses.js");
const ordersRoutesSource = read("../server/routes/orders.js");

const sliceBetween = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  const to = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, to > from ? to : undefined);
};

test("a duplicated Paymob event is replayed without adding its amount again", () => {
  const apply = sliceBetween(posSource, "const applyPaymobConfirmation", "const applyConfirmedPaymentToOrder");
  const replayAt = apply.search(/if \(event\.replay\) \{[\s\S]*?return \{\s*replay: true,/);
  const updateAt = apply.indexOf("UPDATE payment_transactions");
  const orderAt = apply.indexOf("applyConfirmedPaymentToOrder(client");
  assert.ok(replayAt > 0, "event.replay must short-circuit");
  assert.ok(replayAt < updateAt && replayAt < orderAt, "the replay return must come before any write");
});

test("manual terminal confirm: cashier limits, provider check, website order vocabulary", () => {
  const manual = sliceBetween(posSource, "const manualConfirmPaymobTransaction", "const normalizeRole = ");
  assert.match(manual, /\bif \(manualConfirmBlockedStatuses\.has\(String\(providerStatus \|\| ""\)\.toLowerCase\(\)\)\) \{[\s\S]*?error\.status = 409/);
  assert.match(manual, /if \(!canOverride\) \{\s*if \(manualConfirmBlockedStatuses\.has\(String\(transaction\.status \|\| ""\)\.toLowerCase\(\)\)\) \{[\s\S]*?error\.status = 403/);
  assert.match(manual, /if \(!transaction\.created_by \|\| !userId \|\| Number\(transaction\.created_by\) !== Number\(userId\)\) \{[\s\S]*?error\.status = 403/);
  assert.match(manual, /order = await applyConfirmedPaymentToOrder\(client, \{/);
  assert.doesNotMatch(manual, /THEN 'Paid'/);
  assert.match(manual, /confirmed_by = \$3/);
  assert.match(posSource, /const manualConfirmBlockedStatuses = new Set\(\["failed", "cancelled"\]\);/);

  const helper = sliceBetween(posSource, "const applyConfirmedPaymentToOrder", "const manualConfirmBlockedStatuses");
  assert.match(helper, /if \(isStorefrontOrder\) \{[\s\S]*?THEN 'confirmed'[\s\S]*?\} else \{[\s\S]*?THEN 'Paid'/);

  const handler = sliceBetween(posSource, "export const manuallyConfirmPaymobTerminalPayment", null);
  assert.match(handler, /const providerStatus = [\s\S]*?await lookupPaymobProviderStatus\(pendingTransaction\)/);
  assert.match(handler, /canOverride,\s*providerStatus,/);
  const lookup = sliceBetween(posSource, "const lookupPaymobProviderStatus", "const manualConfirmPaymobTransaction");
  assert.match(lookup, /await getOrderStatus\(\{/);
});

test("a POS quick expense refuses non-numeric and absurd amounts", () => {
  const quick = sliceBetween(posSource, "export const createQuickPosExpense", "await client.query(\"BEGIN\")");
  assert.match(quick, /const amount = Number\.isFinite\(rawAmount\) \? money\(rawAmount\) : NaN;/);
  assert.match(quick, /if \(!Number\.isFinite\(amount\) \|\| amount <= 0\) return res\.status\(400\)/);
  assert.match(quick, /if \(amount > POS_QUICK_EXPENSE_MAX_AMOUNT\) \{\s*return res\.status\(400\)/);
  assert.match(posSource, /const POS_QUICK_EXPENSE_MAX_AMOUNT = 1000000;/);
});

test("a back-office cash expense is tied to the shift whose drawer it came out of", () => {
  const post = sliceBetween(expensesSource, "const postExpenseAccounting", "await recordFinancialAccountActivity");
  assert.match(post, /const drawerEvent = await recordCashDrawerEvent\(client, \{/);
  assert.match(post, /if \(drawerEvent\?\.shift_id && !expense\.shift_id\) \{\s*await client\.query\(`UPDATE expenses SET shift_id = \$1 WHERE id = \$2`, \[drawerEvent\.shift_id, expense\.id\]\);/);
});

test("closing a shift requires the counted cash to be sent explicitly", () => {
  const close = sliceBetween(posSource, "export const closePosShift", "export const createQuickPosExpense");
  assert.match(close, /rawClosingCash === undefined \|\| rawClosingCash === null \|\| String\(rawClosingCash\)\.trim\(\) === ""\s*\? NaN/);
  assert.match(close, /if \(!Number\.isFinite\(closingCash\) \|\| closingCash < 0\) \{\s*return res\.status\(400\)/);
  assert.match(close, /actualCash: closingCash,/);
  assert.doesNotMatch(close, /req\.body\?\.actualCash \?\? 0/);
});

test("a double-click open maps the unique-index violation to 409 with the open shift", () => {
  const open = sliceBetween(posSource, "export const openPosShift", "export const closePosShift");
  assert.match(open, /if \(error\?\.code === "23505" \|\| error\?\.status === 409\) \{[\s\S]*?getCurrentCashDrawerShift\(db,[\s\S]*?res\.status\(409\)\.json\(\{[\s\S]*?shift: existingShift/);
});

test("the legacy attendance shift report is limited to accounting viewers", () => {
  assert.match(
    ordersRoutesSource,
    /"\/shift-report\/:attendanceLogId",\s*protect,\s*permit\("orders", "view"\),\s*permit\("accounting", "view"\),\s*getShiftReport/
  );
});

test("a shift closed after midnight picks the opener for the same calendar day", async () => {
  const { getDefaultOpeningWorkDate } = await import("../server/services/openingShiftService.js");
  const zone = "Africa/Cairo";
  // 2026-09-15 00:30 Cairo (UTC+3 in September) is 2026-09-14 21:30 UTC.
  assert.equal(getDefaultOpeningWorkDate(new Date("2026-09-14T21:30:00Z"), zone), "2026-09-15");
  // 04:59 Cairo is still the night before.
  assert.equal(getDefaultOpeningWorkDate(new Date("2026-09-15T01:59:00Z"), zone), "2026-09-15");
  // 05:00 Cairo and later: tomorrow.
  assert.equal(getDefaultOpeningWorkDate(new Date("2026-09-15T02:00:00Z"), zone), "2026-09-16");
  // 23:00 Cairo on the 14th: the 15th.
  assert.equal(getDefaultOpeningWorkDate(new Date("2026-09-14T20:00:00Z"), zone), "2026-09-15");
});
