import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCloudAiAutoReplyMessage, cloudInstanceKey, dispatchCloudAiAutoReply, runCloudMarketingStopWord } from "../server/modules/whatsappOfficial/cloudAiAutoReply.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const metadata = { phone_number_id: "1099131296614579", display_phone_number: "15550000000" };
const cloudMessage = {
  external_conversation_id: "whatsapp:201024960585",
  external_customer_id: "201024960585",
  external_message_id: "wamid.TEST123",
  customer_name: "Owner",
  message_text: "where is my order",
  attachments: [],
  timestamp: "2026-10-21T10:00:00.000Z",
  raw: { message: { id: "wamid.TEST123" }, metadata },
};
const inboundRow = { id: 77, session_id: "whatsapp:201024960585" };

test("a Cloud message becomes the normalized message the Evolution trigger reads, on its own number", () => {
  const input = buildCloudAiAutoReplyMessage({ tenantId: 1, message: cloudMessage, metadata, inboundRow });
  assert.equal(input.instance, "cloud:1099131296614579");
  assert.equal(input.phone, "201024960585");
  assert.equal(input.remoteJid, "201024960585@s.whatsapp.net");
  assert.equal(input.resolvedPhone, "201024960585");
  assert.equal(input.message_id, "wamid.TEST123");
  assert.equal(input.fromMe, false);
  assert.equal(input.isGroup, false);
  assert.equal(input.text, "where is my order");
  assert.equal(input.raw.tenant_id, 1, "the trigger reads the tenant from raw.tenant_id");
  assert.deepEqual(
    { saved: input.inbox.saved, duplicate: input.inbox.duplicate, session_id: input.inbox.session_id },
    { saved: true, duplicate: false, session_id: "whatsapp:201024960585" },
    "the trigger's inbox gate only passes a saved, non-duplicate inbound row"
  );
  assert.equal(buildCloudAiAutoReplyMessage({ tenantId: 1, message: cloudMessage, metadata, inboundRow: null }).inbox.saved, false);
  assert.equal(cloudInstanceKey({}), "");
});

test("the Cloud handler's AI goes through the shared trigger with instance cloud:<id>, never /api/ai-support/chat", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, ...rest) => {
    fetched.push(String(url));
    return originalFetch ? originalFetch(url, ...rest) : null;
  };
  try {
    const outcome = await dispatchCloudAiAutoReply({
      tenantId: 1,
      message: cloudMessage,
      metadata,
      inboundRow,
      photoOnlyText: () => "",
      trigger: async (input) => {
        calls.push(input);
        return { triggered: true, sent: true, reason: "" };
      },
    });
    assert.equal(outcome.sent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1, "exactly one reply pipeline runs");
  assert.equal(calls[0].instance, "cloud:1099131296614579");
  assert.equal(calls[0].phone, "201024960585");
  assert.ok(!fetched.some((url) => url.includes("/api/ai-support/chat")), "no website-style loopback");
});

test("no number id, no reply — it would otherwise leave from the env default (Evolution) line", async () => {
  let called = false;
  const outcome = await dispatchCloudAiAutoReply({
    tenantId: 1,
    message: cloudMessage,
    metadata: {},
    inboundRow,
    photoOnlyText: () => "",
    trigger: async () => { called = true; return {}; },
  });
  assert.equal(called, false);
  assert.equal(outcome.reason, "missing_phone_number_id");
});

test("a caption-less photo enters as the photo question, like on Evolution; a trigger crash never escapes", async () => {
  const photoMessage = {
    ...cloudMessage,
    message_text: "",
    attachments: [{ type: "image", url: "https://cdn.test/p.jpg" }],
  };
  let seen = null;
  const outcome = await dispatchCloudAiAutoReply({
    tenantId: 1,
    message: photoMessage,
    metadata,
    inboundRow,
    photoOnlyText: (input) => (input.media_type === "image" && input.inbox.reason === "media_saved" ? "PHOTO_Q" : ""),
    trigger: async (input) => { seen = input; throw new Error("boom"); },
  });
  assert.equal(seen.text, "PHOTO_Q");
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "ai_auto_reply_failed");
});

test("handler source: WhatsApp Cloud delegates to the shared pipeline after intercept/escalation; Messenger/IG keep their path", () => {
  const source = read("server/routes/aiAgentOrders.js");
  const start = source.indexOf("export const handleWhatsappCloudWebhookRequest");
  const end = source.indexOf('router.post("/channels/whatsapp/webhook"', start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /dispatchCloudAiAutoReply\(\{ tenantId, message, metadata, inboundRow \}\)/);
  assert.doesNotMatch(handler, /routeChannelMessageThroughAi\(/, "the old website-style AI path is gone from WhatsApp Cloud");
  assert.doesNotMatch(handler, /sendWhatsAppCloudReply\(/, "the reply is sent by the shared trigger, not here");
  const dispatchAt = handler.indexOf("dispatchCloudAiAutoReply(");
  assert.ok(handler.indexOf("interceptWaOfficialInbound(") < dispatchAt, "an intercepted message never reaches the AI");
  assert.ok(handler.indexOf("if (intercepted.handled)") < dispatchAt);
  assert.ok(handler.indexOf("detectEscalation(") < dispatchAt);
  // Messenger / Instagram still use the old router.
  assert.match(source.slice(end), /routeChannelMessageThroughAi\(\{ req, tenantId, message, channel \}\)/);
});

test("gateway source: the shared trigger routes every Cloud piece through the message's own number", () => {
  const source = read("server/services/whatsappGatewayService.js");
  assert.match(source, /export const sendCtaUrlMessage = async \(\{[^}]*instance = ""/, "the order-tracking button takes the instance");
  const trigger = source.slice(source.indexOf("export const triggerWhatsappAiAutoReply"));
  assert.match(trigger, /url: trackingCta\.url,[\s\S]{0,120}instance: text\(message\.instance \|\| ""\)/);
  assert.match(trigger, /aiCarousel\.reason === "cloud_transport"/, "the AI's words still go out when Cloud cannot carousel");
  assert.match(trigger, /whatsappInstance: isCloudTransport\(message\.instance\)/, "the reply row records cloud:<id>");
  assert.match(trigger, /presenceSupported/, "no Evolution presence/read calls for a Cloud number");
});

test("the marketing stop word runs once per Cloud message, before the intercept chain, and the AI trigger skips it", async () => {
  const seen = [];
  await runCloudMarketingStopWord({ tenantId: 1, message: cloudMessage, handler: async (args) => { seen.push(args); return { opted_out: false }; } });
  assert.deepEqual(seen, [{ tenantId: 1, message: "where is my order", phone: "201024960585" }]);
  const crashed = await runCloudMarketingStopWord({ tenantId: 1, message: cloudMessage, handler: async () => { throw new Error("db down"); } });
  assert.equal(crashed.opted_out, false, "a consent failure never costs the message");
  assert.equal(buildCloudAiAutoReplyMessage({ tenantId: 1, message: cloudMessage, metadata, inboundRow }).marketingStopWordHandled, true);

  const source = read("server/routes/aiAgentOrders.js");
  const start = source.indexOf("export const handleWhatsappCloudWebhookRequest");
  const handler = source.slice(start, source.indexOf('router.post("/channels/whatsapp/webhook"', start));
  const stopAt = handler.indexOf("runCloudMarketingStopWord({ tenantId, message })");
  assert.ok(stopAt > 0, "the handler runs it");
  assert.ok(stopAt < handler.indexOf("interceptWaOfficialInbound("), "before a chatbot flow / campaign reply can take the message");
  assert.ok(stopAt < handler.indexOf("detectEscalation("), "before escalation");

  const gateway = read("server/services/whatsappGatewayService.js");
  assert.match(gateway, /if \(message\.marketingStopWordHandled !== true\) \{\s*void handleInboundMarketingStopWord\(/, "the trigger does not record it a second time");
});
