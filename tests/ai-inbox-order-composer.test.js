import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaInbox = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");

test("AI Inbox exposes an in-conversation order composer", () => {
  assert.match(inbox, /function InboxOrderComposer/);
  assert.match(inbox, /إنشاء طلب من المحادثة/);
  assert.match(inbox, /المخزون:/);
  assert.match(inbox, /إنشاء مسودة الطلب/);
});

test("AI Inbox order composer forwards reviewed customer and variant data", () => {
  for (const field of ["customer_name", "customer_phone", "customer_address", "governorate", "city_area", "quantity", "size", "color", "notes"]) {
    assert.match(inbox, new RegExp(`${field}: options\\.${field}`));
  }
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
