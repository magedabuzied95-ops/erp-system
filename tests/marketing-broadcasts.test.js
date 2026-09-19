import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { isMarketingStopMessage, MARKETING_STOP_WORDS } from "../server/services/marketingConsentService.js";
import { broadcastsEnabled, resolveSendWindow } from "../server/services/marketingBroadcastService.js";
import { WHATSAPP_AUTOMATION_TYPES } from "../shared/whatsappQueueDefaults.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const broadcastService = read("server/services/marketingBroadcastService.js");
const consentService = read("server/services/marketingConsentService.js");
const routes = read("server/routes/marketingBroadcasts.js");
const gateway = read("server/services/whatsappGatewayService.js");

test("a bare stop word opts the customer out", () => {
  ["إلغاء", "الغاء", "stop", "STOP", "Unsubscribe", "توقف", "متبعتليش"].forEach((word) => {
    assert.equal(isMarketingStopMessage(word), true, `${word} should stop marketing`);
  });
  assert.ok(MARKETING_STOP_WORDS.length >= 8);
});

test("a stop word INSIDE a sentence does not opt anyone out", () => {
  // This is the lesson from "مش مشكلة" cancelling a live order: a signal matched anywhere in a
  // sentence acts on messages that never meant it. "إلغاء الطلب" is an order cancellation.
  [
    "إلغاء الطلب من فضلك",
    "عايز الغاء الاوردر",
    "ممكن توقف الشحن لحد بكرة",
    "stop by the store tomorrow",
    "مش عايز اللون ده",
  ].forEach((message) => {
    assert.equal(isMarketingStopMessage(message), false, `"${message}" must not opt out`);
  });
});

test("stop-word matching survives Arabic spelling variants", () => {
  assert.equal(isMarketingStopMessage("إلغاء"), true);
  assert.equal(isMarketingStopMessage("الغاء"), true);
  assert.equal(isMarketingStopMessage("  إلغاء  "), true);
  assert.equal(isMarketingStopMessage("إلغاء!"), true);
  assert.equal(isMarketingStopMessage(""), false);
  assert.equal(isMarketingStopMessage(null), false);
});

test("the opt-out is read on every inbound WhatsApp message, without blocking the reply", () => {
  assert.match(gateway, /handleInboundMarketingStopWord/);
  // Fired, not awaited: consent bookkeeping must never delay or fail the customer's answer.
  assert.match(gateway, /void handleInboundMarketingStopWord\(\{/);
});

test("broadcasts ship switched off", () => {
  const previous = process.env.MARKETING_BROADCASTS_ENABLED;
  delete process.env.MARKETING_BROADCASTS_ENABLED;
  assert.equal(broadcastsEnabled(), false);
  process.env.MARKETING_BROADCASTS_ENABLED = "true";
  assert.equal(broadcastsEnabled(), true);
  if (previous === undefined) delete process.env.MARKETING_BROADCASTS_ENABLED;
  else process.env.MARKETING_BROADCASTS_ENABLED = previous;
});

test("sending is refused while the flag is off, before any customer is touched", () => {
  assert.match(broadcastService, /if \(!broadcastsEnabled\(\)\) \{/);
  assert.match(broadcastService, /code: "BROADCASTS_DISABLED"/);
  // The refusal is the first thing in sendBroadcast, ahead of the audience query.
  const send = broadcastService.slice(broadcastService.indexOf("export const sendBroadcast"));
  assert.ok(
    send.indexOf("broadcastsEnabled()") < send.indexOf("buildAudienceQuery"),
    "the flag must be checked before the audience is built"
  );
});

test("quiet hours push a campaign to the morning instead of sending at night", () => {
  // 02:00 Cairo is midnight UTC in winter; both sides of the window are checked below.
  const night = resolveSendWindow(new Date("2026-01-15T00:00:00Z"));
  assert.equal(night.deferred, true);
  assert.ok(night.scheduledAt instanceof Date);
  assert.ok(night.scheduledAt.getTime() > new Date("2026-01-15T00:00:00Z").getTime());

  const midday = resolveSendWindow(new Date("2026-01-15T10:00:00Z"));
  assert.equal(midday.deferred, false);
  assert.equal(midday.scheduledAt, null);
});

test("the opt-out and the frequency cap are not optional filters", () => {
  const builder = broadcastService.slice(
    broadcastService.indexOf("const buildAudienceQuery"),
    broadcastService.indexOf("export const previewBroadcastAudience")
  );
  // Both sit in the base condition list, not behind an `if` on caller input.
  assert.match(builder, /const conditions = \[[^\]]*c\.marketing_opt_out_at IS NULL/s);
  assert.match(builder, /marketing_last_sent_at IS NULL OR c\.marketing_last_sent_at </);
  assert.doesNotMatch(builder, /if \([^)]*\)\s*conditions\.push\(`\(c\.marketing_last_sent_at/);
});

test("a broadcast rides the existing WhatsApp queue rather than sending directly", () => {
  assert.match(broadcastService, /queueWhatsappAutomation\(\{/);
  assert.doesNotMatch(broadcastService, /sendTextMessage|sendWhatsappTemplate/);
  assert.equal(WHATSAPP_AUTOMATION_TYPES.marketing_broadcast, "engagement");
  // Every other automation passes a directSend fallback so a queue outage cannot cost a customer
  // their receipt. A broadcast must NOT have one: unpaced, it is the burst the pacer exists to stop.
  const call = broadcastService.slice(
    broadcastService.indexOf("await queueWhatsappAutomation({"),
    broadcastService.indexOf("if (!result?.queued)")
  );
  assert.doesNotMatch(call, /directSend/);
});

test("a recipient the queue refused is counted as skipped, not as sent", () => {
  // queueWhatsappAutomation RETURNS `{ queued: false }` when it cannot queue — it does not throw.
  // A try/catch alone would have reported every one of those as delivered.
  assert.match(broadcastService, /if \(!result\?\.queued\) \{/);
  assert.match(broadcastService, /skip_reason/);
  assert.match(broadcastService, /text\(result\?\.reason/);
});

test("the frequency cap is stamped at queue time, not at delivery", () => {
  // Two campaigns started a minute apart must not both see the same customer as untouched.
  assert.match(broadcastService, /UPDATE customers SET marketing_last_sent_at = NOW\(\)/);
});

test("stopping a campaign cancels only what has not gone out", () => {
  const stop = broadcastService.slice(broadcastService.indexOf("export const stopBroadcast"));
  assert.match(stop, /status IN \('pending', 'scheduled'\)/);
  assert.match(stop, /status = 'cancelled'/);
});

test("reading an audience is view, sending is edit", () => {
  assert.match(routes, /router\.post\("\/audience\/preview", protect, permit\("settings", "view"\)/);
  assert.match(routes, /router\.post\("\/", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.post\("\/:id\/send", protect, permit\("settings", "edit"\)/);
  assert.match(routes, /router\.post\("\/:id\/stop", protect, permit\("settings", "edit"\)/);
});

test("consent columns are added by an ensure, never assumed", () => {
  assert.match(consentService, /ADD COLUMN IF NOT EXISTS marketing_opt_out_at/);
  assert.match(consentService, /ADD COLUMN IF NOT EXISTS marketing_opt_out_source/);
  assert.match(consentService, /ADD COLUMN IF NOT EXISTS marketing_last_sent_at/);
});

test("an opt-out never un-sets itself on a second stop word", () => {
  // COALESCE keeps the FIRST opt-out time; re-sending "stop" must not look like a fresh consent.
  assert.match(consentService, /marketing_opt_out_at = COALESCE\(marketing_opt_out_at, NOW\(\)\)/);
});
