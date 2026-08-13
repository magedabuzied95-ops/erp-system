// Batch 1B — Evolution messages.update routing + delivery reconciliation reachability.
//
// Two proven production defects, both fixed here:
//   1. processEvolutionStatusUpdate never read data.keyId (the real WhatsApp provider id) and fell through to
//      data.messageId — Evolution's OWN row id — so every reconciliation looked up an id we never stored.
//   2. A status event carries no text and no media, so the generic inbound skip gate returned "missing_text"
//      BEFORE the status dispatch, leaving message_delivery_events empty.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getEvolutionStatusUpdateDecision } from "../server/services/whatsappGatewayService.js";
import { mapProviderStatus, isAllowedTransition, statusRank, sanitizeDeliveryEvent } from "../server/services/messageDeliveryReconciliationService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const statusFnSrc = () => { const f = gwSrc.slice(gwSrc.indexOf("const processEvolutionStatusUpdate")); return f.slice(f.indexOf("const providerMessageId = text("), f.indexOf("const remoteJid = text(")); };
const gwSrc = readFileSync(path.join(here, "../server/services/whatsappGatewayService.js"), "utf8");

// The REAL Evolution v2.3.7 flat shape (from dist/api/server.module.js sendDataWebhook("messages.update", …)).
const statusPayload = (status, keyId = "3EB0REALWHATSAPPID") => ({
  event: "messages.update",
  data: { messageId: "evolution-internal-row-id", keyId, remoteJid: "201024960585@s.whatsapp.net", fromMe: true, participant: "201024960585@s.whatsapp.net", status, instanceId: "c2ba4664-74da-4b4c-b1d7-8898efe0da21" },
});
const envelopeFor = (status) => ({ event: "messages.update", rawEvent: "messages.update", fromMe: true, data: { status } });

// ---------------- 1/2: provider identity ----------------
test("1/2: data.keyId is extracted and OUTRANKS data.messageId", () => {
  const chain = statusFnSrc();
  assert.match(chain, /data\?\.keyId/, "keyId must be in the provider-id chain");
  assert.ok(chain.indexOf("data?.keyId") < chain.indexOf("data?.messageId"),
    "keyId must be resolved BEFORE messageId (messageId is Evolution's internal row id)");
});

test("3/4: identity stays exact — no fuzzy fallback from a present keyId", () => {
  const chain = statusFnSrc();
  assert.doesNotMatch(chain, /LIKE|includes\(|startsWith\(/, "no fuzzy matching in provider identity");
});

// ---------------- 5-10: the REAL string vocabulary ----------------
for (const [raw, expected] of [["PENDING", "pending"], ["SERVER_ACK", "sent"], ["DELIVERY_ACK", "delivered"],
                               ["READ", "read"], ["PLAYED", "read"], ["ERROR", "failed"]]) {
  test(`${raw} → ${expected}`, () => {
    assert.equal(mapProviderStatus("whatsapp", raw), expected);
    assert.equal(mapProviderStatus("whatsapp", raw.toLowerCase()), expected, "case-insensitive parity");
  });
}

test("MANDATORY: DELIVERY_ACK is delivered, never read", () => {
  assert.equal(mapProviderStatus("whatsapp", "DELIVERY_ACK"), "delivered");
  assert.notEqual(mapProviderStatus("whatsapp", "DELIVERY_ACK"), "read");
});

// ---------------- 11/12/13: the skip-gate exemption ----------------
test("11: a genuine messages.update is classified as a status update", () => {
  for (const s of ["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED", "ERROR"]) {
    const d = getEvolutionStatusUpdateDecision(statusPayload(s), envelopeFor(s));
    assert.equal(d.isStatusUpdate, true, `${s} must classify as a status update`);
    assert.equal(d.reason, "messages_update");
  }
});

test("11: the skip gate is bypassed ONLY for a genuine status event", () => {
  assert.match(gwSrc, /const statusDecision = getEvolutionStatusUpdateDecision\(payload, envelope\);\s*\n\s*const skipReason = statusDecision\.isStatusUpdate\s*\n?\s*\?\s*null\s*\n?\s*:\s*getEvolutionWebhookSkipReason\(/);
});

test("13: the SAME decision object is reused by the later dispatch (classified once)", () => {
  const inHandler = gwSrc.slice(gwSrc.indexOf("const skipReason = statusDecision.isStatusUpdate"));
  const redeclared = inHandler.match(/const statusDecision = getEvolutionStatusUpdateDecision/g) || [];
  assert.equal(redeclared.length, 0, "the dispatch must reuse the decision, not re-classify");
  assert.match(inHandler, /statusDecision\.isStatusUpdate/, "the dispatch still consumes the same object");
});

// ---------------- 12/14-20: inbound is untouched (DEPLOYMENT BLOCKER) ----------------
test("14: a real inbound customer text is NOT classified as a status event", () => {
  const d = getEvolutionStatusUpdateDecision(
    { event: "messages.upsert", data: { key: { id: "ABC", remoteJid: "2010@s.whatsapp.net", fromMe: false }, message: { conversation: "عايز كوتشي" } } },
    { event: "messages.upsert", rawEvent: "messages.upsert", fromMe: false }
  );
  assert.equal(d.isStatusUpdate, false);
  assert.equal(d.reason, "inbound_messages_upsert", "the inbound guard must still fire first");
});

test("17/18: inbound media / voice are not status events", () => {
  for (const msg of [{ imageMessage: { url: "x" } }, { audioMessage: { url: "x" } }]) {
    const d = getEvolutionStatusUpdateDecision(
      { event: "messages.upsert", data: { key: { id: "M1", fromMe: false }, message: msg } },
      { event: "messages.upsert", rawEvent: "messages.upsert", fromMe: false }
    );
    assert.equal(d.isStatusUpdate, false);
  }
});

test("12: an ordinary no-text / no-media payload does NOT bypass the gate", () => {
  const d = getEvolutionStatusUpdateDecision({ event: "presence.update", data: {} }, { event: "presence.update", rawEvent: "presence.update", fromMe: false });
  assert.equal(d.isStatusUpdate, false, "only a genuine status event may bypass missing_text");
});

// ---------------- 21-25: side-effect isolation ----------------
test("21-25: the status branch reconciles delivery ONLY — no intake, no draft, no send", () => {
  const branch = gwSrc.slice(gwSrc.indexOf("stage=status_route_selected"), gwSrc.indexOf("stage=status_route_selected") + 1400);
  assert.match(branch, /processEvolutionStatusUpdate\(payload\)/);
  for (const forbidden of ["handleInboundMessageIntake", "generateAiInboxReply", "sendWhatsAppCloudReply", "triggerWhatsappAiAutoReply"]) {
    assert.doesNotMatch(branch, new RegExp(forbidden), `status path must never call ${forbidden}`);
  }
});

// ---------------- 28-33: monotonic lifecycle ----------------
test("28/29/30: forward transitions allowed", () => {
  assert.equal(isAllowedTransition("pending", "sent"), true);
  assert.equal(isAllowedTransition("sent", "delivered"), true);
  assert.equal(isAllowedTransition("delivered", "read"), true);
});

test("31/32: downgrades blocked", () => {
  assert.equal(isAllowedTransition("delivered", "sent"), false);
  assert.equal(isAllowedTransition("read", "delivered"), false);
  assert.equal(isAllowedTransition("read", "sent"), false);
});

test("33: a duplicate same-status event is a no-op", () => {
  assert.equal(isAllowedTransition("delivered", "delivered"), false, "no repeated semantic transition");
  assert.equal(statusRank("delivered"), statusRank("delivered"));
});

// ---------------- 34-38: ledger ----------------
test("34/37/38: the ledger event is sanitized and carries a stable dedup key", () => {
  const a = sanitizeDeliveryEvent({ tenantId: 1, channel: "whatsapp", providerMessageId: "3EB0X", status: "delivered", metadata: { remote_jid: "2010@s.whatsapp.net", instance: "m1", api_key: "SECRET", body: "text" } });
  const b = sanitizeDeliveryEvent({ tenantId: 1, channel: "whatsapp", providerMessageId: "3EB0X", status: "delivered", metadata: { remote_jid: "2010@s.whatsapp.net", instance: "m1" } });
  assert.equal(a.dedup_key, b.dedup_key, "same event ⇒ same dedup key");
  assert.equal(JSON.stringify(a).includes("SECRET"), false, "secrets are never stored");
  assert.equal(JSON.stringify(a).includes("\"body\""), false, "raw bodies are never stored");
});

// ---------------- 39/40: the historical four-card batch ----------------
test("39/40: the four historical cards finish DELIVERED — and never read without a READ event", () => {
  const ids = ["3EB0E8B70795A72B394487", "3EB070FD7F57973FFB4A32", "3EB065F110824D6128156F", "3EB0CE3C0D2D555D5AD173"];
  for (const id of ids) {
    const acks = ["SERVER_ACK", "DELIVERY_ACK"]; // exactly what production captured — no READ was emitted
    let state = "pending";
    for (const ack of acks) {
      const next = mapProviderStatus("whatsapp", ack);
      if (isAllowedTransition(state, next)) state = next;
      const d = getEvolutionStatusUpdateDecision(statusPayload(ack, id), envelopeFor(ack));
      assert.equal(d.isStatusUpdate, true);
    }
    assert.equal(state, "delivered", `${id} must finish delivered`);
    assert.notEqual(state, "read", `${id} must NOT become read without a READ ack`);
  }
});

// ---------------- 46 + media conclusion ----------------
test("media: missing width/height/jpegThumbnail is NOT a failure signal", () => {
  // The historical black card (variant 1421) had no dimensions or thumbnail in the immediate response and still
  // reached DELIVERY_ACK. Nothing in the delivery path may treat absent render metadata as failure.
  assert.equal(mapProviderStatus("whatsapp", "DELIVERY_ACK"), "delivered");
  assert.doesNotMatch(gwSrc, /jpegThumbnail[\s\S]{0,80}(failed|failure)/i);
});

test("46: no autonomous reply anywhere on the status path", () => {
  const branch = gwSrc.slice(gwSrc.indexOf("stage=status_route_selected"), gwSrc.indexOf("stage=status_route_selected") + 1400);
  assert.doesNotMatch(branch, /sendWhatsapp|sendText|sendMedia/i);
});
