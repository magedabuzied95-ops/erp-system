import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { messageIdentityKeys, messagesConflict } from "../src/modules/aiSupport/lib/conversationHelpers.js";

// Hatem Azab, 2026-09-13: "تمام مع شركة الشحن ان شاء الله" typed on the phone was sent once and
// stored once (row 709773), yet the open inbox showed it six times until a reload. Each Cloud
// status for a wamid the database did not know fell back to "the newest staff row of the session"
// and re-stamped its provider id; every socket event then carried the same row under a different
// provider id, and the client split it into a new bubble each time.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Same shape as the desktop inbox's mergeMessagesByIdentity.
const desktopMerge = (messages) => {
  const merged = [];
  const indexes = new Map();
  for (const message of messages) {
    const keys = messageIdentityKeys(message);
    const found = keys.reduce((hit, key) => hit ?? indexes.get(key), undefined);
    if (found !== undefined && !messagesConflict(merged[found], message)) {
      merged[found] = { ...merged[found], ...message };
      messageIdentityKeys(merged[found]).forEach((key) => indexes.set(key, found));
    } else {
      const next = merged.push(message) - 1;
      keys.forEach((key) => indexes.set(key, next));
    }
  }
  return merged;
};

// Same shape as the PWA's mergeMessagesByIdentity.
const pwaMerge = (messages) => {
  const merged = [];
  for (const message of messages) {
    const index = merged.findIndex((item) => {
      const keys = new Set(messageIdentityKeys(item));
      return messageIdentityKeys(message).some((key) => keys.has(key)) && !messagesConflict(item, message);
    });
    if (index >= 0) merged[index] = { ...merged[index], ...message };
    else merged.push(message);
  }
  return merged;
};

const row = (providerId, status) => ({
  id: 709773,
  message_identity_key: "msg|1|whatsapp:201225226367|outbound|2A0ED7E3A435B",
  dedupe_key: "msg|1|whatsapp:201225226367|outbound|2A0ED7E3A435B",
  provider_message_id: providerId,
  external_message_id: providerId,
  sender_type: "staff",
  staff_message: "تمام مع شركة الشحن ان شاء الله",
  delivery_status: status,
});

const events = [
  row("2A0ED7E3A435B", "sent"),
  row("wamid.A", "sent"),
  row("2A0ED7E3A435B", "delivered"),
  row("wamid.B", "delivered"),
  row("wamid.C", "read"),
  row("2A0ED7E3A435B", "read"),
];

for (const [name, merge] of [["desktop", desktopMerge], ["pwa", pwaMerge]]) {
  test(`${name}: one database row stays one bubble while its provider id changes`, () => {
    let thread = [];
    for (const event of events) thread = merge([...thread, event]);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].delivery_status, "read");
  });
}

test("two different rows with different provider ids are still two messages", () => {
  const a = { id: 1, provider_message_id: "P1", dedupe_key: "shared" };
  const b = { id: 2, provider_message_id: "P2", dedupe_key: "shared" };
  assert.equal(messagesConflict(a, b), true);
  assert.equal(desktopMerge([a, b]).length, 2);
});

test("a delivery status only moves the row whose id it carries", () => {
  const source = read("server/services/aiSupportLogService.js");
  const updater = source.slice(
    source.indexOf("export const updateAiSupportMessageDeliveryStatus"),
    source.indexOf("export const appendAutomationSupportTranscript")
  );
  assert.match(updater, /AND \(provider_message_id = \$3 OR external_message_id = \$3\)/);
  // The session fallback is what re-stamped the newest staff row with a stranger's id.
  assert.doesNotMatch(updater, /session_id = \$2/);
});
