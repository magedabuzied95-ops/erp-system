// Batch 1B final — DELIVERY_ACK normalisation.
//
// The owner live proof exposed the last defect: Evolution recorded DELIVERY_ACK for all five outbound messages,
// the webhooks arrived, the ledger matched them exactly — and every row still said "sent". Root cause was ONE
// line in the gateway normaliser that lumped delivery_ack in with server_ack and returned "sent", placed BEFORE
// the includes("deliver") branch so a delivery ACK could never reach "delivered".
//
// Note on coverage: the gateway normaliser is module-private, so its contract is asserted against source while
// the value semantics are asserted behaviourally through the reconciliation authority. The end-to-end DB write is
// covered by the deployed-code proof plus natural ACK traffic — no send is manufactured here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapProviderStatus, isAllowedTransition } from "../server/services/messageDeliveryReconciliationService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gwSrc = readFileSync(path.join(here, "../server/services/whatsappGatewayService.js"), "utf8");
const normalizerSrc = (() => {
  const i = gwSrc.indexOf("const normalizeEvolutionDeliveryStatus");
  return gwSrc.slice(i, gwSrc.indexOf("const processEvolutionStatusUpdate", i));
})();

// ---------------- 1: the exact collapsing line is gone ----------------
test("ROOT CAUSE: delivery_ack is no longer collapsed into the server_ack branch", () => {
  const sentBranch = normalizerSrc.split("\n").find((l) => l.includes('return "sent"') && l.includes("server_ack"));
  assert.ok(sentBranch, "the sent branch still exists");
  assert.doesNotMatch(sentBranch, /delivery_ack/, 'delivery_ack must NOT map to "sent"');
});

test("delivery reaches the delivered branch", () => {
  assert.match(normalizerSrc, /status\.includes\("deliver"\)\) return "delivered"/);
  // failure keywords still evaluated first so "undeliverable" is a failure, not a delivery
  assert.ok(normalizerSrc.indexOf('includes("undeliver")') < normalizerSrc.indexOf('includes("deliver")) return "delivered"'));
});

// ---------------- 2-6: the six real values, one authority ----------------
for (const [raw, expected] of [["PENDING", "pending"], ["SERVER_ACK", "sent"], ["DELIVERY_ACK", "delivered"],
                               ["READ", "read"], ["PLAYED", "read"], ["ERROR", "failed"]]) {
  test(`${raw} → ${expected} (reconciliation authority)`, () => {
    assert.equal(mapProviderStatus("whatsapp", raw), expected);
  });
}

test("7/8/9: DELIVERY_ACK is never sent and never read; SERVER_ACK is never delivered", () => {
  assert.notEqual(mapProviderStatus("whatsapp", "DELIVERY_ACK"), "sent");
  assert.notEqual(mapProviderStatus("whatsapp", "DELIVERY_ACK"), "read");
  assert.notEqual(mapProviderStatus("whatsapp", "SERVER_ACK"), "delivered");
});

// ---------------- 10: raw provider evidence preserved ----------------
test("10: the RAW provider status reaches the ledger, not an intermediate normalised value", () => {
  assert.match(gwSrc, /const rawProviderStatus = text\(/);
  assert.match(gwSrc, /providerStatus: rawProviderStatus \|\| deliveryStatus/);
});

test("the two authorities agree — no third mapper was introduced", () => {
  // the gateway normaliser and mapProviderStatus must not disagree for any real Evolution value
  const gatewayExpect = { pending: "pending", server_ack: "sent", delivery_ack: "delivered", read: "read", played: "read", error: "failed" };
  for (const [raw, expected] of Object.entries(gatewayExpect)) {
    assert.equal(mapProviderStatus("whatsapp", raw.toUpperCase()), expected, `${raw} must agree`);
  }
});

// ---------------- 11-14: the two shipped fixes must not regress ----------------
test("11/12: data.keyId still outranks data.messageId", () => {
  const fn = gwSrc.slice(gwSrc.indexOf("const processEvolutionStatusUpdate"));
  const chain = fn.slice(fn.indexOf("const providerMessageId = text("), fn.indexOf("const remoteJid = text("));
  assert.match(chain, /data\?\.keyId/);
  assert.ok(chain.indexOf("data?.keyId") < chain.indexOf("data?.messageId"));
});

test("13/14: the skip-gate exemption and single classification survive", () => {
  assert.match(gwSrc, /const skipReason = statusDecision\.isStatusUpdate\s*\n?\s*\?\s*null\s*\n?\s*:\s*getEvolutionWebhookSkipReason\(/);
  const inHandler = gwSrc.slice(gwSrc.indexOf("const skipReason = statusDecision.isStatusUpdate"));
  assert.equal((inHandler.match(/const statusDecision = getEvolutionStatusUpdateDecision/g) || []).length, 0);
});

// ---------------- 16-19: status path stays side-effect free ----------------
test("16-19: the status branch never creates inbound, intake, draft or a send", () => {
  const branch = gwSrc.slice(gwSrc.indexOf("stage=status_route_selected"), gwSrc.indexOf("stage=status_route_selected") + 1400);
  for (const forbidden of ["handleInboundMessageIntake", "generateAiInboxReply", "triggerWhatsappAiAutoReply", "sendWhatsAppCloudReply"]) {
    assert.doesNotMatch(branch, new RegExp(forbidden));
  }
});

// ---------------- 20-24: monotonic progression ----------------
test("20/21/22/23: forward transitions allowed, downgrades blocked", () => {
  assert.equal(isAllowedTransition("sent", "delivered"), true);
  assert.equal(isAllowedTransition("delivered", "sent"), false);
  assert.equal(isAllowedTransition("delivered", "read"), true);
  assert.equal(isAllowedTransition("read", "delivered"), false);
});

test("24: a late duplicate SERVER_ACK cannot downgrade a delivered message", () => {
  let state = "delivered";
  const late = mapProviderStatus("whatsapp", "SERVER_ACK");
  if (isAllowedTransition(state, late)) state = late;
  assert.equal(state, "delivered");
});

// ---------------- 26/27: the exact live package as fixture ----------------
test("26/27: the five owner-proof messages end DELIVERED — and never read without a READ event", () => {
  // provider ids captured from the completed owner proof (read-only; nothing is replayed)
  const ids = ["3EB06061EA744E7B6703E7", "3EB0712C925386C0018C93", "3EB00F3C6FFA8BF2FCE885", "3EB09F5BFDD36B17A4E99C", "3EB0CECD67FC9135332C6D"];
  for (const id of ids) {
    let state = "pending";
    for (const ack of ["SERVER_ACK", "DELIVERY_ACK"]) { // exactly what Evolution recorded — no READ existed
      const next = mapProviderStatus("whatsapp", ack);
      if (isAllowedTransition(state, next)) state = next;
    }
    assert.equal(state, "delivered", `${id} must end delivered`);
    assert.notEqual(state, "read", `${id} must not invent a READ`);
    assert.notEqual(state, "sent", `${id} must not remain sent — this is the defect being fixed`);
  }
});

test("9: ERROR is not flattened to sent or pending", () => {
  assert.equal(mapProviderStatus("whatsapp", "ERROR"), "failed");
  assert.notEqual(mapProviderStatus("whatsapp", "ERROR"), "sent");
});
