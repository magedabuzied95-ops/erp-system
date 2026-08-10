import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_INBOX_DEFAULT_LABELS,
  aiInboxLabelsFromConversation,
  customAiInboxLabel,
  normalizeAiInboxConversationLabels,
} from "../shared/aiInboxConversationLabels.js";

const desktopSource = readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8");
const routeSource = readFileSync("server/routes/aiAgentOrders.js", "utf8");

test("default conversation labels replace the single lead-status selector", () => {
  assert.deepEqual(AI_INBOX_DEFAULT_LABELS.map((label) => label.id), ["new", "contacted", "interested", "negotiation", "won", "lost"]);
  assert.equal(aiInboxLabelsFromConversation({ lead_status: "interested" })[0]?.name, "Interested");
});

test("conversation labels allow stable custom labels and multiple selections", () => {
  const vipA = customAiInboxLabel("VIP Client");
  const vipB = customAiInboxLabel("  VIP   Client ");
  assert.deepEqual(vipA, vipB);
  const labels = normalizeAiInboxConversationLabels(["New", "VIP Client", "VIP Client", "Urgent"]);
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map((label) => label.name), ["New", "VIP Client", "Urgent"]);
  assert.deepEqual(normalizeAiInboxConversationLabels([{ id: "new", name: "Fresh Lead", color: "teal" }])[0], {
    id: "new",
    name: "Fresh Lead",
    color: "teal",
    leadStatus: "new",
  });
});

test("desktop label manager saves labels and renders them beside the customer name", () => {
  assert.match(desktopSource, /function ConversationLabelsModal/);
  assert.match(desktopSource, /aria-label="Conversation Labels"/);
  assert.match(desktopSource, /Current labels \(\{draftLabels\.length\}\)/);
  assert.match(desktopSource, /Available labels/);
  assert.match(desktopSource, /إنشاء “\{customCandidate\.name\}”/);
  assert.match(desktopSource, /aiAgentInboxEndpoint\(sessionId, "\/labels"\)/);
  assert.match(desktopSource, /conversationLabels\.slice\(0, 4\)\.map/);
  assert.match(desktopSource, /aria-label=\{`Edit \$\{label\.name\}`\}/);
  assert.match(desktopSource, /Save edit/);
  assert.match(desktopSource, /timeoutMs: 12000/);
});

test("labels endpoint persists labels on both customer profile and channel conversation", () => {
  assert.match(routeSource, /router\.patch\("\/inbox\/:conversationId\/labels"/);
  assert.match(routeSource, /WITH target AS \([\s\S]*?updated_conversation AS \([\s\S]*?updated_profile AS \(/);
  assert.match(routeSource, /UPDATE ai_customer_profiles[\s\S]*?conversation_labels/);
  assert.match(routeSource, /UPDATE ai_channel_conversations[\s\S]*?conversation_labels/);
  assert.doesNotMatch(routeSource.match(/router\.patch\("\/inbox\/:conversationId\/labels"[\s\S]*?router\.patch\("\/inbox\/:conversationId\/close"/)?.[0] || "", /loadLeadConversationForAction/);
  assert.match(routeSource, /reason: "conversation_labels_updated"/);
});
