import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregatePaymentDistribution,
  normalizeManagerPaymentMethod,
} from "../../server/services/managerPortalPaymentDistribution.js";

const byMethod = (rows) => Object.fromEntries(rows.map((r) => [r.method, r]));
const sumTotals = (rows) => rows.reduce((s, r) => s + r.total, 0);

test("single-method payments are unchanged (full paid amount to that method)", () => {
  const rows = [
    { payment_method: "cash", total_amount: 500, payment_breakdown: [{ method: "cash", amount: 500 }] },
    { payment_method: "card", total_amount: 300, payment_breakdown: [{ method: "card", amount: 300 }] },
    { payment_method: "instapay", total_amount: 200, payment_breakdown: [{ method: "instapay", amount: 200 }] },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.cash.total, 500);
  assert.equal(out.cash.count, 1);
  assert.equal(out.card.total, 300);
  assert.equal(out.instapay.total, 200);
  assert.equal(out.split, undefined);
});

test("split Cash + InstaPay distributes to real methods, never 'split'", () => {
  const rows = [
    {
      payment_method: "split",
      total_amount: 1000,
      payment_breakdown: [
        { method: "cash", amount: 600 },
        { method: "instapay", amount: 400 },
      ],
    },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.split, undefined, "must not produce a split bucket");
  assert.equal(out.cash.total, 600);
  assert.equal(out.cash.count, 1);
  assert.equal(out.instapay.total, 400);
  assert.equal(out.instapay.count, 1);
  assert.equal(sumTotals(Object.values(out)), 1000, "reconciles to order total");
});

test("split Cash + Card distributes correctly", () => {
  const rows = [
    {
      payment_method: "دفع مقسم",
      total_amount: 1000,
      payment_breakdown: [
        { method: "cash", amount: 700 },
        { method: "visa", amount: 300 }, // visa normalizes to card
      ],
    },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.cash.total, 700);
  assert.equal(out.card.total, 300);
  assert.equal(out.split, undefined);
  assert.equal(sumTotals(Object.values(out)), 1000);
});

test("counts: one usage per method per order across mixed sales", () => {
  const rows = [
    { payment_method: "cash", total_amount: 100, payment_breakdown: [{ method: "cash", amount: 100 }] },
    { payment_method: "split", total_amount: 500, payment_breakdown: [{ method: "cash", amount: 300 }, { method: "instapay", amount: 200 }] },
    { payment_method: "split", total_amount: 400, payment_breakdown: [{ method: "cash", amount: 100 }, { method: "vodafone_cash", amount: 300 }] },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.cash.count, 3, "cash used in all three orders");
  assert.equal(out.cash.total, 500);
  assert.equal(out.instapay.count, 1);
  assert.equal(out.vodafone_cash.count, 1);
  assert.equal(out.vodafone_cash.total, 300);
  assert.equal(out.split, undefined);
});

test("totals reconcile exactly across many split + single sales", () => {
  const rows = [
    { payment_method: "cash", total_amount: 250, payment_breakdown: [{ method: "cash", amount: 250 }] },
    { payment_method: "split", total_amount: 1000, payment_breakdown: [{ method: "cash", amount: 600 }, { method: "instapay", amount: 400 }] },
    { payment_method: "split", total_amount: 750, payment_breakdown: [{ method: "card", amount: 500 }, { method: "vodafone_cash", amount: 250 }] },
  ];
  const out = aggregatePaymentDistribution(rows);
  assert.equal(sumTotals(out), 2000);
  assert.equal(out.some((r) => r.method === "split"), false);
});

test("fallback: order without stored allocations keeps full amount under its method (deferred/آجل)", () => {
  const rows = [
    { payment_method: "deferred", total_amount: 750, payment_breakdown: [] },
    { payment_method: "cash", total_amount: 200, payment_breakdown: [{ method: "cash", amount: 200 }] },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.credit_sale.total, 750, "deferred normalizes to credit_sale");
  assert.equal(out.credit_sale.count, 1);
  assert.equal(out.cash.total, 200);
});

test("empty/unknown method with no allocations buckets as 'unknown'", () => {
  const rows = [{ payment_method: "", total_amount: 120, payment_breakdown: [] }];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.unknown.total, 120);
});

test("stringified jsonb breakdown is parsed", () => {
  const rows = [
    { payment_method: "split", total_amount: 300, payment_breakdown: JSON.stringify([{ method: "cash", amount: 100 }, { method: "instapay", amount: 200 }]) },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.cash.total, 100);
  assert.equal(out.instapay.total, 200);
});

test("edit_additional_payment allocations are skipped (no double count)", () => {
  const rows = [
    { payment_method: "cash", total_amount: 500, payment_breakdown: [{ method: "cash", amount: 500 }, { method: "cash", amount: 100, edit_additional_payment: true }] },
  ];
  const out = byMethod(aggregatePaymentDistribution(rows));
  assert.equal(out.cash.total, 500);
});

test("legacy split order missing allocations never surfaces split as a payment method", () => {
  const rows = [{ payment_method: "split", total_amount: 900, payment_breakdown: [] }];
  const out = byMethod(aggregatePaymentDistribution(rows));
  // The real tender cannot be reconstructed, so keep it in the safe unknown
  // bucket instead of inventing `split` as an accounting payment method.
  assert.equal(out.unknown.total, 900);
  assert.equal(out.split, undefined);
});

test("normalizeManagerPaymentMethod aliases", () => {
  assert.equal(normalizeManagerPaymentMethod("Visa"), "card");
  assert.equal(normalizeManagerPaymentMethod("Vodafone"), "vodafone_cash");
  assert.equal(normalizeManagerPaymentMethod("insta-pay"), "instapay");
  assert.equal(normalizeManagerPaymentMethod("Deferred"), "credit_sale");
  assert.equal(normalizeManagerPaymentMethod(""), "");
});
