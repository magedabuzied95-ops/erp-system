import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const inboxRouteSource = read("../server/routes/aiAgentOrders.js");
const gatewayRouteSource = read("../server/routes/whatsappGateway.js");
const logServiceSource = read("../server/services/aiSupportLogService.js");

/*
 * The inbox send handler is one long route, so these read the slice between the send dispatch and
 * the channel-event log rather than the whole file — a match anywhere else in a 7000-line router
 * would prove nothing about this flow.
 */
const inboxSendHandler = (() => {
  const start = inboxRouteSource.indexOf(`router.post("/conversations/:conversationId/send"`);
  const end = inboxRouteSource.indexOf(`router.post("/conversations/:conversationId/product-card/send"`);
  assert.ok(start > -1 && end > start, "the inbox send route moved");
  return inboxRouteSource.slice(start, end);
})();

const cloudStatusBlock = (() => {
  const start = gatewayRouteSource.indexOf("for (const status of Array.isArray(value.statuses)");
  const end = gatewayRouteSource.indexOf("for (const message of Array.isArray(value.messages)");
  assert.ok(start > -1 && end > start, "the cloud status loop moved");
  return gatewayRouteSource.slice(start, end);
})();

test("a successful Cloud reply is persisted from the send flow itself", () => {
  // Not by a follow-up call the caller might forget: the route writes the row after the send,
  // carrying Meta's wamid, so the thread is complete without anyone inserting anything by hand.
  const sendIndex = inboxSendHandler.indexOf("sendWhatsAppCloudReply(");
  // The route persists in more than one branch, so the one that matters is identified by the
  // wamid it carries rather than by being the first append in the handler.
  const persistIndex = inboxSendHandler.indexOf("externalMessageId: sendResult?.message_id");
  assert.ok(sendIndex > -1, "the cloud send is gone from the inbox route");
  assert.ok(persistIndex > sendIndex, "the row carrying Meta's id must be written AFTER the send");
  assert.match(inboxSendHandler, /externalMessageId: sendResult\?\.message_id/);
  assert.match(inboxSendHandler, /providerMessageId: sendResult\?\.message_id/);
  // Who sent it has to survive, or the thread cannot show which employee replied.
  assert.match(inboxSendHandler, /staffUserId: req\.user\?\.id \|\| null/);
});

test("the reply lands in the conversation that was already open, never a new one", () => {
  // sessionId is the route's own conversation id — there is no place a fresh thread could be
  // minted, which is what keeps the Evolution history and the Cloud reply in one thread.
  assert.match(inboxSendHandler, /appendManualAiSupportReply\(\{\s*\n\s*tenantId,\s*\n\s*sessionId: conversationId,/);
  assert.ok(!/sessionId: `whatsapp:\$\{[^}]*\}`/.test(inboxSendHandler), "the send flow must not build its own session id");
});

test("a send Meta refused is recorded as failed, never as delivered", () => {
  /*
   * The row is still written on failure, and deliberately so: an employee who pressed send has to
   * see what happened to their message, and a silent drop is the worse failure. What must never
   * happen is it being dressed up as sent — the status comes from the send result, and a failure
   * carries the reason.
   */
  assert.match(inboxSendHandler, /deliveryStatus = sendResult\?\.delivery_status \|\| \(sendResult\?\.sent \? "sent" : "failed"\)/);
  assert.match(inboxSendHandler, /if \(deliveryStatus === "failed" && !deliveryError\)/);
  assert.match(inboxSendHandler, /deliveryStatus,\s*\n\s*deliveryError,/);
});

test("a status webhook moves the existing row instead of writing another", () => {
  assert.match(cloudStatusBlock, /updateAiSupportMessageDeliveryStatus\(\{/);
  assert.match(cloudStatusBlock, /providerMessageId: wamid/);
  assert.match(cloudStatusBlock, /externalMessageId: wamid/);
  // Nothing in the status path may append.
  assert.ok(!cloudStatusBlock.includes("appendManualAiSupportReply"), "a status must never create a message");
  assert.ok(!cloudStatusBlock.includes("appendInboundAiSupportMessage"), "a status must never create a message");
});

test("a repeated or out-of-order status cannot regress or duplicate the row", () => {
  /*
   * Meta redelivers webhooks and does not order them, so "sent" can arrive after "read". The
   * guarantee is in the updater's SQL: it matches on the provider message id and only assigns a
   * status of strictly higher rank, which makes a replay a no-op rather than a second row.
   */
  const updater = logServiceSource.slice(
    logServiceSource.indexOf("export const updateAiSupportMessageDeliveryStatus"),
    logServiceSource.indexOf("export const appendAutomationSupportTranscript")
  );
  assert.match(updater, /UPDATE ai_support_messages/);
  assert.ok(!updater.includes("INSERT INTO ai_support_messages"), "the updater must never insert");
  // The monotonic rank ladder, and the read/delivered floor that a late 'failed' cannot undo.
  assert.match(updater, /WHEN 'delivered' THEN 3 WHEN 'read' THEN 4/);
  assert.match(updater, /THEN delivery_status ELSE 'failed' END/);
  assert.match(updater, /> \(CASE lower\(COALESCE\(delivery_status, ''\)\)/);
  // And it is addressed by the wamid, which is what makes it idempotent.
  assert.match(updater, /safeProviderMessageId = toText\(providerMessageId \|\| externalMessageId\)/);
  assert.match(updater, /if \(!safeTenantId \|\| !safeProviderMessageId\)/);
});

test("delivered and read both count as statuses worth applying", () => {
  assert.match(gatewayRouteSource, /const CLOUD_DELIVERY_STATUSES = new Set\(\["sent", "delivered", "read", "failed"\]\)/);
  assert.match(cloudStatusBlock, /CLOUD_DELIVERY_STATUSES\.has\(name\)/);
  // A status Meta invents later is logged rather than pushed blindly into the ladder.
  assert.match(cloudStatusBlock, /known_status: CLOUD_DELIVERY_STATUSES\.has\(name\)/);
});

test("the thread key is the customer's phone, so Evolution history stays in place", () => {
  // Both transports address the same thread. If the Cloud path invented its own key, the same
  // customer would appear twice and the older Evolution messages would be stranded.
  assert.match(cloudStatusBlock, /sessionId: recipient \? `whatsapp:\$\{recipient\}` : ""/);
  assert.match(logServiceSource, /normalizeCanonicalWhatsappSessionId/);
});

test("the status path never touches Messenger, Instagram or the Evolution automations", () => {
  for (const foreign of ["sendMetaInboxOutboundMessage", "instagram", "facebook_page", "requireEvolutionConfig"]) {
    assert.ok(!cloudStatusBlock.includes(foreign), `the cloud status path must not reference ${foreign}`);
  }
  // And the transport default is still whatever it was; nothing here flips it.
  assert.ok(!cloudStatusBlock.includes("WHATSAPP_GATEWAY_PROVIDER"));
});

test("a reply leaves from the number the customer wrote to, not the global default", () => {
  /*
   * The live failure this exists to prevent: a customer wrote to the Cloud number, the reply was
   * routed by WHATSAPP_PROVIDER (still "evolution", correctly, because the automations have not
   * moved yet), and the employee got "Connection Closed" from a dead session on a conversation
   * that had just arrived perfectly well.
   */
  const adapter = read("../server/services/aiChannelAdapterService.js");
  assert.match(adapter, /const instanceIsCloud = selectedInstance\.toLowerCase\(\)\.startsWith\("cloud:"\)/);
  assert.match(adapter, /const selectedTransport = instanceIsCloud \|\| config\.provider === "cloud" \? "cloud" : "evolution"/);
  // The number to send from travels with the instance, so two Cloud numbers stay distinct.
  assert.match(adapter, /if \(instanceIsCloud\) config\.phoneNumberId = selectedInstance\.slice\("cloud:"\.length\)/);

  // Inbound has to stamp which number it arrived on, or there is nothing to route by.
  assert.match(inboxRouteSource, /whatsappInstance: metadata\?\.phone_number_id \? `cloud:\$\{metadata\.phone_number_id\}` : ""/);

  // And the send route must consult it, with the message-row fallback for threads that predate it.
  assert.match(inboxSendHandler, /conversation\?\.channel_metadata\?\.whatsapp_instance \|\| conversation\?\.channel_metadata\?\.instance/);
  assert.match(inboxSendHandler, /resolveWhatsappConversationInstance\(\{ tenantId, conversationId \}\)/);
});

test("an empty instance still means the environment default, so automations do not move", () => {
  // Every order confirmation, receipt and shipping notice passes no instance. They must keep
  // going out over Evolution until the templates are approved.
  const adapter = read("../server/services/aiChannelAdapterService.js");
  assert.ok(!adapter.includes(`const selectedTransport = "cloud"`), "the transport must never be hardcoded");
  assert.match(adapter, /config\.provider === "cloud" \? "cloud" : "evolution"/);
});

test("the conversation itself follows the number the customer last used", () => {
  /*
   * Stamping the message row alone was not enough, and the live test proved it: a thread that had
   * ever been served by Evolution carried "m1_business_v237" on the CONVERSATION, the reply path
   * reads the conversation first, and so a customer who had just written to the Cloud number was
   * still answered on the dead one. Four replies failed that way before this.
   */
  const mapping = inboxRouteSource.slice(
    inboxRouteSource.indexOf("await upsertChannelConversationMapping({"),
    inboxRouteSource.indexOf("[ai-agent:whatsapp] mapping upsert skipped")
  );
  assert.match(mapping, /whatsapp_instance: metadata\.phone_number_id \? `cloud:\$\{metadata\.phone_number_id\}` : ""/);
  // The upsert merges with the incoming value winning, which is what lets the thread move across
  // — and move back if the customer writes to the Evolution number again.
  const adapter = read("../server/services/aiChannelAdapterService.js");
  assert.match(adapter, /metadata = ai_channel_conversations\.metadata \|\| EXCLUDED\.metadata/);
});
