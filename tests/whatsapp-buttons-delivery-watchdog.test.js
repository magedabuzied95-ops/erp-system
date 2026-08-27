import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEvolutionLifecycleStatus,
  trackEvolutionButtonsMessage,
} from "../server/services/whatsappGatewayService.js";

// Every interactive sender (CTA receipt, order-confirmation buttons, product carousel) hands the
// tracker a fallback that re-sends the whole message body as plain text. Firing that on "no ack
// yet" is what sent every invoice receipt twice: the CTA at 23:46:04, then the entire receipt
// again at 23:46:34 — because a customer whose phone is off never acks within thirty seconds.
// A pending ack describes the phone, not the message. Only the provider saying FAILED means the
// message will never arrive, and that is the only thing allowed to re-send it.

const uniqueId = (label) => `${label}:${process.hrtime.bigint()}`;

const trackSend = (messageId, fallback) =>
  trackEvolutionButtonsMessage({
    messageId,
    status: "SERVER_ACK",
    remoteJid: "whatsapp:201024960585",
    messageType: "buttons",
    endpoint: "/message/sendButtons/m1",
    phoneSuffix: "0585",
    fallbackOnNotDelivered: fallback,
  });

test("a silent thirty seconds never re-sends the message", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fallbacks = 0;
  const messageId = uniqueId("silent");
  trackSend(messageId, async () => {
    fallbacks += 1;
  });
  // Well past the 30s watchdog, with no delivery webhook of any kind.
  t.mock.timers.tick(120000);
  await Promise.resolve();
  assert.equal(fallbacks, 0, "an un-acked message must not be sent a second time");
});

test("the provider saying FAILED is what re-sends it", async () => {
  let fallbacks = 0;
  const messageId = uniqueId("failed");
  trackSend(messageId, async () => {
    fallbacks += 1;
  });
  trackEvolutionButtonsMessage({ messageId, status: "FAILED" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fallbacks, 1, "a rejected button must not cost the customer the message");
});

test("a FAILED message re-sends once, however many times the webhook repeats it", async () => {
  let fallbacks = 0;
  const messageId = uniqueId("failed-twice");
  trackSend(messageId, async () => {
    fallbacks += 1;
  });
  trackEvolutionButtonsMessage({ messageId, status: "FAILED" });
  trackEvolutionButtonsMessage({ messageId, status: "error" });
  trackEvolutionButtonsMessage({ messageId, status: "FAILED" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fallbacks, 1, "the fallback is once per message, not once per webhook");
});

test("an ack that arrives before our own send response is not undone by it", () => {
  // Evolution's messages.update routinely beats our fetch response back, so the webhook can
  // register the ack first. Letting the later SERVER_ACK overwrite it moved the message backwards
  // and re-armed a watchdog the real ack had already answered.
  const messageId = uniqueId("race");
  trackEvolutionButtonsMessage({ messageId, status: "DELIVERY_ACK" });
  const afterSend = trackSend(messageId, async () => {});
  assert.equal(afterSend.status, "DELIVERY_ACK", "a delivered message never goes back to sent");
  assert.equal(afterSend.timer, null, "and no watchdog is left armed behind it");
});

test("the lifecycle only ever moves forward", () => {
  assert.equal(resolveEvolutionLifecycleStatus("PENDING", "SERVER_ACK"), "SERVER_ACK");
  assert.equal(resolveEvolutionLifecycleStatus("SERVER_ACK", "DELIVERY_ACK"), "DELIVERY_ACK");
  assert.equal(resolveEvolutionLifecycleStatus("DELIVERY_ACK", "READ"), "READ");
  assert.equal(resolveEvolutionLifecycleStatus("READ", "DELIVERY_ACK"), "READ");
  assert.equal(resolveEvolutionLifecycleStatus("DELIVERY_ACK", "SERVER_ACK"), "DELIVERY_ACK");
  assert.equal(resolveEvolutionLifecycleStatus("READ", "PENDING"), "READ");
  // FAILED is terminal from either side - a message the provider rejected does not later succeed.
  assert.equal(resolveEvolutionLifecycleStatus("READ", "FAILED"), "FAILED");
  assert.equal(resolveEvolutionLifecycleStatus("FAILED", "READ"), "FAILED");
});

test("a delivered message clears the watchdog instead of leaving it armed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fallbacks = 0;
  const messageId = uniqueId("delivered");
  trackSend(messageId, async () => {
    fallbacks += 1;
  });
  trackEvolutionButtonsMessage({ messageId, status: "DELIVERY_ACK" });
  t.mock.timers.tick(120000);
  await Promise.resolve();
  assert.equal(fallbacks, 0);
});
