import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseOrderSecondaryPhone, toLocalEgyptMobile } from "../server/utils/orderSecondaryPhone.js";
import { mapOrderToBostaDeliveryPayload } from "../server/modules/shipping/providers/bosta.mapper.js";
import { PORTAL_EDITABLE_FIELDS } from "../server/modules/shipping/shipping.portal.manage.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the second phone is stored as a local Egyptian mobile, or not at all", () => {
  assert.equal(toLocalEgyptMobile("+20 101 234 5678"), "01012345678");
  assert.equal(toLocalEgyptMobile("00201012345678"), "01012345678");
  assert.deepEqual(parseOrderSecondaryPhone(""), { value: "", error: "" });
  assert.deepEqual(parseOrderSecondaryPhone("0111 222 3333", "01012345678"), { value: "01112223333", error: "" });
  // The same number twice would only make the courier ring one phone again.
  assert.deepEqual(parseOrderSecondaryPhone("+201012345678", "01012345678"), { value: "", error: "" });
  assert.equal(parseOrderSecondaryPhone("0223456789").error, "invalid_secondary_phone");
});

test("Bosta receives the second phone as secondPhone, never a duplicate of the first", () => {
  const base = { id: 7, customer_name: "Mona Ali", customer_phone: "01012345678" };
  const withSecond = mapOrderToBostaDeliveryPayload({ order: { ...base, customer_secondary_phone: "01112223333" } });
  assert.equal(withSecond.receiver.phone, "01012345678");
  assert.equal(withSecond.receiver.secondPhone, "01112223333");
  assert.equal("secondPhone" in mapOrderToBostaDeliveryPayload({ order: base }).receiver, false);
  assert.equal("secondPhone" in mapOrderToBostaDeliveryPayload({ order: { ...base, customer_secondary_phone: "01012345678" } }).receiver, false);
});

test("the column is added at boot, not in a runtime ensure that is off in production", () => {
  const server = read("server/server.js");
  const boot = server.slice(server.indexOf("const bootstrapStartup = async"));
  assert.match(boot, /await ensureOrderSecondaryPhoneColumn\(db\)/);
});

test("every Bosta order path carries the second phone", () => {
  assert.ok(PORTAL_EDITABLE_FIELDS.includes("customer_secondary_phone"));
  assert.match(read("server/controllers/storefrontController.js"), /customer_secondary_phone: secondaryPhone\.value \|\| null/);
  assert.match(read("server/controllers/ordersController.js"), /UPDATE orders SET customer_secondary_phone = \$1 WHERE id = \$2/);
  assert.equal((read("server/services/aiAgentOrderService.js").match(/customer_secondary_phone: parseOrderSecondaryPhone\(/g) || []).length, 2);
  assert.equal((read("server/routes/aiAgentOrders.js").match(/customer_secondary_phone: req\.body\?\.customer_secondary_phone/g) || []).length, 2);
  assert.match(read("src/modules/orders/pages/OrderDetails.jsx"), /customer_secondary_phone: shipping\.customer_secondary_phone/);
  assert.match(read("src/modules/pos/components/PosOnlineOrderModal.jsx"), /secondary_phone: form\.secondary_phone/);
  assert.match(read("src/modules/aiSupport/components/InboxOrderComposer.jsx"), /customer_secondary_phone: secondaryPhoneDigits/);
  assert.match(read("src/shared/components/portalOnlineOrders/PortalOrderManage.jsx"), /customer_secondary_phone: text\(order\.customer\?\.secondary_phone\)/);
});

test("the website checkout refuses a number that is definitely not on WhatsApp, and only that", () => {
  const controller = read("server/controllers/storefrontController.js");
  const checkout = controller.slice(controller.indexOf("export const createWebsiteOrder"));
  assert.match(checkout, /if \(!posOnlineOrder\) \{\s*const whatsapp = await checkStorefrontPhoneOnWhatsapp\(checkout\.primary_phone\);\s*if \(whatsapp\.exists === false\)/);
  // Fails open: an unknown answer (gateway down, not configured) is null, never false.
  const helper = controller.slice(controller.indexOf("const checkStorefrontPhoneOnWhatsapp"), controller.indexOf("const WHATSAPP_CHECK_WINDOW_MS"));
  assert.match(helper, /if \(!result\.known\) return \{ exists: null/);
  assert.match(helper, /catch \(error\) \{[\s\S]*exists: null/);
  assert.match(read("server/routes/storefront.js"), /router\.get\("\/checkout\/whatsapp-check", checkCheckoutWhatsappNumber\)/);

  const page = read("src/storefront/Storefront.jsx");
  assert.match(page, /\/storefront\/checkout\/whatsapp-check\?phone=/);
  assert.match(page, /whatsappCheck\.exists === false && whatsappCheck\.phone === phone\) next\.primary_phone = sfText\("storefront\.validation\.notOnWhatsapp"\)/);
});

test("checkout copy exists in both languages", () => {
  for (const lang of ["ar", "en"]) {
    const storefront = JSON.parse(read(`src/locales/${lang}/storefront.json`));
    assert.ok(storefront.validation.notOnWhatsapp, `${lang} notOnWhatsapp`);
    assert.ok(storefront.validation.invalidSecondaryPhone, `${lang} invalidSecondaryPhone`);
    assert.ok(storefront.checkout.onePage.phoneCheckingWhatsapp, `${lang} phoneCheckingWhatsapp`);
    assert.ok(storefront.checkout.onePage.secondaryPhoneHint, `${lang} secondaryPhoneHint`);
    assert.ok(JSON.parse(read(`src/locales/${lang}/orders.json`)).shipping.customerSecondaryPhone);
    assert.ok(JSON.parse(read(`src/locales/${lang}/aiSupport.json`)).inbox.order.secondaryPhone);
    assert.ok(JSON.parse(read(`src/locales/${lang}/pos.json`)).onlineOrder.fields.secondaryPhone);
  }
});
