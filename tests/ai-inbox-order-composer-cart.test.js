import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const service = read("../server/services/aiAgentOrderService.js");
const route = read("../server/routes/aiAgentOrders.js");
const inbox = read("../src/modules/aiSupport/components/InboxOrderComposer.jsx") + read("../src/modules/aiSupport/pages/AiInbox.jsx") + read("../src/modules/aiSupport/pages/AiInboxPwa.jsx");
const picker = read("../src/modules/aiSupport/components/ProductCardPicker.jsx");

test("the multi-line draft resolves variants by id instead of fuzzy matching", () => {
  assert.match(service, /export const createAiOrderDraftLines/);
  // The whole point of this path: an explicit pick must never be re-matched by
  // confidence, which is what createAiOrderDraft does for the autonomous agent.
  const fn = service.slice(service.indexOf("export const createAiOrderDraftLines"), service.indexOf("export const confirmAiOrder"));
  assert.doesNotMatch(fn, /searchAiOrderProducts/);
  assert.doesNotMatch(fn, /CONFIDENCE_THRESHOLD/);
  assert.match(fn, /loadOrderLineVariants/);
});

test("duplicate picks of one variant merge into a single quantity", () => {
  const fn = service.slice(service.indexOf("export const createAiOrderDraftLines"), service.indexOf("export const confirmAiOrder"));
  assert.match(fn, /existing\.quantity \+= line\.quantity/);
});

test("order lines are priced by the canonical customer-price rule", () => {
  const fn = service.slice(service.indexOf("export const createAiOrderDraftLines"), service.indexOf("export const confirmAiOrder"));
  assert.match(fn, /resolveCustomerDisplayPrice/);
  // Without the tenant sale-mode gate the resolver fails safe to "sale off" and
  // would under-quote while a sale is running.
  assert.match(fn, /sale_mode_enabled: saleModeEnabled/);
});

test("a short line blocks the whole order instead of silently shipping less", () => {
  const fn = service.slice(service.indexOf("export const createAiOrderDraftLines"), service.indexOf("export const confirmAiOrder"));
  assert.match(fn, /code: "OUT_OF_STOCK"/);
  assert.match(fn, /out_of_stock: outOfStock/);
});

test("the route confirms in the same request and returns the invoice link", () => {
  assert.match(route, /createAiOrderDraftLines\(\{/);
  // A duplicate that is still a draft is confirmed too ("create draft" then "save").
  assert.match(route, /req\.body\?\.confirm === true && \(!draft\.duplicate \|\| draft\.order\?\.ai_agent_status === "ai_draft"\)/);
  assert.match(route, /confirmAiOrder\(\{/);
  assert.match(route, /invoice_url: invoiceUrl/);
});

test("changing the payment method, discount, shipping or address is a new submit, not a duplicate", () => {
  const fn = service.slice(service.indexOf("export const createAiOrderDraftLines"), service.indexOf("export const confirmAiOrder"));
  const hash = fn.slice(fn.indexOf("let hash ="), fn.indexOf("const client = await db.connect()"));
  // Keyed on lines + phone only, picking InstaPay after a COD attempt matched the
  // old order and the save silently did nothing.
  assert.match(hash, /payment_method: paymentMethod/);
  assert.match(hash, /discount: /);
  assert.match(hash, /shipping_cost: shippingCost/);
  assert.match(hash, /address: \[/);
  // A finished order from long ago must not block the same customer re-buying.
  assert.match(fn, /REPEAT_WINDOW_MS/);
});

test("a save that lands on an already-saved invoice does not resend its link", () => {
  assert.match(inbox, /confirm && response\?\.duplicate && !response\?\.confirmed/);
  assert.match(inbox, /confirmed && response\?\.duplicate && !response\?\.confirmed/);
  assert.match(inbox, /invoiceAlreadySaved/);
});

test("the composer posts a cart and offers both draft and save", () => {
  // Whitespace-tolerant: the mapping was reformatted across several lines when it
  // gained a comment, which broke a single-line regex while the payload was unchanged.
  assert.match(inbox, /items: lines\.map\(\(line\) => \(\{\s*variant_id: line\.variant_id/);
  assert.match(inbox, /product_id: line\.product_id/, "the server needs the product to resolve a missing variant");
  assert.match(inbox, /onSubmit\?\.\(submitPayload\(false\)\)/);
  assert.match(inbox, /onSubmit\?\.\(submitPayload\(true\)\)/);
  assert.match(inbox, /AI_INBOX_PAYMENT_METHODS/);
  // The dropdown of conversation-matched products is gone: models now come from
  // the picker, which is what made the models unreachable in the first place.
  assert.doesNotMatch(inbox, /aiSupport\.inbox\.order\.chooseMatched/);
});

test("saving sends the invoice link on the conversation channel", () => {
  const fn = inbox.slice(inbox.indexOf("const submitComposerOrder"), inbox.indexOf("const createDraftFromProduct"));
  assert.match(fn, /"\/send"/);
  assert.match(fn, /invoice_url/);
  // A send failure must not read as a failed sale — the invoice already exists.
  assert.match(fn, /invoiceSavedSendFailed/);
});

test("the picker can feed the cart instead of sending to the customer", () => {
  assert.match(picker, /orderMode = false/);
  assert.match(picker, /pickerAddToOrder/);
  assert.match(inbox, /productCardPickerConfig\.orderMode/);
  assert.match(inbox, /setComposerPicks/);
});

test("both locales carry every new composer key", () => {
  const en = JSON.parse(read("../src/locales/en/aiSupport.json")).inbox.order;
  const ar = JSON.parse(read("../src/locales/ar/aiSupport.json")).inbox.order;
  const required = [
    "productsSection", "addProduct", "emptyCart", "lineCount", "cartTotal", "removeLine",
    "paymentSection", "paymentCod", "paymentCash", "paymentVisa", "paymentInstapay", "paymentVodafoneCash",
    "addAtLeastOne", "completeShippingShort", "saveInvoice", "saveHint",
    "pickerOrderTitle", "pickerAddToOrder", "pickerAddCountToOrder",
    "draftCreated", "invoiceSaved", "invoiceSavedSendFailed", "invoiceSavedNoLink", "saveFailed", "outOfStockLines",
  ];
  required.forEach((key) => {
    assert.ok(en[key], `missing en key: ${key}`);
    assert.ok(ar[key], `missing ar key: ${key}`);
  });
});
