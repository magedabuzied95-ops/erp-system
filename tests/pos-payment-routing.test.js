import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const posSource = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
const ordersSource = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
const accountingSource = readFileSync(new URL("../server/services/accountingService.js", import.meta.url), "utf8");

test("POS sends exact accounting method keys for InstaPay and Vodafone Cash", () => {
  assert.match(posSource, /\{\s*method:\s*"instapay",\s*amount:\s*payloadWalletAmount\s*\}/);
  assert.match(posSource, /\{\s*method:\s*"vodafone_cash",\s*amount:\s*payloadVodafoneCashAmount\s*\}/);
  assert.doesNotMatch(posSource, /\{\s*method:\s*"wallet",\s*amount:\s*payloadWalletAmount\s*\}/);
});

test("order accounting events do not reuse wallet account id for InstaPay or Vodafone Cash", () => {
  const saleAccountEventBlock = ordersSource.slice(
    ordersSource.indexOf("const saleAccountEvents = paymentBreakdown"),
    ordersSource.indexOf("for (const accountEvent of saleAccountEvents)")
  );

  assert.match(saleAccountEventBlock, /method === "wallet" \? wallet_financial_account_id/);
  assert.doesNotMatch(saleAccountEventBlock, /\["wallet",\s*"instapay",\s*"vodafone_cash"\]\.includes\(method\)\s*\?\s*wallet_financial_account_id/);
});

test("strict wallet methods require exact payment mapping instead of wallet fallback", () => {
  assert.match(accountingSource, /strictMappedPaymentMethods = new Set\(\["instapay",\s*"vodafone_cash"\]\)/);
  assert.match(accountingSource, /strictMappedPaymentMethods\.has\(paymentMethod\)\s*\?\s*\[\]/);
  assert.match(accountingSource, /\[accounting:payment-post\]/);
});
