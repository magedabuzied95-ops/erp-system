// WhatsApp multi-number — every send names its instance.
//
// One env-read instance name used to be baked into every Evolution endpoint,
// so a second WhatsApp number could receive webhooks but every reply left from
// the first number. These guards pin the thread-through: the gateway accepts
// an instance override, the inbox paths pass the conversation's instance, and
// the chat recovery scan covers every registered number — so a refactor cannot
// quietly re-hardcode the single number.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const gateway = read("server/services/whatsappGatewayService.js");
const adapter = read("server/services/aiChannelAdapterService.js");
const inboxRoutes = read("server/routes/aiAgentOrders.js");

test("the Evolution config accepts an instance override", () => {
  assert.match(gateway, /const requireEvolutionConfig = \(instance = ""\)/);
  assert.match(gateway, /if \(selectedInstance\) current\.instanceName = selectedInstance;/);
});

test("every gateway send function takes the instance it must send from", () => {
  for (const signature of [
    /export const sendTextMessage = async \(\{ phone, message, instance = ""/,
    /export const sendImageMessage = async \(\{ phone, imageUrl, caption = "", instance = ""/,
    /export const sendWhatsappReaction = async \(\{[^}]*instance = ""/,
    /export const editWhatsappTextMessage = async \(\{[^}]*instance = ""/,
  ]) {
    assert.match(gateway, signature);
  }
});

test("the AI auto-reply answers from the number the customer wrote to", () => {
  const passes = gateway.match(/instance: text\(message\.instance \|\| ""\)/g) || [];
  assert.ok(passes.length >= 3, `expected the auto-reply text/image/fallback sends to pass message.instance, found ${passes.length}`);
});

test("a conversation resolves to its owning instance, with a message-row fallback", () => {
  assert.match(gateway, /export const resolveWhatsappConversationInstance/);
  assert.match(gateway, /metadata->>'whatsapp_instance'/);
  assert.match(gateway, /SELECT whatsapp_instance\s+FROM ai_support_messages/);
});

test("the chat recovery scan covers every registered number, not only the env default", () => {
  assert.match(gateway, /listWhatsappSyncInstances/);
  assert.match(gateway, /listChannelAccounts\(\{ tenantId, platform: "whatsapp" \}\)/);
  const historySync = gateway.slice(
    gateway.indexOf("export const syncEvolutionConversationMessagesToAiInbox"),
    gateway.indexOf("const runEvolutionChatsToAiInboxSync")
  );
  assert.match(historySync, /resolveWhatsappConversationInstance/, "the per-conversation history sync fetches from the default instance again");
  assert.doesNotMatch(historySync, /encodeURIComponent\(instanceName\(\)\)/, "the history fetch endpoint is pinned to the env instance again");
});

test("the adapter threads the instance through to the Evolution gateway", () => {
  assert.match(adapter, /export const sendWhatsAppCloudReply = async \(\{ to, reply = \{\}, messageText = "", instance = ""/);
  assert.match(adapter, /postEvolutionWhatsAppMessage = async \(\{[^}]*instance = ""/);
  const evolutionCalls = adapter.match(/postEvolutionWhatsAppMessage\(\{.*\}\)/g) || [];
  assert.ok(evolutionCalls.length >= 5, `expected the evolution call sites to be present, found ${evolutionCalls.length}`);
  for (const call of evolutionCalls) {
    assert.match(call, /instance/, `an evolution send dropped the instance: ${call}`);
  }
});

test("the inbox manual paths send from the conversation's number", () => {
  const passes = inboxRoutes.match(/channel_metadata\?\.whatsapp_instance \|\| conversation\??\.channel_metadata\?\.instance|channelMetadata\.whatsapp_instance \|\| channelMetadata\.instance/g) || [];
  assert.ok(passes.length >= 5, `expected reaction/edit/text/cards/image sends to pass the conversation instance, found ${passes.length}`);
});

test("an additional WhatsApp number can be registered and verified", () => {
  assert.match(inboxRoutes, /router\.post\("\/channel-accounts", protect, permit\("settings", "edit"\)/);
  assert.match(inboxRoutes, /getWhatsappGatewayStatus\(\{ instance \}\)/);
  assert.match(inboxRoutes, /router\.patch\("\/channel-accounts\/:id"/);
});
