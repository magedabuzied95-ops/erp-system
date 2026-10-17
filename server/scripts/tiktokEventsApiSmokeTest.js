/*
 * Sends one PlaceAnOrder and one Purchase for a made-up order to TikTok's Events API
 * with test_event_code, so they appear under Events Manager → Test Events and never
 * count toward the pixel's real conversions.
 *
 *   TIKTOK_EVENTS_ACCESS_TOKEN=... TIKTOK_EVENTS_TEST_EVENT_CODE=TEST12345 \
 *   TIKTOK_EVENTS_TEST_UNTIL=2026-10-18T12:00:00Z node server/scripts/tiktokEventsApiSmokeTest.js
 *
 * Refuses to run without an active test code (TEST_UNTIL at most 24h ahead). Prints TikTok's answer, never the token.
 */
import crypto from "node:crypto";
import {
  buildTikTokOrderEvent,
  buildTrackRequestBody,
  postTikTokEvent,
  tiktokEventsConfig,
  tiktokHashedEmail,
  tiktokHashedPhone,
} from "../modules/tiktok/tiktokEventsApi.js";

const config = tiktokEventsConfig();
if (!config.accessToken) {
  console.error("TIKTOK_EVENTS_ACCESS_TOKEN is not set.");
  process.exit(1);
}
if (!config.testEventCode) {
  console.error("No active test code (TIKTOK_EVENTS_TEST_EVENT_CODE + TIKTOK_EVENTS_TEST_UNTIL within 24h): refusing to send a live event.");
  process.exit(1);
}

const order = { id: `smoke${Date.now()}`, status: "pending", payment_status: "paid", paid_amount: 1550, total_amount: 1550 };
const items = [{ meta_content_id: "SMOKE-TEST-SKU", product_name: "Smoke test item", price: 1500, quantity: 1 }];
const user = {
  email: tiktokHashedEmail("smoke-test@example.com"),
  phone: tiktokHashedPhone("01000000000"),
  external_id: crypto.createHash("sha256").update("smoke-test").digest("hex"),
  ip: "203.0.113.10",
  user_agent: "M1 Events API smoke test",
};

let failed = false;
for (const eventName of ["PlaceAnOrder", "Purchase"]) {
  const event = buildTikTokOrderEvent({ eventName, order, items, user, page: { url: "https://m1store-egy.com/checkout" } });
  const result = await postTikTokEvent(buildTrackRequestBody(event, config), { config });
  console.log(eventName, event.event_id, result.ok ? `OK (request ${result.requestId})` : `FAILED ${result.error}`);
  if (!result.ok) failed = true;
}
process.exit(failed ? 1 : 0);
