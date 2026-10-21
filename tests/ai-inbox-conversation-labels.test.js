import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_INBOX_DEFAULT_LABELS,
  aiInboxLabelsFromConversation,
  customAiInboxLabel,
  normalizeAiInboxConversationLabels,
} from "../shared/aiInboxConversationLabels.js";

const desktopSource = readFileSync("src/modules/aiSupport/components/ConversationLabelsModal.jsx", "utf8") + readFileSync("src/modules/aiSupport/pages/AiInbox.jsx", "utf8") + readFileSync("src/modules/aiSupport/pages/AiInboxPwa.jsx", "utf8");
const routeSource = readFileSync("server/routes/aiAgentOrders.js", "utf8");

test("labels are not stages: the starter catalogue is plain tags, and a stage never shows as a label", () => {
  // Genie ERP keeps tags (by hand) and the CRM stage (automatic) apart; the old
  // catalogue was one label per stage, so the two filters repeated each other.
  assert.deepEqual(AI_INBOX_DEFAULT_LABELS.map((label) => label.id), ["vip", "complaint", "follow_up", "exchange", "wholesale", "inquiry"]);
  assert.ok(AI_INBOX_DEFAULT_LABELS.every((label) => !label.leadStatus));
  assert.deepEqual(aiInboxLabelsFromConversation({ lead_status: "interested" }), []);
});

test("conversation labels allow stable custom labels and multiple selections", () => {
  const vipA = customAiInboxLabel("VIP Client");
  const vipB = customAiInboxLabel("  VIP   Client ");
  assert.deepEqual(vipA, vipB);
  const labels = normalizeAiInboxConversationLabels(["New", "VIP Client", "VIP Client", "Urgent"]);
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map((label) => label.name), ["New", "VIP Client", "Urgent"]);
  // A label no longer carries a stage, even one with a stage's old id.
  assert.deepEqual(normalizeAiInboxConversationLabels([{ id: "new", name: "Fresh Lead", color: "teal" }])[0], {
    id: "new",
    name: "Fresh Lead",
    color: "teal",
  });
  assert.equal(customAiInboxLabel("عميل مهم").id, "vip");
});

test("desktop label manager saves labels and renders them beside the customer name", () => {
  assert.match(desktopSource, /function ConversationLabelsModal/);
  assert.match(desktopSource, /aria-label=\{t\("aiSupport\.inbox\.ui\.conversationLabels"\)\}/);
  // Localized: these pin the translation KEY plus the live value rendered
  // beside it, so the guard still proves the count and the custom-label name
  // reach the UI without pinning one locale's copy.
  assert.match(desktopSource, /aiSupport\.inbox\.labels\.current"\)\} \(\{draftLabels\.length\}\)/);
  assert.match(desktopSource, /aiSupport\.inbox\.labels\.available/);
  assert.match(desktopSource, /aiSupport\.inbox\.labels\.create"\)\} “\{customCandidate\.name\}”/);
  assert.match(desktopSource, /aiAgentInboxEndpoint\(sessionId, "\/labels"\)/);
  assert.match(desktopSource, /conversationLabels\.slice\(0, 4\)\.map/);
  assert.match(desktopSource, /aria-label=\{`Edit \$\{label\.name\}`\}/);
  assert.match(desktopSource, /aiSupport\.inbox\.ui\.saveEdit/);
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
