import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaInbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
const pwaComposer = readFileSync(new URL("../src/modules/aiSupport/components/PwaOrderComposer.jsx", import.meta.url), "utf8");
const orderService = readFileSync(new URL("../server/services/aiAgentOrderService.js", import.meta.url), "utf8");
const productPicker = readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
const pwaStyles = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.css", import.meta.url), "utf8");

test("AI Inbox exposes an in-conversation order composer", () => {
  assert.match(inbox, /function InboxOrderComposer/);
  assert.match(inbox, /إنشاء طلب من المحادثة/);
  assert.match(inbox, /المخزون:/);
  assert.match(inbox, /إنشاء مسودة الطلب/);
});

test("desktop AI Inbox mounts the order composer in the active workspace", () => {
  const activeWorkspaceStart = inbox.indexOf('className="ai-inbox-desktop');
  const legacyWorkspaceStart = inbox.indexOf('className="min-h-full', activeWorkspaceStart);
  assert.notEqual(activeWorkspaceStart, -1);
  assert.notEqual(legacyWorkspaceStart, -1);
  const activeWorkspace = inbox.slice(activeWorkspaceStart, legacyWorkspaceStart);
  assert.match(activeWorkspace, /<InboxOrderComposer/);
  assert.match(activeWorkspace, /open=\{orderComposerOpen\}/);
  assert.match(activeWorkspace, /onSubmit=\{createDraftFromProduct\}/);
});

test("AI Inbox order composer forwards reviewed customer and variant data", () => {
  for (const field of ["customer_name", "customer_phone", "customer_address", "governorate", "city_area", "quantity", "size", "color", "notes", "shipping_provider", "shipping_city_id", "shipping_zone_id", "shipping_district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) {
    assert.match(inbox, new RegExp(`${field}: options\\.${field}`));
  }
});

test("desktop order composer loads Bosta hierarchy and supports shipping providers", () => {
  assert.match(inbox, /AI_INBOX_SHIPPING_PROVIDERS/);
  for (const provider of ["bosta", "mylerz", "shipblu", "in_store_delivery"]) assert.match(inbox, new RegExp(`id: "${provider}"`));
  assert.match(inbox, /shipping\/cities\?provider=bosta&dropoff=1/);
  assert.match(inbox, /shipping\/zones\?provider=bosta&dropoff=1&cityId=/);
  assert.match(inbox, /shipping\/districts\?provider=bosta&dropoff=1&zoneId=/);
  assert.match(inbox, /shipping_provider_id: shippingProvider/);
});

test("conversation draft route persists reviewed customer shipping fields", () => {
  assert.match(routes, /customer_name: req\.body\?\.customer_name/);
  assert.match(routes, /customer_address: req\.body\?\.customer_address/);
  assert.match(routes, /governorate: req\.body\?\.governorate/);
  assert.match(routes, /city_area: req\.body\?\.city_area/);
});

test("PWA AI inbox exposes the reviewed draft-order composer", () => {
  assert.match(pwaInbox, /function PwaOrderComposer/);
  assert.match(pwaInbox, /ai-pwa-order-composer fixed inset-0/);
  assert.match(pwaInbox, /ai-pwa-order-composer__panel/);
  assert.match(pwaInbox, /إنشاء طلب من المحادثة/);
  assert.match(pwaInbox, /AiInboxPwa\.createDraftOrder/);
  assert.match(pwaInbox, /safeQuantity <= stock/);
  assert.match(pwaInbox, /reserve: false/);
});

test("PWA order composer uses the visual catalog and Bosta hierarchy", () => {
  assert.match(pwaComposer, /ProductCardPicker/);
  assert.match(pwaComposer, /shipping\/cities\?provider=bosta/);
  assert.match(pwaComposer, /shipping\/zones\?provider=bosta/);
  assert.match(pwaComposer, /shipping\/districts\?provider=bosta/);
  for (const field of ["shipping_city_id", "shipping_zone_id", "shipping_district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) assert.match(pwaComposer, new RegExp(field));
});

test("AI draft persists Bosta-ready shipping fields", () => {
  for (const field of ["shipping_provider", "shipping_provider_id", "shipping_city_id", "shipping_zone_id", "shipping_district_id", "district_id", "street_address", "building_number", "floor_number", "apartment_number", "landmark"]) assert.match(orderService, new RegExp(`${field}: text\\(payload\\.${field}`));
});

test("PWA product picker exposes POS filters and theme-aware dark styling", () => {
  assert.match(productPicker, /SmartPosFilters/);
  for (const filter of ["gender", "productType", "grade", "brand", "manufacturer"]) assert.match(productPicker, new RegExp(filter));
  assert.match(productPicker, /toggleMultiFilter\(setGender/);
  assert.match(productPicker, /toggleMultiFilter\(setBrand/);
  assert.match(productPicker, /toggleMultiFilter\(setManufacturer/);
  assert.match(productPicker, /name: value, count/);
  assert.doesNotMatch(productPicker, /categoryOptions=\{posCategoryOptions\}/);
  assert.doesNotMatch(productPicker, /colorOptions=\{posColorOptions\}/);
  assert.doesNotMatch(productPicker, /stockOptions=\{/);
  assert.match(productPicker, /ai-pwa-product-picker--dark/);
  assert.match(pwaStyles, /\.ai-pwa-product-picker--dark/);
  assert.match(pwaStyles, /\.ai-pwa-pos-filter-trigger/);
});
