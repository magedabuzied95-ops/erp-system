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

test("POS invoice edit treats an outstanding balance as an extra payment even when total is unchanged", () => {
  assert.match(
    ordersControllerSource,
    /const settlementType = amountDueNow > 0\.009[\s\S]*"extra_payment"[\s\S]*refundOrCreditDue > 0\.009/
  );
  assert.doesNotMatch(
    ordersControllerSource,
    /const settlementType = difference > 0 \? "extra_payment"/
  );
});

test("POS invoice edit exposes the original payment methods and their amounts", () => {
  assert.match(posSource, /originalPaymentBreakdown: parsePaymentBreakdownRows/);
  assert.match(cartSource, /cart\.originalPaymentBreakdown/);
  assert.match(cartSource, /originalPaymentBreakdown\.map/);
});
