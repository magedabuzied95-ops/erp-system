import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Guards on the wiring itself: every renderer that shows the customer their invoice has
// to read the shared template, and the gates have to stay attached to the elements they
// were put on. Losing one of these is invisible in review — the invoice keeps rendering,
// it just stops obeying the studio.

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const card = read("../src/shared/components/invoices/OrderInvoiceCard.jsx");

test("the invoice card resolves the template and renders it as blocks", () => {
  assert.match(card, /useInvoiceTemplate\(\{ enabled: !template \}\)/);
  assert.match(card, /invoiceTemplateForOutput\(template \|\| resolvedTemplate/);
  // A host that already has the config passes it down instead of refetching.
  assert.match(card, /export default function OrderInvoiceCard\(\{[^}]*template = null[^}]*\}\)/);
  // The layout is data: the card maps the ordered list rather than hardcoding sequence.
  assert.match(card, /const layoutBlocks = blocksForOutput\(tpl\.blocks, layoutOutput\)/);
  assert.match(card, /\{layoutBlocks\.map\(\(block\) => \(/);
  assert.match(card, /<InvoiceBlockView/);
  // The customer's link and the in-app preview are not the same document.
  assert.match(card, /output \|\| \(publicView \? "public" : "card"\)/);
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

const pdf = read("../src/shared/utils/invoicePdf.js");

test("the printed invoice reads the template and picks its own output", () => {
  assert.match(pdf, /invoiceTemplateForOutput\(template \|\| \{\}, thermal \? "thermal" : "print"\)/);
  assert.match(pdf, /const resolvedTemplate = template \|\| \(await getInvoiceTemplateConfig\(\)\)/);
  // The store's details are no longer a second copy of the customer-facing constants.
  assert.doesNotMatch(pdf, /const M1_STORE_(PHONE|WEBSITE_TEXT|WEBSITE_HREF)\s*=/);
  assert.doesNotMatch(pdf, /const ARABIC_RETURN_POLICY_(HTML|TEXT)\s*=/);
  assert.doesNotMatch(pdf, /const DEFAULT_SOCIAL_LINKS\s*=/);
  assert.doesNotMatch(pdf, /01000659301/);
});

test("the printed sheet is assembled from the block list too", () => {
  assert.match(pdf, /blocksForOutput\(tpl\.blocks, thermal \? "thermal" : "print"\)/);
  assert.match(pdf, /sectionHtml\[block\.type\] \?\? renderInvoiceBlockHtml\(block, blockContext\)/);
  // The print path calls the share link publicInvoiceUrl; a QR block looks for publicUrl.
  assert.match(pdf, /invoice: \{ \.\.\.invoice, publicUrl \}/);
  const blockHtml = read("../src/shared/utils/invoiceBlockHtml.js");
  // Both renderers resolve a block through the same helpers, so a paragraph lands in the
  // same place on screen and on paper.
  for (const helper of ["localizedBlockText", "resolveQrValue", "resolveFieldRowValue", "resolveBarcodeValue"]) {
    assert.ok(blockHtml.includes(helper), `${helper} is shared with the React renderer`);
  }
  assert.match(blockHtml, /escapeHtml/, "operator text is escaped before it reaches the sheet");
});

test("the printed invoice keeps the paper's own layout facts separate from the toggles", () => {
  // The 80mm roll drops these because of its width, not because of a setting, so the
  // literal `thermal` check stays in front of the operator's flag.
  assert.match(pdf, /thermal \|\| !show\.show_product_variant \? "" :/);
  assert.match(pdf, /thermal \|\| !show\.show_unit_price \? "" :/);
  assert.match(pdf, /!thermal && show\.show_product_image/);
});

test("the printed invoice gates its own sections", () => {
  assert.match(pdf, /show\.show_customer_name \?/);
  assert.match(pdf, /show\.show_customer_phone && invoice\.customerPhone/);
  assert.match(pdf, /show\.show_seller_name && seller/);
  assert.match(pdf, /show\.show_payment_method \?/);
  assert.match(pdf, /showTotals\.show_subtotal \?/);
  assert.match(pdf, /showTotals\.show_grand_total \?/);
  assert.match(pdf, /returnPolicyHtml \?/);
});

test("the WhatsApp message obeys the same template", () => {
  const orderInvoice = read("../src/shared/utils/orderInvoice.js");
  assert.match(orderInvoice, /invoiceTemplateForOutput\(options\.template \|\| \{\}, "whatsapp"\)/);
  assert.match(orderInvoice, /if \(parts\.include_items\)/);
  assert.match(orderInvoice, /if \(parts\.include_totals\)/);
  assert.match(orderInvoice, /if \(parts\.include_public_link && invoice\.publicUrl\)/);
  // The header array is filtered, so a "" spacer pushed into it would vanish; the
  // blocks below the filter must not add one either or the message gains blank lines
  // it never had.
  assert.doesNotMatch(orderInvoice, /lines\.push\(\s*"",\s*"المنتجات:"/);
});

test("the cashier receipt takes its store details from the template", () => {
  const cart = read("../src/modules/pos/components/CartSidebar.jsx");
  assert.match(cart, /const getStoreProfile = \(tpl = null\) =>/);
  assert.match(cart, /website: tpl\?\.identity\?\.website_text/);
  assert.match(cart, /phone: tpl\?\.identity\?\.phone/);
  assert.match(cart, /address: tpl\?\.identity\?\.address/);
  // Printing goes through renderToStaticMarkup, so the template has to be a prop.
  assert.match(cart, /export function ReceiptPreview\(\{[^}]*template = null[^}]*\}\)/);
  assert.match(cart, /const officialWebsite = store\.website/);
  const pos = read("../src/modules/pos/pages/POSPro.jsx");
  assert.match(pos, /useInvoiceTemplate\(\{ channel: "pos" \}\)/);
  assert.match(pos, /template: invoiceTemplate,/);
});

test("the order page hands one resolved template to all three of its surfaces", () => {
  const details = read("../src/modules/orders/pages/OrderDetails.jsx");
  assert.match(details, /const invoiceTemplate = useInvoiceTemplate\(\)/);
  assert.equal((details.match(/template=\{invoiceTemplate\}/g) || []).length, 2, "both invoice card previews");
  assert.match(details, /template: invoiceTemplate,/, "the PDF download");
  assert.match(details, /buildOrderInvoiceWhatsappText\([\s\S]{0,200}?\{ template: invoiceTemplate \}\)/, "the WhatsApp message");
});

test("the studio previews through the real renderers, not lookalikes", () => {
  const studio = read("../src/modules/settings/pages/InvoiceStudio.jsx");
  // The card tab mounts the component the customer's link renders, and the print tabs
  // build the same HTML the print path opens — both fed the unsaved draft.
  assert.match(studio, /<OrderInvoiceCard invoice=\{previewInvoice\} template=\{draft\}/);
  assert.match(studio, /buildInvoicePreviewHtml\(/);
  assert.match(studio, /buildOrderInvoiceWhatsappText\(SAMPLE_ORDER, null, \{ template: draft \}\)/);
  assert.match(studio, /output === "thermal" \? "thermal" : "a4"/);
  // Saving has to reach the renderers' cached config or the change shows here only.
  assert.match(studio, /resetInvoiceTemplateCache\(\)/);
  // Editing is gated on the permission the route does not check.
  assert.match(studio, /hasPermission\("settings\.edit"\)/);
});

test("the studio is routed and its copy is translated", () => {
  const app = read("../src/App.jsx");
  assert.match(app, /path="settings\/invoice"/);
  assert.match(app, /lazy\(\(\) => import\("\.\/modules\/settings\/pages\/InvoiceStudio"\)\)/);
  const ar = JSON.parse(read("../src/locales/ar/settings.json"));
  const en = JSON.parse(read("../src/locales/en/settings.json"));
  assert.ok(ar.settings.invoiceStudio, "Arabic copy exists");
  assert.ok(en.settings.invoiceStudio, "English copy exists");
  assert.deepEqual(
    Object.keys(ar.settings.invoiceStudio).sort(),
    Object.keys(en.settings.invoiceStudio).sort(),
    "both locales carry the same studio keys"
  );
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
