import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { addressRequestPhone } from "../server/services/conversationAddressRequestService.js";
import { channelKind, localMobileFromKey } from "../server/modules/orders/customerChannelLinks.js";

// Owner, 2026-10-22: the address link sent on Instagram/Messenger carried the customer's Meta id as
// their mobile number.
test("a Meta page-scoped id is never stored as the address link's phone", () => {
  assert.equal(addressRequestPhone("27617983947902214", "facebook_messenger"), "");
  assert.equal(addressRequestPhone("1044077131364783", "instagram"), "");
  assert.equal(addressRequestPhone("+20 101 234 5678", "instagram"), "01012345678");
  // A WhatsApp thread's id IS the number, foreign ones included.
  assert.equal(addressRequestPhone("201012345678", "whatsapp"), "01012345678");
  assert.equal(addressRequestPhone("447700900123", "whatsapp"), "447700900123");
});

test("the submit asks for a number when the link has none", () => {
  const source = fs.readFileSync(new URL("../server/services/conversationAddressRequestService.js", import.meta.url), "utf8");
  assert.match(source, /ADDRESS_REQUEST_PHONE_REQUIRED/);
  assert.match(source, /submittedPhone \|\| addressRequestPhone\(row\.customer_phone, row\.channel\)/);
});

test("comment threads are never offered as a way to reach the customer", () => {
  assert.equal(channelKind("facebook_comment", "facebook_post:1_2"), "");
  assert.equal(channelKind("instagram_comment", "instagram_post:1"), "");
  assert.equal(channelKind("facebook_messenger", "facebook_messenger:1"), "messenger");
  assert.equal(channelKind("instagram", "instagram:1"), "instagram");
  assert.equal(channelKind("whatsapp", "whatsapp:201012345678"), "whatsapp");
  assert.equal(channelKind("tiktok", "tiktok:1"), "tiktok");
  assert.equal(localMobileFromKey("1012345678"), "01012345678");
  assert.equal(localMobileFromKey("27617983947902214"), "");
});

test("the portal card opens every linked thread, and WhatsApp only opens a WhatsApp thread", () => {
  const board = fs.readFileSync(new URL("../src/shared/components/portalOnlineOrders/PortalOnlineOrdersBoard.jsx", import.meta.url), "utf8");
  assert.match(board, /linked\.find\(\(thread\) => thread\.kind === "whatsapp"\)/);
  assert.match(board, /onOpenChat\(order, thread\)/);
  const service = fs.readFileSync(new URL("../server/modules/shipping/shipping.portal.service.js", import.meta.url), "utf8");
  assert.match(service, /conversations: Array\.isArray\(order\.portal_conversations\)/);
});
