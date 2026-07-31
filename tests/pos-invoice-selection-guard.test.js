import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const posSource = fs.readFileSync(path.join(root, "src/modules/pos/pages/POSPro.jsx"), "utf8");
const cartSource = fs.readFileSync(path.join(root, "src/modules/pos/components/CartSidebar.jsx"), "utf8");
const ordersSource = fs.readFileSync(path.join(root, "server/controllers/ordersController.js"), "utf8");

test("POS requires an explicitly selected salesperson for every checkout", () => {
  assert.match(posSource, /if \(!selectedSalespersonId\) \{\s*toast\.error\("يجب تحديد البائع قبل إتمام الفاتورة"\)/);
  assert.doesNotMatch(posSource, /allow_sale_without_salesperson && !selectedSalespersonId/);
  assert.match(ordersSource, /if \(!resolvedSalesEmployeeId\) \{/);
});

test("new invoices start without an inherited payment method", () => {
  assert.match(posSource, /paymentMode: ""/);
  assert.match(posSource, /toast\.error\("يجب اختيار طريقة الدفع لهذه الفاتورة"\)/);
  assert.match(cartSource, /: "";\s*const paymentMethods/);
  assert.match(ordersSource, /Payment method is required for every invoice/);
});

test("successful and offline checkouts reset seller and payment selections", () => {
  const sellerResets = posSource.match(/setSelectedSalespersonId\(""\)/g) || [];
  const paymentResets = posSource.match(/setPaymentMode\(""\)/g) || [];
  assert.ok(sellerResets.length >= 4);
  assert.ok(paymentResets.length >= 6);
});
