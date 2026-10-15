import test from "node:test";
import assert from "node:assert/strict";

process.env.BUSINESS_MODE = "wholesale";
const { isReminderSlot, reminderMessage } = await import("../../server/modules/wholesale/wholesale.reminders.js");

test("the reminder fires on the customer's Cairo day, at or after their hour", () => {
  const settings = { enabled: true, weekday: 4, hour: 11 };
  // 2026-10-15 is a Thursday; 08:30Z is 11:30 in Cairo (UTC+3 summer time).
  assert.equal(isReminderSlot(settings, new Date("2026-10-15T08:30:00Z")), true);
  assert.equal(isReminderSlot(settings, new Date("2026-10-15T07:30:00Z")), false, "10:30 Cairo is before the hour");
  assert.equal(isReminderSlot(settings, new Date("2026-10-16T08:30:00Z")), false, "Friday is another day");
  assert.equal(isReminderSlot({ ...settings, enabled: false }, new Date("2026-10-15T08:30:00Z")), false);
});

test("the message carries the balance and the statement link", () => {
  const body = reminderMessage({ name: "Omar", balance: 251000, url: "https://jomla.example/s/tok" });
  assert.match(body, /251,000/);
  assert.match(body, /https:\/\/jomla\.example\/s\/tok/);
  assert.match(body, /Omar/);
});
