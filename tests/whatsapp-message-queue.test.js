/*
 * The WhatsApp outbound queue: its configuration surface, its wiring, and the rules that decide
 * what a message says and how long it stays worth sending.
 *
 * The behavioural half of this — the 24h-outage reconnect, expiry, pacing, retry, locking — lives
 * in whatsapp-queue-reconnect-scenario.db.test.js, which runs against a real database because
 * those guarantees are enforced in SQL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  WHATSAPP_AUTOMATION_EXPIRY_DEFAULTS,
  WHATSAPP_AUTOMATION_TYPES,
  WHATSAPP_QUEUE_CATEGORY_DEFAULTS,
  WHATSAPP_QUEUE_DEFAULTS,
  WHATSAPP_QUEUE_STATUSES,
  normalizeWhatsappAutomationExpiry,
  normalizeWhatsappMessageVariants,
  normalizeWhatsappQueueCategories,
  normalizeWhatsappQueueConfig,
  renderWhatsappTemplate,
  whatsappAutomationCategory,
} from "../shared/whatsappQueueDefaults.js";
import { getSettingDefinition } from "../shared/settingsRegistry.js";
import { pickVariant } from "../server/services/whatsappQueue/variants.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const invoiceService = read("../server/services/whatsappOrderConfirmationService.js");
const shippingService = read("../server/services/whatsappShippingService.js");
const cartService = read("../server/services/abandonedCartReminderService.js");
const queueService = read("../server/services/whatsappQueue/queueService.js");
const worker = read("../server/services/whatsappQueue/worker.js");
const queueIndex = read("../server/services/whatsappQueue/index.js");
const server = read("../server/server.js");
const migration = read("../server/database/migrations/2026-08-30-add-whatsapp-message-queue.sql");
const schema = read("../server/services/whatsappQueue/schema.js");

test("the queue carries every state the lifecycle needs", () => {
  assert.deepEqual(WHATSAPP_QUEUE_STATUSES, ["pending", "scheduled", "sending", "sent", "failed", "expired", "cancelled"]);
  // The database must agree, or a transition the code makes would be rejected at write time.
  for (const status of WHATSAPP_QUEUE_STATUSES) {
    assert.match(migration, new RegExp(`'${status}'`), `${status} is allowed by the table's CHECK constraint`);
    assert.match(schema, new RegExp(`'${status}'`), `${status} is allowed by the ensure-schema DDL`);
  }
});

test("transactional and engagement messages answer to different rulebooks", () => {
  assert.equal(whatsappAutomationCategory("order_confirmation"), "transactional");
  assert.equal(whatsappAutomationCategory("shipped"), "transactional");
  assert.equal(whatsappAutomationCategory("delivered"), "transactional");
  // The three from the incident.
  assert.equal(whatsappAutomationCategory("invoice_receipt"), "engagement");
  assert.equal(whatsappAutomationCategory("google_review_request"), "engagement");
  assert.equal(whatsappAutomationCategory("thank_you"), "engagement");
  // An unknown type is treated as engagement — the stricter of the two.
  assert.equal(whatsappAutomationCategory("something_new"), "engagement");

  const transactional = WHATSAPP_QUEUE_CATEGORY_DEFAULTS.transactional;
  const engagement = WHATSAPP_QUEUE_CATEGORY_DEFAULTS.engagement;
  assert.ok(engagement.expiry_minutes < transactional.expiry_minutes, "a nudge goes stale long before a receipt does");
  assert.ok(engagement.max_retries < transactional.max_retries, "and it is retried less hard");
});

test("the messages that caused the incident expire in hours, not days", () => {
  const expiry = normalizeWhatsappAutomationExpiry(undefined);
  assert.equal(expiry.invoice_receipt, 180);
  assert.equal(expiry.google_review_request, 120);
  assert.equal(expiry.thank_you, 120);
  for (const type of ["invoice_receipt", "google_review_request", "thank_you"]) {
    assert.ok(
      WHATSAPP_AUTOMATION_EXPIRY_DEFAULTS[type] < 24 * 60,
      `${type} must not survive a day-long outage`
    );
  }
});

test("0 means 'no override', not 'expire immediately'", () => {
  const expiry = normalizeWhatsappAutomationExpiry({ invoice_receipt: 0 });
  assert.equal(expiry.invoice_receipt, 0, "stored as 0 so rulesForAutomation falls back to the category");
  // Every known automation type is represented, so the settings editor can never miss one.
  assert.deepEqual(Object.keys(expiry).sort(), Object.keys(WHATSAPP_AUTOMATION_TYPES).sort());
});

test("nonsense pacing values are clamped rather than obeyed", () => {
  const config = normalizeWhatsappQueueConfig({
    messages_per_minute: 99999,
    min_delay_seconds: -5,
    max_delay_seconds: 2,
    batch_size: 0,
  });
  assert.equal(config.messages_per_minute, 600, "capped");
  assert.equal(config.min_delay_seconds, 0, "a negative delay becomes none");
  assert.equal(config.max_delay_seconds, 2, "still above the clamped min, so it stands");
  assert.equal(config.batch_size, 1, "a batch of zero would drain nothing forever");

  // An inverted range would make the random gap between messages NaN, and every wait would
  // collapse to zero — the burst this queue exists to prevent, arriving through the back door.
  const inverted = normalizeWhatsappQueueConfig({ min_delay_seconds: 9, max_delay_seconds: 2 });
  assert.equal(inverted.min_delay_seconds, 9);
  assert.equal(inverted.max_delay_seconds, 9, "the max is raised to the min, never left inverted");

  const empty = normalizeWhatsappQueueConfig(undefined);
  assert.deepEqual(empty, { ...WHATSAPP_QUEUE_DEFAULTS });
});

test("every pacing and safety number is configurable, none hardcoded in the worker", () => {
  for (const key of [
    "messages_per_minute",
    "min_delay_seconds",
    "max_delay_seconds",
    "batch_size",
    "offline_pause_minutes",
    "pending_pause_threshold",
    "failure_pause_threshold",
    "failure_window_minutes",
  ]) {
    assert.ok(key in WHATSAPP_QUEUE_DEFAULTS, `${key} has a default`);
    assert.match(worker, new RegExp(`config\\.${key}|settings\\.queue\\.${key}`), `${key} is read from settings by the worker`);
  }
  // The pacing must never be a literal in the worker: the whole point is that the operator owns
  // these numbers. A bare `= 30` next to one of these names would mean it does not.
  assert.doesNotMatch(worker, /messages_per_minute\s*[=:]\s*\d/, "no hardcoded rate");
  assert.doesNotMatch(worker, /batch_size\s*[=:]\s*\d/, "no hardcoded batch size");
});

test("all four settings keys are registered, so the settings screen can reach them", () => {
  for (const key of ["whatsapp.queue", "whatsapp.queue_categories", "whatsapp.automation_expiry", "whatsapp.message_variants"]) {
    const definition = getSettingDefinition(key);
    assert.ok(definition, `${key} is in the registry`);
    assert.equal(definition.type, "json");
    assert.equal(definition.category, "ai_channels");
    assert.ok(definition.description?.ar, "and carries an Arabic description");
  }
});

test("variants render the placeholders the system already uses", () => {
  const values = {
    customer_name: "ماجد",
    invoice_number: "INV-412",
    invoice_url: "https://m1store-egy.com/i/412",
    order_number: "M1-9001",
    google_review_url: "https://g.page/r/x",
  };
  const rendered = renderWhatsappTemplate(
    "أهلاً {{customer_name}}\nفاتورة {{invoice_number}}: {{invoice_url}}\nطلب {order_number}\nقيّمنا: {{google_review_url}}",
    values
  );
  assert.match(rendered, /أهلاً ماجد/);
  assert.match(rendered, /INV-412/);
  assert.match(rendered, /m1store-egy\.com\/i\/412/);
  assert.match(rendered, /M1-9001/, "the single-brace form already in production still renders");
  assert.match(rendered, /g\.page\/r\/x/);
  assert.doesNotMatch(rendered, /\{\{|\}\}/, "no placeholder reaches a customer unfilled");
});

test("a line whose value is missing is dropped whole, label included", () => {
  const rendered = renderWhatsappTemplate("شكراً {{customer_name}}\nرابط الفاتورة: {{invoice_url}}\nنتمنى لك يوماً سعيداً", { customer_name: "ماجد" });
  assert.match(rendered, /شكراً ماجد/);
  assert.doesNotMatch(rendered, /رابط الفاتورة/, "a bare label with nothing after it is worse than no line");
  assert.match(rendered, /نتمنى لك يوماً سعيداً/);
});

test("round robin walks the enabled variants and wraps", () => {
  const variants = [
    { id: "a", enabled: true, body: "A" },
    { id: "b", enabled: true, body: "B" },
    { id: "c", enabled: true, body: "C" },
  ];
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((position) => pickVariant(variants, position).id), ["a", "b", "c", "a", "b", "c"]);
  assert.equal(pickVariant([], 0), null, "no variants means no choice, and the caller keeps its own text");
  assert.equal(pickVariant([{ id: "a", enabled: false, body: "A" }], 0), null, "a list of disabled variants is an empty list");
  assert.equal(pickVariant(variants, -1).id, "c", "a negative position wraps forward, never off the end");
});

test("variant ids are stable, so a retry cannot land on a different wording", () => {
  const normalized = normalizeWhatsappMessageVariants({
    invoice_receipt: [
      { label: "First", body: "one" },
      { label: "Second", body: "two" },
    ],
  });
  assert.deepEqual(normalized.invoice_receipt.map((variant) => variant.id), ["invoice_receipt-a", "invoice_receipt-b"]);

  // Two variants given the same id must not collapse into one — the second is disambiguated.
  const collided = normalizeWhatsappMessageVariants({ invoice_receipt: [{ id: "x", body: "one" }, { id: "x", body: "two" }] });
  assert.equal(new Set(collided.invoice_receipt.map((variant) => variant.id)).size, 2);
});

test("an empty variant body is dropped rather than sent as a blank message", () => {
  const normalized = normalizeWhatsappMessageVariants({ invoice_receipt: [{ id: "a", body: "   " }, { id: "b", body: "real" }] });
  assert.equal(normalized.invoice_receipt.length, 1);
  assert.equal(normalized.invoice_receipt[0].id, "b");
});

test("no variants configured is the shipping default, so nothing changes until someone opts in", () => {
  assert.deepEqual(normalizeWhatsappMessageVariants(undefined), {});
  const definition = getSettingDefinition("whatsapp.message_variants");
  assert.deepEqual(definition.defaultValue, {});
});

test("category rules survive a partial or corrupt stored value", () => {
  const normalized = normalizeWhatsappQueueCategories({ transactional: { expiry_minutes: "nonsense" }, junk: true });
  assert.equal(normalized.transactional.expiry_minutes, WHATSAPP_QUEUE_CATEGORY_DEFAULTS.transactional.expiry_minutes);
  assert.ok(normalized.engagement, "a missing category falls back to its defaults rather than vanishing");
  assert.deepEqual(Object.keys(normalized).sort(), ["engagement", "transactional"]);
});

test("the invoice receipt — the message from the incident — goes through the queue", () => {
  const fn = invoiceService.slice(invoiceService.indexOf("export const sendInvoiceWhatsapp"));
  assert.match(fn, /queueWhatsappAutomation\(/, "the automatic path enqueues");
  assert.match(fn, /automationType: "invoice_receipt"/);
  assert.match(fn, /order_column: "whatsapp_invoice_sent_at"/, "the once-only stamp moves to actual delivery");
  // The enqueue must come BEFORE the direct send, or the direct send would fire regardless.
  assert.ok(
    fn.indexOf("queueWhatsappAutomation(") < fn.indexOf("result = await sendCtaUrlMessage("),
    "the queue is in front of the gateway, not behind it"
  );
  // A human pressing resend, with the outcome on their screen, still goes direct.
  assert.match(fn, /if \(!isManualResend\) \{/);
});

test("shipment notifications and the abandoned cart go through it too", () => {
  assert.match(shippingService, /queueWhatsappAutomation\(/);
  assert.match(shippingService, /automationType: type/, "all four shipment states use the same path");
  assert.match(cartService, /queueWhatsappAutomation\(/);
  assert.match(cartService, /automationType: "abandoned_cart"/);
  assert.match(cartService, /kind: "carousel"/, "the carousel keeps its cards through the queue");
});

test("a queued send never also fires the direct send", () => {
  for (const [name, source] of [["invoice", invoiceService], ["shipping", shippingService], ["cart", cartService]]) {
    assert.match(
      source,
      /if \(queued\.queued \|\| queued\.duplicate\) \{[\s\S]{0,400}?(return|continue)/,
      `${name} returns as soon as the message is queued`
    );
  }
});

test("turning the queue off restores the previous behaviour exactly", () => {
  assert.match(queueIndex, /if \(!settings\?\.queue\?\.enabled\)/);
  assert.match(queueIndex, /return \{ queued: false, direct: true, result: await directSend\(\) \}/);
  // And every caller still holds its original direct-send code, which is what `enabled: false`
  // falls back to — deleting it would make the switch a one-way door.
  assert.match(invoiceService, /result = await sendCtaUrlMessage\(/);
  assert.match(shippingService, /result = await sendTextMessage\(\{ phone, message \}\)/);
  assert.match(cartService, /await sendCartCarouselMessage\(\{ phone: row\.customer_phone/);
});

test("a retry updates the row it already has and never inserts another", () => {
  const markFailed = queueService.slice(queueService.indexOf("export const markFailed"), queueService.indexOf("/* Release a claim"));
  assert.match(markFailed, /UPDATE whatsapp_message_queue/);
  assert.doesNotMatch(markFailed, /INSERT INTO/, "a failure must never create a second message");
  for (const column of ["retry_count", "last_retry_at", "last_error", "next_retry_at"]) {
    assert.match(markFailed, new RegExp(column), `${column} is recorded on the same row`);
  }
  assert.doesNotMatch(markFailed, /message_variant_id|rendered_body/, "the variant and the text are never rewritten by a retry");

  const retryFailed = queueService.slice(queueService.indexOf("export const retryFailed"));
  assert.doesNotMatch(retryFailed.slice(0, retryFailed.indexOf("export const queueCounts")), /INSERT INTO/);
});

test("the idempotency key pins one message to one event, one customer, one automation", () => {
  assert.match(queueService, /CONSTRAINT whatsapp_message_queue_idempotency_unique|ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(migration, /whatsapp_message_queue_idempotency_unique UNIQUE \(idempotency_key\)/);
  const builder = queueService.slice(queueService.indexOf("export const buildIdempotencyKey"), queueService.indexOf("export const queueRuntimeRow"));
  assert.match(builder, /order:\$\{orderId\}/);
  assert.match(builder, /customer:\$\{customerId\}/);
  assert.match(builder, /text\(automationType\)/);
});

test("every queue item records what the operator will need to explain it", () => {
  for (const column of [
    "automation_type", "message_variant_id", "customer_id", "order_id", "invoice_number",
    "created_at", "scheduled_at", "sent_at", "expired_at", "status", "retry_count",
    "idempotency_key", "last_error", "error_code", "last_retry_at", "next_retry_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`), `${column} is stored`);
    assert.match(schema, new RegExp(`\\b${column}\\b`), `${column} is in the ensure-schema DDL`);
  }
});

test("the lifecycle is logged at every hop", () => {
  for (const event of ["created", "queued", "sending", "sent", "expired", "cancelled"]) {
    assert.match(queueService, new RegExp(`logLifecycle\\("${event}"`), `${event} is logged`);
  }
  assert.match(queueService, /logLifecycle\(row\.status === "failed" \? "failed" : "retrying"/, "failed and retrying are logged distinctly");
});

test("the worker is started by the server and can be switched off from settings", () => {
  assert.match(server, /startWhatsappQueueWorker\(/);
  assert.match(server, /whatsappQueueRoutes/);
  assert.match(server, /app\.use\("\/api\/whatsapp\/queue", whatsappQueueRoutes\)/);
  // Mounted before the broader /api/whatsapp router, or Express would never reach it.
  assert.ok(
    server.indexOf('app.use("/api/whatsapp/queue"') < server.indexOf('app.use("/api/whatsapp", whatsappGatewayRoutes)'),
    "the queue router is matched before the gateway router"
  );
  assert.match(worker, /if \(!settings\.queue\.enabled\) return \{ skipped: true, reason: "queue_disabled" \}/);
});

test("expiry runs before the connection gate, so stale messages die during the outage", () => {
  const tick = worker.slice(worker.indexOf("export const runWhatsappQueueTick"));
  const expireIndex = tick.indexOf("await expireStaleMessages(");
  const connectionIndex = tick.indexOf("resolvedGateway.getStatus()");
  const claimIndex = tick.indexOf("await claimReadyMessages(");
  assert.ok(expireIndex > -1 && connectionIndex > -1 && claimIndex > -1);
  assert.ok(expireIndex < connectionIndex, "expiry does not wait for the session to come back");
  assert.ok(expireIndex < claimIndex, "and nothing stale is ever a candidate to claim");
});

test("only known order columns can be stamped from a queue payload", () => {
  assert.match(worker, /const SENT_AT_COLUMNS = new Set\(\[/);
  assert.match(worker, /if \(!SENT_AT_COLUMNS\.has\(column\)\)/, "an unknown column is refused, not interpolated");
});

/* ---- the dashboard's display decisions, tested without a browser ---- */

const { queueViewModel, relativeAge } = await import("../src/modules/aiSupport/components/integrations/whatsappQueueView.js");

test("the dashboard reads a paused-for-review queue correctly", () => {
  const view = queueViewModel({
    connection: { connected: false },
    queue: { state: "paused_for_review", pause_reason: "long_offline" },
    counts: { pending: 100, scheduled: 0, expired: 400, sent: 12, failed: 3 },
    settings: { queue: { pending_pause_threshold: 50 } },
    resume_preview: { pending: 500, stale: 400 },
  });
  assert.equal(view.connected, false);
  assert.equal(view.paused, true);
  assert.equal(view.forReview, true, "the operator must be told this one needs a decision");
  assert.equal(view.pauseReason, "long_offline");
  assert.equal(view.backlog, 100);
  assert.equal(view.backlogOverThreshold, true);
  assert.equal(view.stats.find((stat) => stat.status === "expired").value, 400);
  assert.equal(view.preview.stale, 400);
});

test("a manual pause is not surfaced as something to review", () => {
  const view = queueViewModel({ queue: { state: "paused" }, counts: {}, settings: { queue: {} } });
  assert.equal(view.paused, true);
  assert.equal(view.forReview, false, "an operator who paused it themselves needs no alarm");
});

test("a threshold of 0 reads as 'switched off', never as 'exceeded'", () => {
  const view = queueViewModel({ counts: { pending: 9999 }, settings: { queue: { pending_pause_threshold: 0 } } });
  assert.equal(view.thresholdDisabled, true);
  assert.equal(view.backlogOverThreshold, false, "0 disables the brake — a huge backlog is then the operator's choice");
});

test("an empty or broken dashboard response still renders something sane", () => {
  for (const input of [undefined, null, {}, "nonsense"]) {
    const view = queueViewModel(input);
    assert.equal(view.state, "running");
    assert.equal(view.backlog, 0);
    assert.equal(view.stats.length, 7, "every status still has a tile");
    assert.equal(view.paused, true, "an unknown state is treated as not-running rather than draining");
  }
});

test("message age is reported in the unit that reads naturally", () => {
  const t = (key, options) => `${key}:${options?.count}`;
  const now = Date.parse("2026-08-30T12:00:00Z");
  assert.equal(relativeAge(null, t, now), "—");
  assert.equal(relativeAge("not a date", t, now), "—");
  assert.match(relativeAge("2026-08-30T11:30:00Z", t, now), /ageMinutes:30/);
  assert.match(relativeAge("2026-08-30T06:00:00Z", t, now), /ageHours:6/);
  assert.match(relativeAge("2026-08-27T12:00:00Z", t, now), /ageDays:3/);
});

/* ---- the September gap: the automations that were still bypassing the queue ---- */

const couponsService = read("../server/services/couponsService.js");
const restockService = read("../server/services/restockNotificationService.js");
const connectionGate = read("../server/services/whatsappQueue/connectionGate.js");

test("order confirmation and payment review go through the queue too", () => {
  const confirmation = invoiceService.slice(
    invoiceService.indexOf("export const sendOrderConfirmation"),
    invoiceService.indexOf("export const sendPaymentReviewNotification")
  );
  assert.match(confirmation, /automationType: "order_confirmation"/);
  assert.match(confirmation, /kind: "order_confirmation_buttons"/, "the reply buttons survive the move");
  assert.match(confirmation, /order_column: "whatsapp_confirmation_sent_at"/);
  assert.ok(
    confirmation.indexOf("queueWhatsappAutomation(") < confirmation.indexOf("sendOrderConfirmationInteractiveMessage({"),
    "the queue is in front of the gateway"
  );

  const review = invoiceService.slice(invoiceService.indexOf("export const sendPaymentReviewNotification"));
  assert.match(review, /automationType: "payment_review"/);
  assert.match(review, /order_column: "whatsapp_payment_review_sent_at"/);
});

test("both are transactional, so they get the long expiry and the full retry budget", () => {
  // A customer is waiting on these; arriving late still beats never arriving.
  assert.equal(whatsappAutomationCategory("order_confirmation"), "transactional");
  assert.equal(whatsappAutomationCategory("payment_review"), "transactional");
});

test("every column an automation stamps is on the worker's allowlist", () => {
  // A column missing here is refused at send time and the once-only guard silently never sets,
  // which would let the same message go out again on the next trigger.
  for (const column of [
    "whatsapp_invoice_sent_at",
    "whatsapp_confirmation_sent_at",
    "whatsapp_payment_review_sent_at",
    "whatsapp_shipment_created_sent_at",
    "whatsapp_delivered_sent_at",
  ]) {
    assert.match(worker, new RegExp(`"${column}"`), `${column} is allowlisted`);
  }
  // Whatever a caller asks to stamp must be one of those, not whatever the payload says.
  assert.match(worker, /if \(!SENT_AT_COLUMNS\.has\(column\)\)/);
});

test("the sends that stay synchronous refuse to hand a message to a dead socket", () => {
  /*
   * A coupon hand-off and an approved restock notification report their result to the person who
   * triggered them, so queueing them would replace a real answer with "we will try later". What
   * they must not do is POST into a closed socket, where the message vanishes into Evolution's own
   * buffer — unseen, unpaceable, and delivered days later in a burst.
   */
  assert.match(couponsService, /assertWhatsappReachable\(/, "coupons ask first");
  assert.match(restockService, /assertWhatsappReachable\(/, "restock notifications ask first");
  for (const [name, source, sendCall] of [
    ["coupons", couponsService, "const result = await sendTextMessage({ phone, message: text });"],
    ["restock", restockService, "const { sendTextMessage, sendImageMessage } = await import"],
  ]) {
    assert.ok(
      source.indexOf("assertWhatsappReachable(") < source.indexOf(sendCall),
      `${name} checks before it sends, not after`
    );
  }
});

test("the gate is a guard, not an authority: silence means carry on", () => {
  // A gate that failed closed would stop every coupon on a database hiccup, which is a worse
  // outage than the one it is guarding against.
  assert.match(connectionGate, /if \(!state\.known \|\| state\.connected !== false\) return state/);
  assert.match(connectionGate, /reason: "lookup_failed"/, "a failed lookup reads as unknown, not as offline");
  assert.match(connectionGate, /reason: "observation_stale"/, "and so does a stale one");
  assert.match(connectionGate, /OBSERVATION_MAX_AGE_MS/, "an old reading is not evidence");
});

test("a dead session is announced on its own, not only through the backlog", async () => {
  const { alertIfOfflineTooLong } = await import("../server/services/whatsappQueue/worker.js");
  const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

  // Every one of these must return false WITHOUT touching the database.
  assert.equal(
    await alertIfOfflineTooLong({ thresholdMinutes: 0, runtime: { last_disconnected_at: longAgo } }),
    false,
    "0 disables the alert — the operator's call"
  );
  assert.equal(
    await alertIfOfflineTooLong({ thresholdMinutes: 20, runtime: { last_disconnected_at: longAgo, offline_alerted_at: new Date().toISOString() } }),
    false,
    "once per outage, not once per tick"
  );
  assert.equal(
    await alertIfOfflineTooLong({ thresholdMinutes: 20, runtime: {} }),
    false,
    "no recorded drop yet — one tick is not an outage"
  );
  assert.equal(
    await alertIfOfflineTooLong({ thresholdMinutes: 20, runtime: { last_disconnected_at: new Date(Date.now() - 60_000).toISOString() } }),
    false,
    "a one-minute blip is not worth waking anyone for"
  );
});

test("the alert watches the clock, because the backlog is a broken smoke alarm", () => {
  const fn = worker.slice(worker.indexOf("export const alertIfOfflineTooLong"), worker.indexOf("export const clearOfflineAlert"));
  // The September outage: 3 days down, pending never passed 16, nothing fired.
  assert.doesNotMatch(fn, /pendingCount\s*[<>]=?/, "the decision must not depend on how much is waiting");
  assert.match(fn, /offlineMinutes < threshold/, "it depends on how long the channel has been dead");
  assert.match(fn, /offline_alerted_at = NOW\(\)/, "and latches so it fires once");
  // The latch must be cleared on reconnect or the next outage passes in silence.
  assert.match(worker, /if \(runtime\?\.offline_alerted_at\) await clearOfflineAlert\(tenantId\)/);
  assert.match(worker, /offline_alerted_at = NULL/);
});

test("the offline alert threshold is a setting, with a default that is not zero", () => {
  assert.equal(typeof WHATSAPP_QUEUE_DEFAULTS.offline_alert_minutes, "number");
  assert.ok(WHATSAPP_QUEUE_DEFAULTS.offline_alert_minutes > 0, "it ships armed");
  assert.equal(normalizeWhatsappQueueConfig({ offline_alert_minutes: 0 }).offline_alert_minutes, 0, "0 stays 0 — that is how it is switched off");
  assert.equal(normalizeWhatsappQueueConfig({ offline_alert_minutes: -5 }).offline_alert_minutes, 0);
  assert.equal(normalizeWhatsappQueueConfig(undefined).offline_alert_minutes, WHATSAPP_QUEUE_DEFAULTS.offline_alert_minutes);
});
