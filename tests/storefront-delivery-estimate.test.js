import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDeliveryEstimate,
  deliveryEstimateSentence,
  describeDeliveryEstimate,
  formatCutoffCountdown,
  normalizeCutoffTime,
  normalizeDaysOff,
  resolveZoneTransitDays,
} from "../src/shared/lib/deliveryEstimate.js";

// 2026-09-13 is a Sunday; Friday (5) is the default day off.
const clock = (day, hour, minute = 0) => ({ year: 2026, month: 9, day, hour, minute });
const handling = { minDays: 0, maxDays: 1 };
const transit = { minDays: 2, maxDays: 4 };

test("an order before the cut-off counts from today and skips Friday", () => {
  const estimate = computeDeliveryEstimate({ now: clock(13, 10), handling, transit });
  assert.equal(estimate.start, "2026-09-13");
  assert.equal(estimate.earliest, "2026-09-15"); // Tuesday
  assert.equal(estimate.latest, "2026-09-19"); // Mon handoff + Tue, Wed, Thu, (Fri off) Sat
  assert.equal(estimate.orderedToday, true);
  assert.equal(estimate.cutoffMinutesLeft, 4 * 60);
});

test("after the cut-off the order starts on the next working day", () => {
  const estimate = computeDeliveryEstimate({ now: clock(13, 15, 30), handling, transit });
  assert.equal(estimate.start, "2026-09-14");
  assert.equal(estimate.earliest, "2026-09-16");
  assert.equal(estimate.orderedToday, false);
  assert.equal(estimate.cutoffMinutesLeft, 0);
});

test("a Thursday evening order waits out Friday before anything moves", () => {
  const estimate = computeDeliveryEstimate({ now: clock(17, 20), handling: { minDays: 0, maxDays: 0 }, transit: { minDays: 1, maxDays: 1 } });
  assert.equal(estimate.start, "2026-09-19");
  assert.equal(estimate.earliest, "2026-09-20");
  assert.equal(estimate.latest, "2026-09-20");
});

test("an order placed on a day off never counts that day", () => {
  const estimate = computeDeliveryEstimate({ now: clock(18, 9), handling: { minDays: 0, maxDays: 0 }, transit: { minDays: 1, maxDays: 1 } });
  assert.equal(estimate.orderedToday, false);
  assert.equal(estimate.start, "2026-09-19");
});

test("holidays are skipped like a day off", () => {
  const estimate = computeDeliveryEstimate({
    now: clock(13, 10),
    handling: { minDays: 0, maxDays: 0 },
    transit: { minDays: 2, maxDays: 2 },
    settings: { holidays: ["2026-09-14", "2026-09-15"] },
  });
  assert.equal(estimate.earliest, "2026-09-17");
});

test("the cut-off, days off and the switch are honoured", () => {
  assert.equal(computeDeliveryEstimate({ now: clock(13, 10), handling, transit, settings: { cutoffTime: "09:30" } }).orderedToday, false);
  assert.equal(computeDeliveryEstimate({ now: clock(13, 10), handling, transit, settings: { enabled: false } }), null);
  assert.equal(computeDeliveryEstimate({ now: clock(13, 10), handling, transit, settings: { enabled: "false" } }), null);
  assert.equal(normalizeCutoffTime("nonsense").text, "14:00");
  assert.deepEqual(normalizeDaysOff([0, 1, 2, 3, 4, 5, 6]), [5]);
});

test("no transit days means no date — never an invented one", () => {
  assert.equal(computeDeliveryEstimate({ now: clock(13, 10), handling, transit: null }), null);
  assert.equal(resolveZoneTransitDays({ governorate: "Cairo" }), null);
});

test("transit days come from the zone's own range, its legacy range, then its wording", () => {
  assert.deepEqual(resolveZoneTransitDays({ transit_min_days: 1, transit_max_days: 3, delivery_min_days: 5 }), { minDays: 1, maxDays: 3, source: "transit" });
  assert.deepEqual(resolveZoneTransitDays({ delivery_min_days: 2, delivery_max_days: 4 }), { minDays: 2, maxDays: 4, source: "delivery" });
  assert.deepEqual(resolveZoneTransitDays({ estimated_delivery_text: "2-4 business days" }), { minDays: 2, maxDays: 4, source: "text" });
  assert.deepEqual(resolveZoneTransitDays({ estimated_delivery_text: "من ٣ إلى ٥ أيام" }), { minDays: 3, maxDays: 5, source: "text" });
});

test("the wording reads like the owner's example", () => {
  const single = { today: "2026-09-13", earliest: "2026-09-15", latest: "2026-09-15" };
  assert.equal(deliveryEstimateSentence(single, "ar"), "متوقع وصول طلبك الثلاثاء 15 سبتمبر");
  assert.equal(describeDeliveryEstimate({ ...single, earliest: "2026-09-14", latest: "2026-09-14" }, "ar").relative, "tomorrow");
  const range = describeDeliveryEstimate({ today: "2026-09-13", earliest: "2026-09-15", latest: "2026-09-17" }, "ar");
  assert.equal(range.from, "الثلاثاء 15");
  assert.equal(range.to, "الخميس 17 سبتمبر");
  assert.equal(deliveryEstimateSentence(single, "en"), "Estimated delivery Tuesday 15 September");
});

test("the countdown is short and readable", () => {
  assert.equal(formatCutoffCountdown(135, "ar"), "2 س 15 د");
  assert.equal(formatCutoffCountdown(120, "en"), "2h");
  assert.equal(formatCutoffCountdown(7, "ar"), "7 د");
});
