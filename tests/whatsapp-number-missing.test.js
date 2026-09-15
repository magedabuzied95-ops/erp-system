import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { isWhatsappNumberMissingError } from "../server/utils/whatsappNotOnNumber.js";
import { runPortalOrderAction } from "../server/modules/shipping/shipping.portal.actions.js";

// INV-1625: Evolution answered the confirmation send with {"exists":false} twice and the
// operator only saw "تعذر الإرسال عبر واتساب. تأكد أن رقم المتجر متصل." — a store outage
// that was really a customer number with no WhatsApp account.
const evolutionRefusal = Object.assign(new Error('{"jid":"201143028484@s.whatsapp.net","exists":false,"number":"201143028484"}'), { code: "EVOLUTION_API_ERROR", status: 400 });

test("a number with no WhatsApp account is told apart from a gateway failure", () => {
  assert.equal(isWhatsappNumberMissingError(evolutionRefusal), true);
  assert.equal(isWhatsappNumberMissingError(new Error("Bad Request")), false);
  assert.equal(isWhatsappNumberMissingError(Object.assign(new Error("x"), { payload: { exists: false } })), true);
});

test("the order page says the number has no WhatsApp", () => {
  const source = fs.readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  assert.match(source, /const reason = isWhatsappNumberMissingError\(gatewayError\) \? "not_on_whatsapp" : "gateway_error";/);
  assert.match(source, /not_on_whatsapp: WHATSAPP_NUMBER_MISSING_MESSAGE,/);
});

test("the portal send answers CUSTOMER_NOT_ON_WHATSAPP", async () => {
  await assert.rejects(
    runPortalOrderAction({
      actor: { id: 1, tenant_id: 1 },
      orderId: 1625,
      action: "send_confirmation",
      deps: {
        loadOrder: async () => ({ id: 1625, group: "new", status: "pending_confirmation", order_number: "INV-1625", shipment: {}, customer: {} }),
        sendConfirmation: async () => { throw evolutionRefusal; },
        audit: async () => {},
      },
    }),
    (error) => error.code === "CUSTOMER_NOT_ON_WHATSAPP"
  );
});

test("the POS online-order modal checks the number while the cashier types it", () => {
  const modal = fs.readFileSync(new URL("../src/modules/pos/components/PosOnlineOrderModal.jsx", import.meta.url), "utf8");
  assert.match(modal, /\/storefront\/checkout\/whatsapp-check\?phone=/);
  assert.match(modal, /t\("pos\.onlineOrder\.notOnWhatsapp"\)/);
  // a hook after the early return would crash the modal on open
  assert.ok(modal.indexOf("/storefront/checkout/whatsapp-check") < modal.indexOf('if (!open || typeof document === "undefined") return null;'));
});
