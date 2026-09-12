import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WHATSAPP_PRESENCE,
  checkWhatsappNumbers,
  markWhatsappMessagesRead,
  resolveChatJid,
  resolveSendTarget,
  sendWhatsappContactCard,
  sendWhatsappPoll,
  sendWhatsappPresence,
  sendWhatsappStatus,
  whatsappNumberIsReachable,
} from "../server/services/whatsappCapabilitiesService.js";
import { extractWhatsappCallEvent } from "../server/services/whatsappGatewayService.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

process.env.EVOLUTION_API_URL = "http://evolution.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.EVOLUTION_INSTANCE_NAME = "m1-test";

/**
 * Captures what the service actually put on the wire. Every assertion below reads the
 * recorded request rather than the return value, because the bugs that matter here are all
 * shapes Evolution would reject — a payload the service never sent correctly cannot be
 * caught by inspecting what it returns.
 */
const withStubbedGateway = async (respond, run) => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || "GET", body });
    const outcome = (typeof respond === "function" ? respond({ url: String(url), body }) : respond) || {};
    const payload = outcome.payload === undefined ? { key: { id: "STUB" } } : outcome.payload;
    return {
      ok: outcome.status ? outcome.status < 400 : true,
      status: outcome.status || 200,
      text: async () => JSON.stringify(payload),
    };
  };
  try {
    return { result: await run(), calls };
  } finally {
    global.fetch = original;
  }
};

test("a chat is addressed by what it actually is, never by scraped digits", () => {
  // A LID customer has no phone anywhere in the webhook. Digits scraped out of a LID mint a
  // number that belongs to somebody else, which is how a reply lands in a stranger's chat.
  assert.equal(resolveSendTarget("whatsapp:lid:12345"), "12345@lid");
  assert.equal(resolveSendTarget("12345@lid"), "12345@lid");
  assert.equal(resolveSendTarget("01012345678"), "201012345678");
  assert.equal(resolveSendTarget("201012345678@s.whatsapp.net"), "201012345678");
  // A WhatsApp username is an identity, not a number: it must not collapse to its digits.
  assert.equal(resolveSendTarget("Ayamohsen180"), "");

  assert.equal(resolveChatJid("01012345678"), "201012345678@s.whatsapp.net");
  assert.equal(resolveChatJid("12345@lid"), "12345@lid");
});

test("a Cloud number is refused explicitly instead of silently doing nothing", async () => {
  await assert.rejects(
    () => sendWhatsappPresence({ phone: "01012345678", instance: "cloud:99" }),
    (error) => error.code === "WHATSAPP_CAPABILITY_CLOUD_UNSUPPORTED" && error.status === 409
  );
});

test("the typing indicator is clamped so a dead assistant cannot type forever", async () => {
  const { calls } = await withStubbedGateway({}, () =>
    sendWhatsappPresence({ phone: "01012345678", presence: WHATSAPP_PRESENCE.TYPING, delayMs: 10_000_000 })
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/chat\/sendPresence\/m1-test$/);
  assert.equal(calls[0].body.presence, "composing");
  assert.equal(calls[0].body.number, "201012345678");
  assert.equal(calls[0].body.delay, 20_000);
});

test("a read receipt carries message keys, and refuses to be sent empty", async () => {
  const { calls } = await withStubbedGateway({}, () =>
    markWhatsappMessagesRead({
      messages: [
        { remoteJid: "01012345678", id: "MSG1" },
        { remoteJid: "01012345678" }, // no id — not a message key
        { id: "MSG3" }, // no chat — not a message key
      ],
    })
  );
  assert.deepEqual(calls[0].body.readMessages, [
    { remoteJid: "201012345678@s.whatsapp.net", fromMe: false, id: "MSG1" },
  ]);

  await assert.rejects(
    () => markWhatsappMessagesRead({ messages: [{ remoteJid: "01012345678" }] }),
    (error) => error.code === "WHATSAPP_READ_MESSAGES_REQUIRED"
  );
});

test("a poll is de-duplicated, capped and never asks for more answers than it offers", async () => {
  const { calls } = await withStubbedGateway({}, () =>
    sendWhatsappPoll({
      phone: "01012345678",
      question: "أنهي مقاس؟",
      options: ["40", "41", "40", ...Array.from({ length: 15 }, (_, index) => `S${index}`)],
      selectableCount: 99,
    })
  );
  const body = calls[0].body;
  assert.equal(body.values.length, 12, "WhatsApp refuses more than 12 options");
  assert.equal(new Set(body.values).size, body.values.length, "duplicates would be rejected");
  assert.equal(body.selectableCount, body.values.length, "cannot select more options than exist");

  await assert.rejects(
    () => sendWhatsappPoll({ phone: "01012345678", question: "q", options: ["a", "a"] }),
    (error) => error.code === "WHATSAPP_POLL_OPTIONS_REQUIRED"
  );
});

test("a contact card links the same number it displays", async () => {
  const { calls } = await withStubbedGateway({}, () =>
    sendWhatsappContactCard({
      phone: "01012345678",
      contacts: [{ fullName: "مندوب الشحن", phone: "01098765432" }, { fullName: "no phone" }],
    })
  );
  assert.equal(calls[0].body.contact.length, 1, "a contact with no reachable number is not a card");
  assert.equal(calls[0].body.contact[0].wuid, "201098765432");
  assert.equal(calls[0].body.contact[0].phoneNumber, "+201098765432");
});

test("a status will not broadcast to the whole customer list unless that was asked for", async () => {
  await assert.rejects(
    () => sendWhatsappStatus({ type: "text", content: "عرض النهاردة" }),
    (error) => error.code === "WHATSAPP_STATUS_RECIPIENTS_REQUIRED"
  );

  const { calls } = await withStubbedGateway({}, () =>
    sendWhatsappStatus({ type: "text", content: "عرض النهاردة", recipients: ["01012345678"] })
  );
  assert.equal(calls[0].body.allContacts, false);
  assert.deepEqual(calls[0].body.statusJidList, ["201012345678@s.whatsapp.net"]);
});

test("a number Evolution did not answer for is unknown, not absent", async () => {
  const { result } = await withStubbedGateway(
    { payload: [{ number: "201012345678", exists: true, jid: "201012345678@s.whatsapp.net" }] },
    () => checkWhatsappNumbers({ phones: ["01012345678", "01055555555"], useCache: false })
  );
  const answers = Object.fromEntries(result.results.map((row) => [row.phone, row.exists]));
  assert.equal(answers["201012345678"], true);
  assert.equal(answers["201055555555"], null, "an unanswered lookup must not be recorded as 'no WhatsApp'");
});

test("a broken number check never becomes a reason to stop messaging customers", async () => {
  // Gateway down: the send must go ahead. This is the difference between one feature failing
  // and every order confirmation in the queue being silently dropped.
  const original = global.fetch;
  global.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  try {
    const broken = await whatsappNumberIsReachable({ phone: "01099999999" });
    assert.equal(broken.reachable, true);
    assert.equal(broken.known, false);
  } finally {
    global.fetch = original;
  }

  // A definite "not on WhatsApp" is the only answer that stops a send.
  const { result } = await withStubbedGateway(
    { payload: [{ number: "201088888888", exists: false }] },
    () => whatsappNumberIsReachable({ phone: "01088888888" })
  );
  assert.equal(result.reachable, false);
  assert.equal(result.known, true);
  assert.equal(result.reason, "not_on_whatsapp");
});

test("a WhatsApp call is recognised in every shape Evolution sends it", () => {
  const fromArray = extractWhatsappCallEvent({
    event: "call",
    instance: "m1",
    data: [{ id: "CALL1", from: "201012345678@s.whatsapp.net", isVideo: false, status: "offer" }],
  });
  assert.equal(fromArray.isCall, true);
  assert.equal(fromArray.phone, "201012345678");
  assert.equal(fromArray.callId, "CALL1");

  // A caller hidden behind a username rings from a LID, which is not a phone number.
  const fromLid = extractWhatsappCallEvent({ event: "CALL", data: { id: "CALL2", from: "99887@lid", isVideo: true } });
  assert.equal(fromLid.lid, "99887");
  assert.equal(fromLid.phone, "");
  assert.equal(fromLid.isVideo, true);

  assert.equal(extractWhatsappCallEvent({ event: "messages.upsert", data: {} }).isCall, false);
});

test("the capabilities service is allowlisted past the server/services gitignore", () => {
  // `server/services/*` is ignored wholesale; a new service file that is not un-ignored by
  // name exists locally, works locally, and is simply absent from the deploy.
  assert.match(read("../.gitignore"), /^!server\/services\/whatsappCapabilitiesService\.js$/m);
});

test("the call event is subscribed to, or the webhook never delivers one", () => {
  // The handler is useless on its own: Evolution only POSTs events the webhook asks for.
  assert.match(read("../server/services/evolutionWebhookSyncService.js"), /"CALL",/);
});
