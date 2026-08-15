import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyWhatsappLidSessionId,
  normalizeWhatsappLid,
  normalizeWhatsappPhone,
  normalizeWhatsappRemoteJid,
  normalizeWhatsappSessionId,
} from "../server/utils/whatsappIdentity.js";
import { resolveWebhookChatJid, resolveWhatsappReplyTarget } from "../server/services/whatsappGatewayService.js";

// WhatsApp's username rollout means an inbound chat no longer carries the
// customer's phone number: it carries a LID ("46995733500101@lid"), sometimes
// with the real number alongside it in key.senderPn, sometimes with nothing at
// all. Scraping digits out of those identities used to mint fake phone numbers
// and file customers into the wrong conversation — including the store's own.

const OWNER_JID = "201000659301@s.whatsapp.net";
const OWNERS = [OWNER_JID];
const CUSTOMER = "201012913942";
const LID_JID = "46995733500101@lid";

const route = (payload, { fromMe = false } = {}) => {
  const data = payload.data || {};
  const key = data.key || {};
  const remoteJid = resolveWebhookChatJid({ payload, data, key, ownerJids: OWNERS });
  const replyTarget = resolveWhatsappReplyTarget({ payload, data, key, remoteJid, fromMe });
  const phone = replyTarget.resolvedNumber;
  return {
    remoteJid,
    phone,
    reason: replyTarget.reason,
    identity: normalizeWhatsappSessionId(phone || remoteJid, phone),
  };
};

const inbound = ({ key = {}, ...rest } = {}) => ({
  instance: "qr-test2",
  data: {
    sender: OWNER_JID,
    pushName: "Aya Mohsen",
    message: { conversation: "ممكن سعر" },
    key: { fromMe: false, id: "MSG1", ...key },
    ...rest,
  },
});

test("a phone number still resolves exactly as before", () => {
  assert.equal(normalizeWhatsappSessionId("201012913942@s.whatsapp.net"), "whatsapp:201012913942");
  assert.equal(normalizeWhatsappSessionId("01012913942"), "whatsapp:201012913942");
  assert.equal(normalizeWhatsappSessionId("whatsapp:201012913942"), "whatsapp:201012913942");
  assert.equal(normalizeWhatsappPhone("+20 101 291 3942"), "201012913942");
});

test("a LID is never read as a phone number", () => {
  assert.equal(normalizeWhatsappPhone(LID_JID), "");
  assert.equal(normalizeWhatsappSessionId(LID_JID), "whatsapp:lid:46995733500101");
  assert.equal(normalizeWhatsappLid(LID_JID), "46995733500101");
  assert.equal(normalizeWhatsappSessionId("whatsapp:lid:46995733500101"), "whatsapp:lid:46995733500101");
  assert.equal(normalizeWhatsappRemoteJid("whatsapp:lid:46995733500101"), LID_JID);
  assert.equal(legacyWhatsappLidSessionId(LID_JID), "whatsapp:46995733500101");
});

test("a username is never read as a phone number", () => {
  assert.equal(normalizeWhatsappPhone("Ayamohsen180"), "");
  assert.equal(normalizeWhatsappPhone("Ayamohsen180@s.whatsapp.net"), "");
  assert.equal(normalizeWhatsappSessionId("Ayamohsen180@s.whatsapp.net"), "");
  assert.equal(normalizeWhatsappPhone("180"), "");
});

test("a customer whose number we know keeps one thread, LID or not", () => {
  assert.equal(normalizeWhatsappSessionId(LID_JID, CUSTOMER), `whatsapp:${CUSTOMER}`);
});

test("the connected instance never becomes the customer", () => {
  // Evolution puts the connected instance in data.sender. Events that arrive
  // without a chat JID used to fall through to it and file the customer's
  // message into the store's own conversation.
  const resolved = route(inbound({ key: { remoteJid: undefined } }));
  assert.equal(resolved.remoteJid, "");
  assert.equal(resolved.phone, "");
  assert.equal(resolved.identity, "");
});

test("the store's own 'message yourself' thread still resolves to the owner", () => {
  const resolved = route(inbound({ key: { remoteJid: OWNER_JID } }));
  assert.equal(resolved.remoteJid, OWNER_JID);
});

test("key.senderPn resolves a username customer to their real number", () => {
  const resolved = route(inbound({ key: { remoteJid: LID_JID, senderPn: `${CUSTOMER}@s.whatsapp.net` } }));
  assert.equal(resolved.phone, CUSTOMER);
  assert.equal(resolved.identity, `whatsapp:${CUSTOMER}`);
});

test("a username-only customer gets a stable thread instead of an invented number", () => {
  const resolved = route(inbound({ key: { remoteJid: LID_JID } }));
  assert.equal(resolved.phone, "");
  assert.equal(resolved.reason, "lid_unresolved");
  assert.equal(resolved.identity, "whatsapp:lid:46995733500101");
});

test("a number quoted inside the message never hijacks the conversation", () => {
  const resolved = route(inbound({
    key: { remoteJid: LID_JID },
    message: {
      extendedTextMessage: {
        text: "شوف ده",
        contextInfo: {
          quotedMessage: { contactMessage: { vcard: "TEL:+201555555555", ownerJid: "201555555555@s.whatsapp.net" } },
        },
      },
    },
  }));
  assert.equal(resolved.phone, "");
  assert.equal(resolved.identity, "whatsapp:lid:46995733500101");
});

test("an ordinary phone chat is untouched by any of this", () => {
  const resolved = route(inbound({ key: { remoteJid: `${CUSTOMER}@s.whatsapp.net` } }));
  assert.equal(resolved.phone, CUSTOMER);
  assert.equal(resolved.identity, `whatsapp:${CUSTOMER}`);
});
