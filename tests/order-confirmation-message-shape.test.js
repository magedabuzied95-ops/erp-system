import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCodOrderConfirmationMessage } from "../server/utils/orderConfirmationMessage.js";

// The confirmation message now leads with the order itself (Bosta-style) and lets the WhatsApp
// buttons carry the actions. The hazard that comes with that: strip the link AND the typed
// options from a path that has no buttons and the customer is left with nothing to act on.

const ORDER = {
  invoice_number: "INV-660",
  cod_amount: 3340,
  total_amount: 3340,
  governorate: "الاسكندريه",
  city_area: "300 الطريق الصحراوي",
  shipping_address_line: "5, Building 3, Floor 2",
};
const ITEMS = [
  { product_name: "New balance 530", color: "White & Navy", size: "43", quantity: 1 },
  { product_name: "SKECHERS SLIP INS", color: "Grey", size: "42", quantity: 2 },
];
const INVOICE = "https://m1store-egy.com/invoice/INV-660";

test("the buttons version carries the order, not a way to act", () => {
  const msg = buildCodOrderConfirmationMessage({ customerName: "ماجد", order: ORDER, items: ITEMS, invoiceUrl: INVOICE });
  assert.match(msg, /رقم الطلب: INV-660/);
  assert.match(msg, /مبلغ التحصيل: 3,340 جنيه/);
  assert.match(msg, /New balance 530 — White & Navy · 43/);
  assert.match(msg, /SKECHERS SLIP INS — Grey · 42 ×2/);
  assert.match(msg, /عنوان التوصيل: الاسكندريه - 300 الطريق الصحراوي - 5, Building 3, Floor 2/);
  assert.match(msg, /m1store-egy\.com\/invoice\/INV-660/);
  // the buttons are the way to act, so the body must not duplicate them
  assert.ok(!msg.includes("✏️ تعديل الطلب"), "no typed action list when buttons carry the actions");
  assert.ok(!msg.includes("/c/"), "no confirmation link when buttons carry the actions");
});

test("a path with no buttons always leaves the customer a way to act", () => {
  // text fallback: link + typed options
  const withLink = buildCodOrderConfirmationMessage({
    customerName: "ماجد", order: ORDER, items: ITEMS, invoiceUrl: INVOICE,
    confirmationLink: "https://m1store-egy.com/c/AbC123", withActions: true,
  });
  assert.match(withLink, /m1store-egy\.com\/c\/AbC123/);
  assert.match(withLink, /✅ تأكيد الطلب/);
  assert.match(withLink, /❌ إلغاء الطلب/);

  // total failure: no order, no link — the typed options are the ONLY way left
  const bare = buildCodOrderConfirmationMessage({ withActions: true });
  assert.match(bare, /✅ تأكيد الطلب/);
  assert.match(bare, /✏️ تعديل الطلب/);
  assert.match(bare, /❌ إلغاء الطلب/);
});

test("the typed options match what the reply parser actually recognises", () => {
  const service = fs.readFileSync(
    new URL("../server/services/whatsappOrderConfirmationService.js", import.meta.url), "utf8"
  );
  const bare = buildCodOrderConfirmationMessage({ withActions: true });
  for (const phrase of ["تأكيد الطلب", "تعديل الطلب", "إلغاء الطلب"]) {
    assert.ok(bare.includes(phrase), `message offers ${phrase}`);
    assert.ok(service.includes(phrase), `parser recognises ${phrase}`);
  }
});

test("a long order does not push the closing instruction out of the body", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ product_name: `منتج رقم ${i + 1}`, quantity: 1 }));
  const msg = buildCodOrderConfirmationMessage({ customerName: "ماجد", order: ORDER, items: many, invoiceUrl: INVOICE });
  assert.match(msg, /و4 منتجات أخرى/);
  assert.match(msg, /برجاء التأكيد$/);
  assert.ok(msg.length < 1024, `body ${msg.length} chars must fit WhatsApp's interactive limit`);
});

test("missing pieces are skipped, never rendered empty", () => {
  const msg = buildCodOrderConfirmationMessage({ customerName: "ماجد", order: { invoice_number: "INV-1" } });
  assert.match(msg, /رقم الطلب: INV-1/);
  assert.ok(!msg.includes("مبلغ التحصيل"), "no amount line when there is no amount");
  assert.ok(!msg.includes("عنوان التوصيل"), "no address line when there is no address");
  assert.ok(!msg.includes("المنتجات"), "no products line when there are no items");
  assert.ok(!/\n\n\n/.test(msg), "no empty gaps left behind");
});

test("whole pounds drop the trailing zeros, piastres survive", () => {
  const whole = buildCodOrderConfirmationMessage({ order: { invoice_number: "X", cod_amount: 1895 } });
  assert.match(whole, /1,895 جنيه/);
  const partial = buildCodOrderConfirmationMessage({ order: { invoice_number: "X", cod_amount: 1895.5 } });
  assert.match(partial, /1,895\.50 جنيه/);
});

// ---- the reply the customer gets after pressing ✅ ----
import { buildOrderConfirmedMessage } from "../server/utils/orderConfirmationMessage.js";
import { buildOrderTrackingUrl } from "../server/utils/whatsapp.js";

test("the confirmation reply repeats the order instead of just saying confirmed", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order: ORDER, items: ITEMS });
  assert.match(msg, /تم تأكيد طلبك يا ماجد/);
  assert.match(msg, /رقم الطلب: INV-660/);
  assert.match(msg, /مبلغ التحصيل: 3,340 جنيه/);
  assert.match(msg, /New balance 530/);
  assert.match(msg, /عنوان التوصيل: /);
});

test("the tracking link lands on the customer's own order, not a lookup form", () => {
  const url = buildOrderTrackingUrl("INV-660", "201024960585");
  // /track auto-submits only when it receives the order in the query
  assert.match(url, /\/track\?/);
  assert.match(url, /order=INV-660/);
  assert.match(url, /phone=201024960585/);
  const page = fs.readFileSync(
    new URL("../src/storefront/pages/StorefrontAsyncPages.jsx", import.meta.url), "utf8"
  );
  const track = page.slice(page.indexOf("export function TrackOrderPage"), page.indexOf("export function", page.indexOf("export function TrackOrderPage") + 10));
  assert.match(track, /params\.get\("order"\)/, "the page reads the order param this link sets");
  assert.match(track, /params\.get\("phone"\)/, "the page reads the phone param this link sets");
  assert.match(track, /hasOrderFromQuery/, "the page auto-submits from the query");
});

test("a tracking link is never rendered half-built", () => {
  assert.equal(buildOrderTrackingUrl(""), "");
  assert.equal(buildOrderTrackingUrl(null, "201024960585"), "");
  // a missing phone still gives a usable link, just one that asks for the phone
  assert.match(buildOrderTrackingUrl("INV-9"), /\/track\?order=INV-9$/);
  const noLinks = buildOrderConfirmedMessage({ customerName: "ماجد", order: ORDER, items: ITEMS });
  assert.ok(!noLinks.includes("تابع طلبك من هنا"), "no tracking label without a tracking url");
  assert.ok(!noLinks.includes("فاتورتك"), "no invoice label without an invoice url");
});

test("the confirmation reply promises only the delivery message that actually follows", () => {
  const msg = buildOrderConfirmedMessage({ customerName: "ماجد", order: ORDER, items: ITEMS });
  assert.match(msg, /أول ما يوصلك/);
});
