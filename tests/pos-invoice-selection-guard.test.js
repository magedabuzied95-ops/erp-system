import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const posSource = fs.readFileSync(path.join(root, "src/modules/pos/pages/POSPro.jsx"), "utf8");
const cartSource = fs.readFileSync(path.join(root, "src/modules/pos/components/CartSidebar.jsx"), "utf8");
const ordersSource = fs.readFileSync(path.join(root, "server/controllers/ordersController.js"), "utf8");

/*
 * The blocking toasts were localized, so these guards pin the KEY rather than
 * one language's literal — and then prove the key actually resolves in both
 * dictionaries. That is strictly stronger than the old single-literal match:
 * deleting the message from either locale now fails the guard too.
 */
const enPos = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/pos.json"), "utf8"));
const arPos = JSON.parse(fs.readFileSync(path.join(root, "src/locales/ar/pos.json"), "utf8"));
const resolvesInBothLocales = (key) => {
  for (const bundle of [enPos, arPos]) {
    const value = key.split(".").reduce((node, part) => (node == null ? node : node[part]), bundle);
    assert.equal(typeof value, "string", `pos.${key} must resolve to a string in both locales`);
    assert.ok(value.trim().length > 0, `pos.${key} must not be empty`);
  }
};

test("POS requires an explicitly selected salesperson for every checkout", () => {
  assert.match(posSource, /if \(!selectedSalespersonId\) \{\s*toast\.error\(tt\("pos\.posPro\.toasts\.selectSalespersonFirst"\)\)/);
  resolvesInBothLocales("posPro.toasts.selectSalespersonFirst");
  assert.doesNotMatch(posSource, /allow_sale_without_salesperson && !selectedSalespersonId/);
  assert.match(ordersSource, /if \(!resolvedSalesEmployeeId\) \{/);
});

test("new invoices start without an inherited payment method", () => {
  assert.match(posSource, /paymentMode: ""/);
  assert.match(posSource, /toast\.error\(tt\("pos\.posPro\.toasts\.selectPaymentMethod"\)\)/);
  resolvesInBothLocales("posPro.toasts.selectPaymentMethod");
  assert.match(cartSource, /: "";\s*const paymentMethods/);
  assert.match(ordersSource, /Payment method is required for every invoice/);
});

test("successful and offline checkouts reset seller and payment selections", () => {
  const sellerResets = posSource.match(/setSelectedSalespersonId\(""\)/g) || [];
  const paymentResets = posSource.match(/setPaymentMode\(""\)/g) || [];
  assert.ok(sellerResets.length >= 4);
  assert.ok(paymentResets.length >= 6);
});
