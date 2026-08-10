import test from "node:test";
import assert from "node:assert/strict";

import {
  getWhatsappCustomerPhoneVariants,
  normalizeWhatsappCustomerName,
} from "../server/services/whatsappCustomerAutoRegistrationService.js";

test("WhatsApp customer phone variants match Egyptian local and international formats", () => {
  assert.deepEqual(getWhatsappCustomerPhoneVariants("+20 100 065 9301"), ["201000659301", "01000659301"]);
  assert.deepEqual(getWhatsappCustomerPhoneVariants("01000659301"), ["01000659301", "201000659301"]);
});

test("WhatsApp profile names are accepted without using the phone as a fake name", () => {
  assert.equal(normalizeWhatsappCustomerName("  Mohamed   Nabil  ", "201113312614"), "Mohamed Nabil");
  assert.equal(normalizeWhatsappCustomerName("201113312614", "201113312614"), "");
  assert.equal(normalizeWhatsappCustomerName("بدون اسم", "201113312614"), "");
});
