// Phase 13 — WhatsApp Assisted (Stage C). WhatsApp joins the SAME shared assisted pipeline proven on
// Messenger + Instagram; no new brain, no new intake, no per-channel grounding. These assert (a) the autonomous
// hard kill, (b) the shared intake wiring on the Evolution webhook (fresh non-duplicate only), (c) the shared
// Evolution sender, (d) the channel is first-class, and (e) the shared gate (durable context + multi-colour)
// works verbatim for a whatsapp: session.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as G from "../../server/services/aiInboxGroundingGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../../", rel), "utf8");
const gwRoute = read("server/routes/whatsappGateway.js");
const gwSvc = read("server/services/whatsappGatewayService.js");
const intakeSrc = read("server/services/aiInboundIntakeService.js");
const orderRoute = read("server/routes/aiAgentOrders.js");
const inboxSrc = read("src/modules/aiSupport/pages/AiInbox.jsx");

test("safety: WHATSAPP_AI_AUTO_REPLY=false hard-blocks the autonomous path (first gate, returns sent:false)", () => {
  assert.match(gwSvc, /export const triggerWhatsappAiAutoReply = async[\s\S]{0,200}?if \(String\(process\.env\.WHATSAPP_AI_AUTO_REPLY\)\.toLowerCase\(\) === "false"\) \{[\s\S]{0,120}?return \{ triggered: false, sent: false, reason: "ai_auto_reply_disabled" \};/);
});

test("intake: the WhatsApp webhook fires the SHARED intake ONLY on a fresh, non-duplicate inbound", () => {
  assert.match(gwRoute, /if \(normalized\.text && normalized\.fromMe !== true && normalized\.inbox\?\.saved === true && normalized\.inbox\?\.duplicate !== true\) \{[\s\S]{0,200}?handleInboundMessageIntake\(\{/);
  assert.match(gwRoute, /channel: "whatsapp",/);
});

test("mutual exclusion: intake receives autoSent so an autonomous send is never double-processed", () => {
  assert.match(gwRoute, /autoSent: aiReply\?\.sent === true,/);
  assert.match(intakeSrc, /if \(autoSent \|\| String\(autoReplyMode \|\| ""\)\.toLowerCase\(\) === "fully_automatic"\) return \{ skipped: true, reason: "autonomous_channel" \}/);
});

test("channel: whatsapp is a first-class assisted channel gated by inbound_ai_channels (dormant until ON)", () => {
  assert.match(intakeSrc, /export const ASSISTED_CHANNELS = Object\.freeze\(\["facebook_messenger", "instagram", "whatsapp"\]\)/);
  assert.match(intakeSrc, /if \(!channels\[normalizeAssistedChannel\(channel\)\]\) return \{ skipped: true, reason: "channel_not_assisted" \};/);
});

test("no backfill suggestions: the WhatsApp history-sync does NOT call the intake hook", () => {
  // the only intake call in the gateway service is absent (it lives in the realtime webhook route, not the sync)
  assert.equal((gwSvc.match(/handleInboundMessageIntake/g) || []).length, 0);
  assert.match(gwSvc, /whatsapp:conversation-history-sync/);
});

test("send: WhatsApp assisted uses the shared Evolution sender (sendWhatsAppCloudReply), not the Meta sender", () => {
  // the send route branches on the WhatsApp channel and calls the shared WhatsApp sender
  assert.match(orderRoute, /normalizedChannel === AI_AGENT_CHANNELS\.WHATSAPP/);
  assert.match(orderRoute, /await sendWhatsAppCloudReply\(\{/);
  // and that sender dispatches by provider → evolution in this deployment
  const adapter = read("server/services/aiChannelAdapterService.js");
  assert.match(adapter, /const selectedTransport = config\.provider === "cloud" \? "cloud" : "evolution";/);
});

test("UI: AI Inbox labels WhatsApp delivery as image + link (its audited capability)", () => {
  assert.match(inboxSrc, /if \(ch\.includes\("whatsapp"\)\) return \{ labelKey: "aiSupport\.inbox\.ui\.fmtImageLink", kind: "image_link" \};/);
  assert.match(inboxSrc, /if \(key === "whatsapp"\) return "واتساب";/);
});

test("shared gate: durable context + multi-colour work verbatim for a whatsapp: session", async () => {
  const P = { id: 359, name: "Adidas Adistar22", product_type: "sneakers" };
  const deps = {
    resolveProductSubject: async () => ({ productId: "359", source: "approved_selection", ageSeconds: 20 }),
    resolveProductById: async () => P,
    resolveByBrandModel: async () => [],
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1, size: "44", color: "Navy", stock: 1 }, { variant_id: 2, size: "44", color: "White", stock: 3 }] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "whatsapp:201024960585", message: "طب مقاس ٤٤؟", deps });
  assert.equal(r.grounding.product_resolution.source, "conversation_context");
  assert.equal(r.action, "color_choice_required"); // Phase 12.2 rule applies channel-agnostically
});

test("no cross-channel identity merge: whatsapp normalises to whatsapp only", () => {
  assert.match(intakeSrc, /c === "instagram_dm" \? "instagram" : c/);
  // there is no rule folding whatsapp into another channel
  assert.doesNotMatch(intakeSrc, /=== "whatsapp"[^)]*\?[^:]*"(facebook_messenger|instagram)"/);
});
