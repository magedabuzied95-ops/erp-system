import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { describeUnits } from "../../server/modules/wholesale/wholesale.statement.js";

// The wholesale statement describes pieces in the model's own units, and a public
// statement link can only read the account and submit a payment for approval.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("pieces are described in cartons, series, dozens, then pieces", () => {
  const settings = { sell_carton: true, carton_pieces: 24, sell_series: true, series_pieces: 6, sell_dozen: false };
  assert.equal(describeUnits(30, settings), "1 كرتونة + 1 سيرية");
  assert.equal(describeUnits(51, settings), "2 كرتونة + 3 قطعة");
  assert.equal(describeUnits(5, settings), "5 قطعة");
  assert.equal(describeUnits(12, { sell_dozen: true }), "1 دستة");
  assert.equal(describeUnits(7, null), "7 قطعة");
});

test("the statement ledger: invoices minus paid-at-sale, payments and account returns; no loyalty", () => {
  const src = read("../../server/modules/wholesale/wholesale.statement.js");
  assert.match(src, /NON_CASH_LEGS = \["credit_sale", "exchange_credit", "return_credit", "customer_wallet", "wallet"\]/);
  assert.match(src, /credit: toAccount \? round\(ret\.refund_amount\) : 0/);
  assert.doesNotMatch(src, /wallet_transactions/, "the loyalty wallet must not enter the debt");
});

test("the public link can read and submit, never approve", () => {
  const pub = read("../../server/modules/wholesale/wholesale.public.routes.js");
  assert.match(pub, /router\.use\(requireWholesaleMode\)/);
  assert.doesNotMatch(pub, /approveSubmission|recordStaffPayment|rejectSubmission/);
  assert.match(pub, /source: "customer"/);
  const payments = read("../../server/modules/wholesale/wholesale.payments.js");
  assert.match(payments, /if \(source === "customer" && !imageUrl\) throw/);
  assert.match(payments, /if \(submission\.status !== "pending"\) throw/);
});
