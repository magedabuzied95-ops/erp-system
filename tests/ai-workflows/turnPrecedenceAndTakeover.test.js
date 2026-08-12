// Phase 13 stabilization — locks two SHARED-CORE invariants (Messenger + Instagram + WhatsApp) surfaced by the
// WhatsApp owner proof. Diagnosis: neither was a code bug — the intent precedence already resolves substantive
// business intent over greeting within the active turn, and only manual-composer / explicit-Take-Over create
// human_takeover. These tests pin that behaviour so it can never regress across channels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as G from "../../server/services/aiInboxGroundingGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const salesSrc = read("server/services/aiSalesAgentService.js");
const routeSrc = read("server/routes/aiAgentOrders.js");
const stateSrc = read("server/services/aiSupportLogService.js");
const gwRoute = read("server/routes/whatsappGateway.js");

const intent = (msgs) => G.resolveIntentFromEntities(G.mergeTurnEntities(msgs.map((m) => G.extractRequestedEntities(m))));
const merged = (msgs) => G.mergeTurnEntities(msgs.map((m) => G.extractRequestedEntities(m)));

// ---- ISSUE A — active-turn intent precedence (substantive business intent > greeting) ----
test("A1: greeting → product (same turn) resolves PRODUCT_AVAILABILITY", () => {
  assert.equal(intent(["السلام عليكم", "عندكم جوردن فور مقاس ٤٥؟"]), "PRODUCT_AVAILABILITY");
});
test("A2: product → greeting (same turn) still resolves PRODUCT_AVAILABILITY", () => {
  assert.equal(intent(["عندكم جوردن فور مقاس ٤٥؟", "مساء الخير"]), "PRODUCT_AVAILABILITY");
});
test("A3/A4: a standalone greeting resolves GREETING", () => {
  assert.equal(intent(["مساء الخير"]), "GREETING");
  assert.equal(intent(["السلام عليكم"]), "GREETING");
});
test("A5-A7: product entities (brand/size/colour) survive a trailing greeting", () => {
  const e = merged(["عندكم جوردن فور احمر مقاس ٤٥؟", "مساء الخير"]);
  assert.equal(e.brandModelTerm, "جوردن فور");
  assert.equal(e.size, "45");
  assert.equal(e.color, "red");
  assert.equal(e.wantsAvailability, true);
});
test("A8: a new explicit product in the turn overrides the earlier product (latest-wins identity)", () => {
  const e = merged(["عندكم جوردن فور؟", "لا قصدي كروكس مقاس ٤٤"]);
  assert.equal(e.productType, "crocs");
});
test("A9-A11: turn boundary breaks on a prior reply and on a >180s silence gap (bounded active turn)", () => {
  // greeting does NOT resurrect a product from a PAST (already-replied / >180s) turn — that is a separate turn.
  assert.match(salesSrc, /const currentCustomerTurnTexts = \(messages = \[\], \{ maxMessages = 8, turnGapMs = 180000 \} = \{\}\) =>/);
  assert.match(salesSrc, /if \(isOutbound\) break; \/\/ a prior AI\/staff reply closes this turn/);
  assert.match(salesSrc, /if \(newerTs !== null && ts !== null && newerTs - ts > turnGapMs\) break;/);
});
test("A12: greeting never erases grounded entities — merge keeps product identity when latest omits it", () => {
  const e = merged(["عندكم جوردن فور مقاس ٤٥؟", "صباح الخير"]);
  assert.equal(e.brandModelTerm, "جوردن فور");
  assert.equal(e.size, "45");
});

// ---- ISSUE B — only explicit human ownership creates human_takeover ----
test("B-invariant: /send sets human_takeover ONLY for a manual (non-assisted) composer reply", () => {
  assert.match(routeSrc, /if \(isAssistedApprove\) \{[\s\S]*?status: "ai_active"[\s\S]*?\} else \{[\s\S]*?status: "human_takeover"/);
});
test("B-invariant: an assisted approve re-asserts ai_active (text leg) and the product-card leg re-asserts too", () => {
  assert.match(routeSrc, /if \(isAssistedApprove\) \{[\s\S]*?updateAiSupportConversationState\(\{ tenantId, sessionId: conversationId, channel, status: "ai_active"/);
  // product-card/send re-asserts ai_active on an assisted package (2nd leg must not flip to takeover)
  assert.match(routeSrc, /if \(req\.body\?\.assisted_approval === true\) \{\s*await updateAiSupportConversationState\(\{ tenantId, sessionId: conversationId, channel: safeChannel, status: "ai_active"/);
});
test("B-invariant: Return to AI clears the takeover — status ai_active ⇒ ai_enabled TRUE, takeover_started_at NULL", () => {
  assert.match(stateSrc, /ai_enabled = .*CASE WHEN EXCLUDED\.status = 'ai_active' THEN TRUE|CASE WHEN \$11::text = 'ai_active' THEN TRUE ELSE FALSE END/);
  assert.match(stateSrc, /takeover_started_at = CASE[\s\S]*?WHEN EXCLUDED\.status = 'ai_active' THEN NULL/);
});
test("B-invariant: human_takeover is created ONLY by the send route (manual) + the explicit takeover route — not by inbound/draft/stale/gate", () => {
  // the grounding gate never touches conversation state
  assert.doesNotMatch(read("server/services/aiInboxGroundingGate.js"), /updateAiSupportConversationState|human_takeover/);
  // the WhatsApp gateway (inbound webhook + Evolution sender) never sets human_takeover
  assert.doesNotMatch(read("server/services/whatsappGatewayService.js"), /status: "human_takeover"|updateAiSupportConversationState/);
  // the intake service never sets human_takeover (it only READS state to skip)
  assert.doesNotMatch(read("server/services/aiInboundIntakeService.js"), /status: "human_takeover"/);
});
test("B-invariant: a customer inbound + a generated draft never change conversation state (intake only reads)", () => {
  // the WhatsApp webhook fires intake (a suggestion) but never mutates conversation status
  assert.doesNotMatch(gwRoute, /status: "human_takeover"|updateAiSupportConversationState/);
  assert.match(read("server/services/aiInboundIntakeService.js"), /getAiSupportConversationState/);
});
