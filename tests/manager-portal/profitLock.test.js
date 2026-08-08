import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../../server/services/managerProfitLock.js";

test("locked payload contains no profit values", () => {
  assert.deepEqual(L.lockedProfitPayload(), {
    profit_locked: true, profit: null, profit_margin: null, profit_change_percent: null,
  });
});

test("profit margin: normal, zero-sales, and NaN/Infinity safety", () => {
  assert.equal(L.computeProfitMargin(300, 1000), 30);
  assert.equal(L.computeProfitMargin(24850, 113470.3), 21.9);
  assert.equal(L.computeProfitMargin(500, 0), 0);      // zero sales -> 0, never Infinity
  assert.equal(L.computeProfitMargin(NaN, 1000), 0);
  assert.equal(L.computeProfitMargin(100, NaN), 0);
});

test("buildDailyProfitBlock: locked when unauthorized", () => {
  const b = L.buildDailyProfitBlock({ authorized: false, profit: 24850, sales: 100000 });
  assert.equal(b.profit_locked, true);
  assert.equal(b.profit, null);
  assert.equal(b.profit_margin, null);
});

test("buildDailyProfitBlock: unlocked returns profit + margin + change", () => {
  const b = L.buildDailyProfitBlock({ authorized: true, profit: 300, sales: 1000, changePercent: 8.42 });
  assert.equal(b.profit_locked, false);
  assert.equal(b.profit, 300);
  assert.equal(b.profit_margin, 30);
  assert.equal(b.profit_change_percent, 8.4);
});

test("buildDailyProfitBlock: zero sales -> margin 0, no NaN", () => {
  const b = L.buildDailyProfitBlock({ authorized: true, profit: 0, sales: 0 });
  assert.equal(b.profit_margin, 0);
  assert.equal(b.profit_change_percent, null);
});

test("nullProfitFieldsInOverview closes the todayProfit leak", () => {
  const ov = { today: { sales: 1000, profit: 300, todayProfit: { value: 300, growth: 8.4 } } };
  L.nullProfitFieldsInOverview(ov);
  assert.equal(ov.today.profit, null);
  assert.equal(ov.today.todayProfit.value, null);
  assert.equal(ov.today.todayProfit.growth, null);
  assert.equal(ov.today.sales, 1000); // revenue preserved
});

test("stripInvoiceProfit removes profit/cost and flips permission flag", () => {
  const inv = { id: 1, total: 500, profit: 200, cost: 300, permissions: { can_view_profit: true } };
  const s = L.stripInvoiceProfit(inv);
  assert.equal(s.profit, null);
  assert.equal(s.cost, null);
  assert.equal(s.permissions.can_view_profit, false);
  assert.equal(s.total, 500); // sales preserved
});

test("isProfitPinConfigured reflects env", () => {
  delete process.env.MANAGER_PROFIT_PIN_HASH;
  assert.equal(L.isProfitPinConfigured(), false);
  process.env.MANAGER_PROFIT_PIN_HASH = "$2a$10$examplehashvalue............................";
  assert.equal(L.isProfitPinConfigured(), true);
  delete process.env.MANAGER_PROFIT_PIN_HASH;
});

test("stripProfitFromInsights removes profit-bearing insights while keeping others", () => {
  const insights = [
    { type: "best_seller", title: "الأكثر مبيعاً", body: "منتج س" },
    { type: "profit", title: "أعلى ربح", body: "الربح 5000" },
    { type: "inventory", title: "إعادة طلب", body: "مخزون منخفض" },
    { type: "margin", title: "هامش الربح", body: "21%" },
  ];
  const out = L.stripProfitFromInsights(insights);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => i.type), ["best_seller", "inventory"]);
});

test("rate limiter: blocks after 5 failed attempts, success resets", () => {
  const k = L.attemptKey("7", "42");
  const now = 1_000_000;
  assert.equal(L.isRateLimited(k, now), false);
  let r;
  for (let i = 0; i < 4; i++) r = L.registerFailedAttempt(k, now);
  assert.equal(L.isRateLimited(k, now), false);      // 4 failures: still allowed
  r = L.registerFailedAttempt(k, now);               // 5th failure
  assert.equal(r.blocked, true);
  assert.equal(L.isRateLimited(k, now), true);        // now blocked
  assert.equal(L.isRateLimited(k, now + 16 * 60 * 1000), false); // block expires after window
  L.registerFailedAttempt(k, now + 16 * 60 * 1000);
  L.registerSuccess(k);
  assert.equal(L.isRateLimited(k, now + 16 * 60 * 1000), false); // success clears state
});
