import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Guards on the wiring itself: every renderer that shows the customer their invoice has
// to read the shared template, and the gates have to stay attached to the elements they
// were put on. Losing one of these is invisible in review — the invoice keeps rendering,
// it just stops obeying the studio.

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const card = read("../src/shared/components/invoices/OrderInvoiceCard.jsx");

test("the invoice card resolves the template and folds in the card output", () => {
  assert.match(card, /useInvoiceTemplate\(\{ enabled: !template \}\)/);
  assert.match(card, /invoiceTemplateForOutput\(template \|\| resolvedTemplate, "card"\)/);
  // A host that already has the config passes it down instead of refetching.
  assert.match(card, /export default function OrderInvoiceCard\(\{[^}]*template = null[^}]*\}\)/);
});

test("the card's identity gates are attached", () => {
  // Both header layouts — public and internal — hide the logo together.
  assert.equal((card.match(/tpl\.identity\.show_logo && data\.store\?\.logoUrl/g) || []).length, 2);
  // A name typed into the template outranks the one the invoice payload carries.
  assert.match(card, /name: String\(tpl\.identity\.store_name \|\| invoice\.store\?\.name/);
  assert.match(card, /logoUrl: resolveBrandImageUrl\(String\(tpl\.identity\.logo_url \|\| invoice\.store\?\.logoUrl/);
  assert.match(card, /storeName: tpl\.identity\.store_name \|\| storeBranding\.name/);
});

test("the card's line and customer gates are attached", () => {
  assert.match(card, /!compact && show\.show_product_image/);
  assert.match(card, /show\.show_sku && item\?\.sku/);
  assert.match(card, /show\.show_customer_name \?/);
  assert.match(card, /show\.show_customer_phone \?/);
  assert.match(card, /show\.show_customer_address && data\?\.customer\?\.address/);
  assert.match(card, /!publicView && show\.show_order_status/);
  assert.match(card, /!publicView && show\.show_payment_method/);
  assert.match(card, /show\.show_order_date/);
});

test("the card's totals gates are attached", () => {
  assert.match(card, /showTotals\.show_subtotal \?/);
  assert.match(card, /showTotals\.show_discount && Number\(totals\?\.discount/);
  assert.match(card, /showTotals\.show_shipping && Number\(totals\?\.shipping/);
  assert.match(card, /showTotals\.show_grand_total \?/);
  assert.match(card, /showTotals\.show_payment_breakdown && paymentBreakdown\.length > 1/);
  assert.match(card, /showTotals\.show_paid \?/);
  assert.match(card, /showTotals\.show_remaining \?/);
});

test("resolving the template never logs a 404 as an error", () => {
  // The frontend ships ahead of the API often enough that a missing endpoint is a
  // normal state; logging it would put one console error on every invoice view.
  const client = read("../src/shared/api/invoiceTemplates.js");
  assert.match(client, /\/invoice-templates\/resolve", \{ params, suppressErrorStatuses: \[401, 403, 404, 500\] \}/);
  assert.match(client, /\/public\/invoice-template", \{ params, suppressErrorStatuses: \[401, 403, 404, 500\] \}/);
});

test("a failed or absent template still renders an invoice", () => {
  const hook = read("../src/shared/hooks/useInvoiceTemplate.js");
  // First paint is the defaults, so an unconfigured tenant never flashes or blanks.
  assert.match(hook, /useState\(DEFAULT_CONFIG\)/);
  assert.match(hook, /\.catch\(\(\) => DEFAULT_CONFIG\)/);
  // Signed-out viewers can only reach the public resolver.
  assert.match(hook, /const isPublic = !getToken\(\)/);
});
