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
  setWhatsappBlockStatus,
  whatsappCapabilityState,
  whatsappNumberIsReachable,
} from "../server/services/whatsappCapabilitiesService.js";
import { extractWhatsappCallEvent, extractWhatsappPresenceEvent } from "../server/services/whatsappGatewayService.js";

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

test("blocking a contact goes to the path the live build actually has", async () => {
  // Proven against Evolution 2.4.0 on 2026-09-12: `/message/updateBlockStatus` — the spelling in the
  // Evolution docs — answers 404, and blocking lives under `/chat/` with every other contact
  // operation. A wrong path here fails exactly like a feature that does not work.
  const { calls } = await withStubbedGateway({}, () =>
    setWhatsappBlockStatus({ phone: "01012345678", blocked: true })
  );
  assert.match(calls[0].url, /\/chat\/updateBlockStatus\/m1-test$/);
  assert.equal(calls[0].body.status, "block");

  const { calls: unblockCalls } = await withStubbedGateway({}, () =>
    setWhatsappBlockStatus({ phone: "01012345678", blocked: false })
  );
  assert.equal(unblockCalls[0].body.status, "unblock");
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

test("the process can say which capabilities are live, and why one is not", async () => {
  /*
   * This exists because production could not answer the question. The flags are read from the
   * .env dotenv loads at runtime, so `printenv` inside the container prints nothing for them —
   * and "no output" reads exactly like a flag that failed to apply.
   *
   * The distinction that matters is the third state: the flag is on but there is no AI client,
   * so the feature is off for a reason no flag check would reveal.
   */
  const previous = process.env.AI_VOICE_TRANSCRIPTION_ENABLED;
  try {
    delete process.env.AI_VOICE_TRANSCRIPTION_ENABLED;
    const off = await whatsappCapabilityState();
    assert.equal(off.voice_transcription.enabled, false);
    assert.equal(off.voice_transcription.reason, "flag_off");

    process.env.AI_VOICE_TRANSCRIPTION_ENABLED = "true";
    const flagged = await whatsappCapabilityState();
    assert.equal(flagged.voice_transcription.enabled, false);
    assert.equal(flagged.voice_transcription.reason, "flag_on_but_no_ai_client");
  } finally {
    if (previous === undefined) delete process.env.AI_VOICE_TRANSCRIPTION_ENABLED;
    else process.env.AI_VOICE_TRANSCRIPTION_ENABLED = previous;
  }

  const state = await whatsappCapabilityState();
  assert.equal(state.live_presence.enabled, true, "presence is on unless explicitly disabled");
  assert.equal(state.queue_number_check.enabled, true, "the number check is on unless explicitly disabled");
  assert.equal(state.call_events.subscribed, true);
  // No credential may ever reach this payload: it is served over an API and printed to logs.
  assert.equal(JSON.stringify(state).toLowerCase().includes("key"), false);
});

test("a customer typing is read out of the presence event we already paid for", () => {
  // PRESENCE_UPDATE was in the webhook subscription all along and was dropped on arrival for
  // having no message id. These are the shapes it actually arrives in.
  const typing = extractWhatsappPresenceEvent({
    event: "presence.update",
    instance: "m1",
    data: { id: "201012345678@s.whatsapp.net", presences: { "201012345678@s.whatsapp.net": { lastKnownPresence: "composing" } } },
  });
  assert.equal(typing.isPresence, true);
  assert.equal(typing.typing, true);
  assert.equal(typing.phone, "201012345678");

  // Evolution has been seen keying the map by participant rather than by the chat.
  const recording = extractWhatsappPresenceEvent({
    event: "PRESENCE_UPDATE",
    data: { id: "201012345678@s.whatsapp.net", presences: { "999@s.whatsapp.net": { lastKnownPresence: "recording" } } },
  });
  assert.equal(recording.recording, true);
  assert.equal(recording.typing, false);

  // A username customer has a LID and no phone; the chat is still addressable.
  const lidChat = extractWhatsappPresenceEvent({
    event: "presence.update",
    data: { id: "99887@lid", presences: { "99887@lid": { lastKnownPresence: "paused" } } },
  });
  assert.equal(lidChat.lid, "99887");
  assert.equal(lidChat.phone, "");
  assert.equal(lidChat.typing, false, "paused is a stop, not a start");

  assert.equal(extractWhatsappPresenceEvent({ event: "messages.upsert", data: {} }).isPresence, false);
});

test("the order-status label mapping stays off until somebody turns it on", async () => {
  const { normalizeStatusLabelConfig } = await import("../server/services/whatsappOrderLabelService.js");

  // It writes visible marks on real customer chats. Anything short of an explicit true — an
  // empty object, a missing key, the string "true" from a form — must leave it off.
  assert.equal(normalizeStatusLabelConfig({}).enabled, false);
  assert.equal(normalizeStatusLabelConfig({ enabled: "true" }).enabled, false);
  assert.equal(normalizeStatusLabelConfig({ enabled: true }).enabled, true);

  // Exclusive is the opposite default: a chat wearing its whole history is noise, so only an
  // explicit false turns the cleanup off.
  assert.equal(normalizeStatusLabelConfig({}).exclusive, true);
  assert.equal(normalizeStatusLabelConfig({ exclusive: false }).exclusive, false);

  // Status keys arrive from a form and from our own code in different spellings.
  const config = normalizeStatusLabelConfig({ labels: { "Out For Delivery": "مع المندوب", "shipment-created": "تم الشحن" } });
  assert.equal(config.labels.out_for_delivery, "مع المندوب");
  assert.equal(config.labels.shipment_created, "تم الشحن");
  // A status the caller did not mention keeps its default rather than vanishing from the map.
  assert.equal(config.labels.delivered, "تم التسليم");
});

test("a status change reaches the label hook from both paths that change one", () => {
  // The hook is the whole feature: the service can be perfect and label nothing if no status
  // transition calls it. These are the two places a status actually moves.
  assert.match(
    read("../server/services/whatsappShippingService.js"),
    /whatsappOrderLabelService\.js[\s\S]{0,200}syncWhatsappOrderStatusLabel/
  );
  assert.match(
    read("../server/services/whatsappOrderConfirmationService.js"),
    /whatsappOrderLabelService\.js[\s\S]{0,200}syncWhatsappOrderStatusLabel/
  );
  // Same gitignore trap as the capabilities service: unlisted means it deploys as nothing.
  assert.match(read("../.gitignore"), /^!server\/services\/whatsappOrderLabelService\.js$/m);
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
