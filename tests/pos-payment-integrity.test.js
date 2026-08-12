import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ordersControllerSource = fs.readFileSync(
  new URL("../server/controllers/ordersController.js", import.meta.url),
  "utf8"
);
const posSource = fs.readFileSync(
  new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url),
  "utf8"
);
const cartSource = fs.readFileSync(
  new URL("../src/modules/pos/components/CartSidebar.jsx", import.meta.url),
  "utf8"
);

test("POS checkout rejects a paid invoice whose split breakdown is incomplete", () => {
  assert.match(ordersControllerSource, /Payment breakdown total must equal the paid amount/);
  assert.match(ordersControllerSource, /A partially paid invoice cannot be saved as paid/);
  assert.match(ordersControllerSource, /submittedCollectedAmount[\s\S]*receivedAmount/);
});

test("POS supports a deposit with the remaining balance saved as customer credit", () => {
  assert.match(cartSource, /تسجيل الباقي آجل/);
  assert.match(cartSource, /partialCreditActive/);
  assert.match(cartSource, /partialCredit:\s*true/);
  assert.match(cartSource, /hasPartialSplitCollection/);
  assert.match(cartSource, /onCheckout\?\.\(\{ partialCredit: true \}\)/);
  assert.match(posSource, /partialCreditCheckout/);
  assert.match(posSource, /partialCreditCheckout \? "partially_paid"/);
  assert.match(posSource, /\(creditSaleCheckout \|\| partialCreditCheckout\) \? "credit_sale"/);
  assert.match(ordersControllerSource, /isCreditSaleTransaction[\s\S]*Math\.max\(0, Number\(paid_amount \|\| 0\) \|\| 0\)/);
  assert.match(ordersControllerSource, /!isCreditSaleTransaction \|\| receivedAmount > 0\.009/);
});

test("a one-method deposit entered in the split sheet remains a split payment", () => {
  assert.match(cartSource, /options\.forceSplit \? "split"/);
  assert.match(cartSource, /setMethodAmount\(method, value, \{ manual: true, forceSplit: true \}\)/);
});

test("POS persists the remaining balance and the actual collected method", () => {
  assert.match(ordersControllerSource, /remaining_amount = \$3/);
  assert.match(ordersControllerSource, /remainingOrderAmount/);
  assert.match(ordersControllerSource, /deriveStoredPaymentMethod/);
  assert.match(ordersControllerSource, /getCollectedPaymentAllocations/);
  assert.match(ordersControllerSource, /payment\.amount, payment\.method/);
  assert.doesNotMatch(ordersControllerSource, /transactionPaymentMethod/);
});

test("POS invoice edit treats an outstanding balance as an extra payment even when total is unchanged", () => {
  assert.match(
    ordersControllerSource,
    /const settlementType = amountDueNow > 0\.009[\s\S]*"extra_payment"[\s\S]*refundOrCreditDue > 0\.009/
  );
  assert.doesNotMatch(
    ordersControllerSource,
    /const settlementType = difference > 0 \? "extra_payment"/
  );
  assert.match(ordersControllerSource, /const refundAmount = refundOrCreditDue/);
  assert.doesNotMatch(ordersControllerSource, /settlementMethod,\s*difference,/);
  assert.doesNotMatch(ordersControllerSource, /Math\.abs\(difference\)/);
});

test("POS invoice edit exposes the original payment methods and their amounts", () => {
  assert.match(posSource, /originalPaymentBreakdown: parsePaymentBreakdownRows/);
  assert.match(cartSource, /originalPaymentBreakdown=\{editPaymentSummary\.originalPaymentBreakdown\}/);
  assert.match(cartSource, /originalPaymentBreakdown\.map/);
  assert.match(cartSource, /المطلوب تحصيله الآن/);
  assert.match(cartSource, /لو المبلغ كله كاش/);
  assert.equal((cartSource.match(/<EditPaymentDifferenceCard/g) || []).length, 1);
});
