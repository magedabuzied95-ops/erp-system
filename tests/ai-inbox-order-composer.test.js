import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaInbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
// ONE order composer serves both surfaces now — the phone-only PwaOrderComposer
// (single product, no cart, no discount, no payment method, no shipping quote)
// is retired, so every assertion below reads the shared component.
const composer = readFileSync(new URL("../src/modules/aiSupport/components/InboxOrderComposer.jsx", import.meta.url), "utf8");
const orderService = readFileSync(new URL("../server/services/aiAgentOrderService.js", import.meta.url), "utf8");
const productPicker = readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
const pwaStyles = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.css", import.meta.url), "utf8");

test("AI Inbox exposes an in-conversation order composer", () => {
  assert.match(composer, /function InboxOrderComposer/);
  assert.match(inbox, /import InboxOrderComposer from "\.\.\/components\/InboxOrderComposer"/);
  assert.match(pwaInbox, /import InboxOrderComposer from "\.\.\/components\/InboxOrderComposer"/);
  // Localized: the heading and the submit controls are pinned by translation key
  // rather than by one locale's copy. The composer now carries a cart and BOTH
  // actions: draft (reserve only) and save (confirmed invoice, stock out, invoice
  // sent to the customer).
  assert.match(composer, /aiSupport\.inbox\.order\.orderHeading/);
  assert.match(composer, /aiSupport\.inbox\.order\.createDraft/);
  assert.match(composer, /aiSupport\.inbox\.order\.saveInvoice/);
});

test("desktop AI Inbox mounts the order composer in the active workspace", () => {
  const activeWorkspaceStart = inbox.indexOf('className="ai-inbox-desktop');
  const legacyWorkspaceStart = inbox.indexOf('className="min-h-full', activeWorkspaceStart);
  assert.notEqual(activeWorkspaceStart, -1);
  assert.notEqual(legacyWorkspaceStart, -1);
  const activeWorkspace = inbox.slice(activeWorkspaceStart, legacyWorkspaceStart);
  assert.match(activeWorkspace, /<InboxOrderComposer/);
  assert.match(activeWorkspace, /open=\{orderComposerOpen\}/);
  assert.match(activeWorkspace, /onSubmit=\{submitComposerOrder\}/);
});

test("AI Inbox order composer forwards reviewed customer and variant data", () => {
  for (const field of ["customer_name", "customer_phone", "customer_address", "governorate", "city_area", "quantity", "size", "color", "notes", "shipping_provider", "shipping_city_id", "shipping_zone_id", "shipping_district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) {
    assert.match(inbox, new RegExp(`${field}: options\\.${field}`));
  }
});

test("desktop order composer loads Bosta hierarchy and supports shipping providers", () => {
  assert.match(composer, /AI_INBOX_SHIPPING_PROVIDERS/);
  for (const provider of ["bosta", "mylerz", "shipblu", "in_store_delivery"]) assert.match(composer, new RegExp(`id: "${provider}"`));
  assert.match(composer, /shipping\/cities\?provider=bosta&dropoff=1/);
  assert.match(composer, /shipping\/zones\?provider=bosta&dropoff=1&cityId=/);
  assert.match(composer, /shipping\/districts\?provider=bosta&dropoff=1&zoneId=/);
  assert.match(composer, /shipping_provider_id: shippingProvider/);
  assert.match(composer, /role="radiogroup" aria-label=\{t\("aiSupport\.inbox\.order\.courier"\)\}/);
  assert.match(composer, /aiSupport\.inbox\.order\.cityArea/);
  assert.match(composer, /aiSupport\.inbox\.order\.zone/);
  assert.match(composer, /aiSupport\.inbox\.order\.district/);
  assert.doesNotMatch(composer, /مدينة Bosta|منطقة Bosta|حي Bosta/);
});

test("conversation draft route persists reviewed customer shipping fields", () => {
  assert.match(routes, /customer_name: req\.body\?\.customer_name/);
  assert.match(routes, /customer_address: req\.body\?\.customer_address/);
  assert.match(routes, /governorate: req\.body\?\.governorate/);
  assert.match(routes, /city_area: req\.body\?\.city_area/);
});

test("the PWA mounts the SAME composer, with the cart and both actions", () => {
  // The phone used to get a cut-down twin: one product, no cart, no discount, no
  // payment method, no shipping quote, no saved addresses. An order written from
  // the phone is now the same order written at the desk.
  assert.match(pwaInbox, /<InboxOrderComposer/);
  assert.match(pwaInbox, /onSubmit=\{submitComposerOrder\}/);
  assert.match(pwaInbox, /picks=\{composerPicks\}/);
  assert.match(pwaInbox, /onRequestPick=\{openOrderCartPicker\}/);
  assert.match(pwaInbox, /AiInboxPwa\.createDraftOrder/);
  assert.doesNotMatch(pwaInbox, /function PwaOrderComposer\(/);
});

test("the shared order composer uses the visual catalog and Bosta hierarchy", () => {
  assert.match(composer, /shipping\/cities\?provider=bosta/);
  assert.match(composer, /shipping\/zones\?provider=bosta/);
  assert.match(composer, /shipping\/districts\?provider=bosta/);
  for (const field of ["shipping_city_id", "shipping_zone_id", "shipping_district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) assert.match(composer, new RegExp(field));
  // The cart, the discount and the payment method are what the phone was missing.
  assert.match(composer, /AI_INBOX_PAYMENT_METHODS/);
  assert.match(composer, /discountType/);
  assert.match(composer, /composerLineKey/);
});

test("AI draft persists Bosta-ready shipping fields", () => {
  for (const field of ["shipping_provider", "shipping_provider_id", "shipping_city_id", "shipping_zone_id", "shipping_district_id", "district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) assert.match(orderService, new RegExp(`${field}: text\\(payload\\.${field}`));
});

test("PWA product picker exposes POS filters and theme-aware dark styling", () => {
  assert.match(productPicker, /SmartPosFilters/);
  for (const filter of ["gender", "productType", "grade", "brand", "manufacturer"]) assert.match(productPicker, new RegExp(filter));
  // Gender, brand and manufacturer must stay MULTI-select (single-select would quietly
  // narrow a search the user meant to widen). The three per-setter helpers were
  // replaced by one generic handler over toggleMultiFilterValue — the same behaviour
  // with one implementation instead of three.
  assert.match(productPicker, /toggleMultiFilterValue\(current\?\.\[field\] \|\| \[\], value\)/);
  for (const [prop, field] of [["onGenderChange", "gender"], ["onBrandChange", "brands"], ["onManufacturerChange", "manufacturers"]]) {
    assert.match(
      productPicker,
      new RegExp(`${prop}=\\{\\(value\\) => updateDraftMultiFilter\\("${field}", value\\)\\}`),
      `${field} must stay a multi-select filter`
    );
  }
  // Each filter option carries a display name and a match count — the count is what
  // stops the user picking a filter that returns nothing. It is now derived from the
  // localized option labels rather than the raw value, so the assertion is on the
  // shape rather than on how the name is produced.
  assert.match(productPicker, /name: option\.label_ar \|\| option\.label_en \|\| option\.label \|\| option\.value, count:/);
  assert.match(productPicker, /\{ id: brandKey, name, count: 0 \}/);
  assert.doesNotMatch(productPicker, /categoryOptions=\{posCategoryOptions\}/);
  assert.doesNotMatch(productPicker, /colorOptions=\{posColorOptions\}/);
  assert.doesNotMatch(productPicker, /stockOptions=\{/);
  assert.match(productPicker, /ai-pwa-product-picker--dark/);
  assert.match(pwaStyles, /\.ai-pwa-product-picker--dark/);
  assert.match(pwaStyles, /\.ai-pwa-pos-filter-trigger/);
});
